import {allocateWaterfall,expectedCoverage} from './coverage.mjs';
import {schema,parseWtp,validateRecord,batchHash,previewWtp} from './wtp.mjs';
import {calendarDay,lessonInterval,weekOf} from './lesson-time.mjs';
import {migrateWorkDetails} from './legacy-work.mjs';

export const clone = value => structuredClone(value);
export const today = () => new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date());
export function cents(value) {
  if (value===null || value===undefined || value==='') return null;
  const number=Number(value), result=Math.round(number*100);
  return Number.isFinite(number) && Number.isSafeInteger(result) ? result : null;
}
function sum(values) {
  let total=0;
  for(const value of values) {
    if(value===null || !Number.isSafeInteger(total+value)) return null;
    total+=value;
  }
  return total;
}
export const fingerprint = row => JSON.stringify([row.entity,row.data]);
export function emptyLedger() {
  return {version:2,revision:0,records:[],batches:[],audit:[],checkpoints:[],attachments:{},
    settings:{scenario:'Base',currency:'HKD'},legacy:null};
}
const categoryIds={
  transport:'TRANSPORT',cat_transport:'TRANSPORT',housing:'HOUSING',cat_housing:'HOUSING',
  food:'FOOD',cat_food:'FOOD',cat_travel:'LEISURE',
};
const categoryNames={'交通':'TRANSPORT',Transport:'TRANSPORT','住宿':'HOUSING',Housing:'HOUSING','飲食':'FOOD',Food:'FOOD'};
export const legacyMigrationVersion=4;
export function migrateLegacy(raw,sourceHash,migrationVersion=legacyMigrationVersion) {
  const input=JSON.parse(raw);
  if(!input || typeof input!=='object' || Array.isArray(input)) throw Error('Legacy backup must be an object.');
  for(const key of ['sources','records','expenses','scheduled','smartExpenses','tripCategories']) {
    if(input[key]!==undefined && !Array.isArray(input[key])) throw Error('Invalid legacy list '+key);
  }
  const result=emptyLedger();
  if(['HKD','EUR'].includes(input.displayCurrency))result.settings.currency=input.displayCurrency;
  if(typeof input.isDarkMode==='boolean')result.settings.theme=input.isDarkMode?'dark':'light';
  if(typeof input.departureDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.departureDate))result.settings.departure_date=input.departureDate;
  result.legacy={migrationVersion,sourceHash,raw,original:{sourceHash,raw},migratedAt:new Date().toISOString(),warnings:[]};
  const identities=new Map();
  const add=(entity,data,source,path)=>{
    const stable=source.id===undefined?path:path.slice(0,path.lastIndexOf('/')+1)+encodeURIComponent(String(source.id));
    const count=identities.get(stable)??0;
    identities.set(stable,count+1);
    const row={id:'legacy:'+stable+(count?'#'+count:''),revision:1,entity,data,
      origin:{path,id:source.id??null,raw:clone(source)}};
    result.records.push(row);
    return row.id;
  };
  const studentIds=new Map();
  (input.sources??[]).forEach((row,index)=>{
    const rate=cents(row.rate);
    const id=add('student',{description:row.name??'Unnamed student',rate:rate===null?null:rate/100,currency:'HKD',
      grade:row.grade??'',subject:row.subject??'',address:row.address??(migrationVersion===1?row.addressShort??'':''),
      ...(migrationVersion>=2?{location:row.addressShort??''}:{}),contact:row.contact??''},row,'sources/'+index);
    if(studentIds.has(String(row.id))) result.legacy.warnings.push('Duplicate student ID '+row.id);
    else studentIds.set(String(row.id),id);
  });
  (input.records??[]).forEach((row,index)=>add('income_entry',{
    description:row.sourceName??'Historical tutoring',amount:row.income??null,currency:'HKD',
    date:row.date,source_id:studentIds.get(String(row.sourceId))??null,
  },row,'records/'+index));
  (input.scheduled??[]).forEach((row,index)=>add('lesson',{
    description:row.sourceName??'Lesson',student_id:studentIds.get(String(row.sourceId))??'',
    date:row.date,start_time:row.startTime??'',duration:row.duration??null,
    status:row.confirmed?'CONFIRMED':'PLANNED',currency:'HKD',time_zone:row.timeZone??'Asia/Hong_Kong',
    income:row.income??(input.records??[]).find(record=>row.id!==undefined && record.scheduledId!==undefined &&
      String(record.scheduledId)===String(row.id))?.income??null,
  },row,'scheduled/'+index));
  for(const entry of result.records.filter(row=>row.entity==='income_entry')) {
    const scheduledId=entry.origin.raw.scheduledId;
    if(scheduledId===undefined)continue;
    const lesson=result.records.find(row=>row.entity==='lesson'&&String(row.origin.id)===String(scheduledId));
    if(lesson)entry.data.source_id=lesson.id;
  }
  if(migrationVersion>=4)migrateWorkDetails(result,input,add,studentIds);
  (input.expenses??[]).forEach((row,index)=>add('expense',{
    description:row.purpose??'Historical expense',amount:row.amount??null,
    currency:row.currency??'HKD',date:row.date,...(row.type?{type:row.type}:{}),
    ...(typeof row.fixed==='boolean'?{fixed:row.fixed}:{}),
  },row,'expenses/'+index));
  const planning=input.budgetPlanning??{};
  const planNames=new Set();
  const plans=[{id:'legacy-trip',name:planning.originalName??'Base',categories:input.tripCategories??[]},...(planning.plans??[])].map((plan,index)=>{
    const original=plan.name??'Budget plan';
    let name=original,suffix=index+1;
    while(migrationVersion>=2&&planNames.has(name))name=original+' · '+suffix++;
    planNames.add(name);
    if(name!==original)result.legacy.warnings.push('Duplicate plan name '+original+' is shown as '+name+'.');
    return {...plan,name};
  });
  const selected=plans.find(plan=>plan.id===planning.selectedPlanId)??plans[0];
  result.settings.scenario=selected.name;
  result.settings.scenarios=plans.map(plan=>({name:plan.name,archived:(planning.archivedPlanIds??[]).includes(plan.id)}));
  const selectedScenario=result.settings.scenarios.find(row=>row.name===result.settings.scenario);
  if(selectedScenario)selectedScenario.archived=false;
  const destinations=new Map();
  for(const plan of plans) {
    for(const [categoryIndex,category] of (plan.categories??[]).entries()) {
      const mapped=categoryIds[category.id]??categoryNames[category.name]??(category.type==='dest'?'LEISURE':null);
      let tripId=null;
      if(migrationVersion>=3&&category.type==='dest'&&category.id!=='cat_travel'&&category.name&&category.name!=='旅遊') {
        const key=category.id??category.name;
        if(!destinations.has(key))destinations.set(key,add('trip',{description:category.name,
          start_date:null,end_date:null,status:'PLANNED'},category,'destinations/'+encodeURIComponent(String(key))));
        tripId=destinations.get(key);
      }
      if(!mapped && category.items?.length) result.legacy.warnings.push('Choose a main category for '+category.name+' in '+plan.name);
      (category.items??[]).forEach((item,index)=>add('budget_item',{
        description:item.name??'Budget item',amount:item.amount??null,currency:item.currency??'HKD',
        category:mapped,due_date:item.paymentDate??item.dueDate??null,priority:item.priority??'MEDIUM',
        subcategory:category.name??'Legacy',scenario:plan.name,
        ...(tripId?{trip_id:tripId}:{}),
        kind:item.budgetKind==='deposit'?'SECURITY_DEPOSIT':item.budgetKind==='reserve'?'RESERVE':'COST',
        note:item.budgetStatus==='paid'?'Legacy plan marked paid. Link an actual payment before excluding this obligation.':'',
      },item,'plans/'+encodeURIComponent(plan.id)+'/'+categoryIndex+'/'+index));
    }
  }
  const stages={pending:'可申請',applying:'已申請等待批核',applied:'已申請等待批核',approved:'已批核等待發放',received:'已發放'};
  const fundingIds=new Map(),loanIds=new Map();
  (input.finance?.aidLoanItems??[]).forEach((row,index)=>{
    if(row.deleted || row.status==='cancelled') return;
    const entity=row.type==='loan'?'loan':'grant';
    const data={description:row.name,amount:row.amountCents===null?null:row.amountCents/100,
      currency:row.currency??'',due_date:row.dueDate||null,note:row.note??''};
    if(entity==='grant') {
      data.status=stages[row.status]??row.status;
      data.expected_date=row.receiptDate||null;
    }
    const id=add(entity,data,row,'finance/aidLoanItems/'+index);
    if(row.origin?.kind==='funding') fundingIds.set(String(row.origin.id),id);
    if(row.origin?.kind==='loan') loanIds.set(String(row.origin.id),id);
  });
  (input.finance?.funding??[]).forEach((row,index)=>{
    if(fundingIds.has(String(row.id)) || row.type!=='grant' || ['cancelled','rejected'].includes(row.status)) return;
    const money=row.agreedCents??row.expectedCents;
    const id=add('grant',{description:row.name,amount:money===null||money===undefined?null:money/100,currency:'HKD',
      status:row.status==='expected'?'可申請':stages[row.status]??'可申請',
      expected_date:row.expectedDate?.slice(0,10)||null,source:row.source??'',note:row.note??''},row,'finance/funding/'+index);
    fundingIds.set(String(row.id),id);
  });
  (input.finance?.loans??[]).forEach((row,index)=>{
    if(loanIds.has(String(row.id)) || row.status==='cancelled')return;
    const id=add('loan',{description:row.name,amount:row.expectedCents===null?null:row.expectedCents/100,
      currency:'HKD',due_date:row.repaymentDate?.slice(0,10)||null,note:row.note??''},row,'finance/loans/'+index);
    loanIds.set(String(row.id),id);
  });
  (input.finance?.events??[]).forEach((row,index)=>{
    const data={description:row.name,amount:row.amountCents/100,currency:'HKD',
      date:row.occurredAt?.slice(0,10),voided:!!row.voided,note:row.note??''};
    const entity=row.kind==='expense'?'expense':'cash_event';
    if(entity==='cash_event') {
      data.kind=({income:'INCOME',loanDraw:'LOAN_DRAW',principalRepayment:'LOAN_REPAYMENT',interestFee:'INTEREST'})[row.kind]??'INCOME';
      data.related_id=loanIds.get(String(row.loanId))??fundingIds.get(String(row.fundingId))??null;
    }
    const id=add(entity,data,row,'finance/events/'+index);
    for(const reference of row.sourceRefs??[]) {
      if(reference.type!=='expense')continue;
      const source=result.records.find(record=>record.entity==='expense' &&
        record.origin.path.startsWith('expenses/') && String(record.origin.id)===String(reference.id));
      if(source) source.representedBy=id;
    }
  });
  (input.finance?.balances??[]).forEach((row,index)=>{
    const id=add('balance',{description:row.scope??'Legacy balance',amount:row.amountCents/100,
      currency:'HKD',as_of:row.asOf?.slice(0,10),note:row.note??''},row,'finance/balances/'+index);
    result.records.find(record=>record.id===id).requiresReconciliation=true;
  });
  if(input.finance?.balances?.length) result.legacy.warnings.push('Confirm imported balances and their included payments before relying on current cash.');
  const rate=planning.manualRate??input.exchangeRate;
  const timestamp=input.lastRateUpdate===null || input.lastRateUpdate===undefined?null:new Date(input.lastRateUpdate);
  const rateDate=planning.manualRateUpdatedAt?.slice(0,10)||
    (timestamp&&Number.isFinite(timestamp.getTime())?timestamp.toISOString().slice(0,10):null);
  if(Number.isFinite(rate)&&rate>0) add('fx_quote',{
    description:'Legacy EUR reference',currency:'EUR',rate,
    date:rateDate,source:'Legacy cached reference',
  },{rate,lastRateUpdate:input.lastRateUpdate},'fx/EUR');
  return result;
}

export function isSnapshotSettlement(row) {
  return row.entity==='expense'&&row.origin?.raw&&
    (/-tracked$/.test(String(row.origin.raw.id))||/[（(]來自追蹤[）)]/.test(String(row.origin.raw.purpose)));
}
export function expenseClassification(ledger,row) {
  const saved=row.entity==='expense'&&row.origin?ledger.settings.legacy_expense_classes?.[row.id]:null;
  if(saved==='ARCHIVE'&&(row.data.budget_item_id||row.data.trip_id||row.data.included_in_general_id||row.representedBy))
    return row.data.type??null;
  return saved??row.data.type??null;
}
function cashDirection(row) {
  if(isSnapshotSettlement(row))return 0;
  if(['expense','bill_payment'].includes(row.entity)) return -1;
  if(row.entity==='savings_deposit') return row.data.direction==='OUT'?-1:1;
  if(row.entity==='cash_event') return ['LOAN_REPAYMENT','INTEREST','SECURITY_PAYMENT'].includes(row.data.kind)?-1:1;
  return 0;
}
export function quote(ledger,currency,asOf=today()) {
  if(currency==='HKD') return {rate:1,date:asOf,source:'Base currency'};
  return ledger.records.filter(row=>row.entity==='fx_quote' && row.data.currency===currency && row.data.date<=asOf).reverse()
    .sort((a,b)=>b.data.date.localeCompare(a.data.date))[0]?.data??null;
}
export function convert(ledger,amount,currency,asOf=today()) {
  const rate=quote(ledger,currency,asOf)?.rate;
  const value=cents(amount);
  if(value===0)return 0;
  if(!rate || value===null) return null;
  const result=Math.round(value*rate);
  return Number.isSafeInteger(result)?result:null;
}
export function convertUnits(ledger,amount,from,to,asOf=today()) {
  if(from===to)return cents(amount);
  const source=convert(ledger,amount,from,asOf),targetRate=quote(ledger,to,asOf)?.rate;
  if(source===null || !targetRate)return null;
  const result=Math.round(source/targetRate);
  return Number.isSafeInteger(result)?result:null;
}
export function reconcileBalance(ledger,id) {
  const balance=ledger.records.find(row=>row.id===id && row.entity==='balance');
  if(!balance) throw Error('Balance record was not found.');
  const included=balance.data.scope==='ACCOUNT'?accountMovements(ledger,balance.data.account_id,balance.data.as_of):actuals(ledger,balance.data.as_of);
  balance.reconciliation=included
    .map(row=>({id:row.id,fingerprint:fingerprint(row)}));
  balance.requiresReconciliation=false;
  return balance;
}
function actuals(ledger,asOf,includeLegacyWeeklyEstimate=true) {
  const week=weekOf(asOf);
  const details=includedExpenseDetails(ledger,asOf);
  return ledger.records.filter(row=>cashDirection(row)!==0 && expenseClassification(ledger,row)!=='ARCHIVE' && (row.data.date<=asOf||
    includeLegacyWeeklyEstimate&&!row.data.entry_week&&row.entity==='cash_event'&&row.data.kind==='INCOME'&&row.data.receipt_week===week&&row.data.date===calendarDay(week,6)) &&
    !row.data.voided&&!details.has(row.id) && (!row.representedBy || !ledger.records.some(record=>record.id===row.representedBy && !record.data.voided)));
}
export function includedExpenseDetails(ledger,asOf=today()) {
  const aggregates=new Map(ledger.records.filter(row=>row.entity==='expense'&&row.data.entry_week&&
    !row.data.voided&&row.data.date<=asOf).map(row=>[row.id,row]));
  return new Map(ledger.records.filter(row=>row.entity==='expense'&&!row.data.voided&&aggregates.has(row.data.included_in_general_id))
    .map(row=>[row.id,aggregates.get(row.data.included_in_general_id)]));
}
export function recordedMovements(ledger,asOf=today(),{includeLegacyWeeklyEstimate=true}={}) {
  return actuals(ledger,asOf,includeLegacyWeeklyEstimate).map(row=>{
    const direction=cashDirection(row);
    const value=convert(ledger,row.data.amount,row.data.currency,row.data.date);
    const kind=row.entity==='savings_deposit'?'savings':
      row.entity!=='cash_event'?'spending':
      ({INCOME:'income',REFUND:'refund',INTEREST:'spending',SECURITY_PAYMENT:'deposit',
        LOAN_DRAW:'financing',LOAN_REPAYMENT:'financing'})[row.data.kind];
    return {id:row.id,date:row.data.date,kind,cents:value===null?null:direction*value};
  });
}
export function financialModel(ledger,asOf=today(),valuationLedger=ledger,{exchangeOverrideOnly=false}={}) {
  const balances=ledger.records.filter(row=>row.entity==='balance' && row.data.scope!=='ACCOUNT' &&
    (!exchangeOverrideOnly||row.data.scope==='EXCHANGE') && row.data.as_of<=asOf).reverse()
    .sort((a,b)=>b.data.as_of.localeCompare(a.data.as_of));
  const base=balances[0]??null, issues=[], historyReview=[],changes=[],applied=[];
  const cashRecords=actuals(ledger,asOf);
  if(base?.requiresReconciliation) issues.push('Confirm the imported balance and its included payments.');
  const included=new Map((base?.reconciliation??[]).map(entry=>[entry.id,entry]));
  const details=includedExpenseDetails(ledger,asOf);
  if(base&&ledger.records.some(row=>included.has(row.id)&&details.get(row.id)?.data.date>base.data.as_of))
    issues.push('A weekly expense spans the confirmed cash balance. Review the included expenses.');
  const unsettledSnapshots=base?ledger.records.filter(row=>isSnapshotSettlement(row)&&row.data.date>base.data.as_of&&row.data.date<=asOf):[];
  for(const row of cashRecords) {
    const acknowledged=included.get(row.id);
    if(acknowledged) {
      if(acknowledged.fingerprint!==fingerprint(row)) {
        issues.push('Reconcile edited payment '+row.data.description);
        historyReview.push({id:row.id,reason:'Payment changed after balance confirmation'});
      }
      continue;
    }
    const explicitlyAfter=base && row.data.balance_id===base.id && row.data.after_balance===true &&
      row.data.date===base.data.as_of;
    if(!base || row.data.date<=base.data.as_of && !explicitlyAfter) {
      issues.push('Reconcile historical payment '+row.data.description);
      historyReview.push({id:row.id,reason:base?'Recorded on or before the confirmed balance date':'Exchange opening cash has not been confirmed'});
      continue;
    }
    const native=base?convertUnits(ledger,row.data.amount,row.data.currency,base.data.currency,row.data.date):null;
    const value=native===null?null:convert(ledger,native/100,base.data.currency,asOf);
    changes.push(native===null?null:native*cashDirection(row));
    applied.push({id:row.id,description:row.data.description,entity:row.entity,date:row.data.date,
      cents:value===null?null:value*cashDirection(row)});
    if(value===null) issues.push('Missing dated FX for '+row.data.currency+' on '+row.data.date);
  }
  for(const id of included.keys()) {
    if(!ledger.records.some(row=>row.id===id)) issues.push('Reconcile a removed historical payment');
  }
  const baseline=base?convert(ledger,base.data.amount,base.data.currency,asOf):null;
  const nativeAvailable=base?sum([cents(base.data.amount),...changes]):null;
  const available=issues.length || nativeAvailable===null?null:convert(ledger,nativeAvailable/100,base.data.currency,asOf);
  const stages=['可申請','已申請等待批核','已批核等待發放','已發放'];
  const grants=ledger.records.filter(row=>row.entity==='grant' && stages.includes(row.data.status)).map(row=>{
    const receipts=ledger.records.filter(receipt=>receipt.entity==='cash_event' && !receipt.data.voided &&
      receipt.data.related_id===row.id && receipt.data.kind==='INCOME' && receipt.data.date<=asOf);
    const approved=cents(row.data.amount);
    const received=sum(receipts.map(receipt=>convertUnits(ledger,receipt.data.amount,receipt.data.currency,row.data.currency,receipt.data.date)));
    const outstanding=approved===null||received===null?null:Math.max(0,approved-received);
    return {id:row.id,status:row.data.status,receivedNative:received,outstandingNative:outstanding,receiptCount:receipts.length,
      receivedCents:sum(receipts.map(receipt=>convert(ledger,receipt.data.amount,receipt.data.currency,receipt.data.date))),
      outstandingCents:outstanding===null?null:convert(valuationLedger,outstanding/100,row.data.currency,asOf)};
  });
  const coverage=expectedCoverage(available,grants);
  const budgetRows=ledger.records.filter(row=>['budget_item','trip_budget_item'].includes(row.entity) && activeBudget(ledger,row));
  const refundsByPayment=new Map();
  for(const refund of cashRecords.filter(row=>row.entity==='cash_event'&&row.data.kind==='REFUND')) {
    const id=refund.data.related_id;
    if(!refundsByPayment.has(id))refundsByPayment.set(id,[]);
    refundsByPayment.get(id).push(refund);
  }
  const obligations=budgetRows.map(row=>{
    const payments=cashRecords.filter(payment=>
      (payment.entity==='expense' && payment.data.budget_item_id===row.id ||
       payment.entity==='cash_event' && payment.data.kind==='SECURITY_PAYMENT' && payment.data.related_id===row.id));
    const refunds=payments.flatMap(payment=>refundsByPayment.get(payment.id)??[]);
    const paidGross=sum(payments
      .map(payment=>convertUnits(ledger,payment.data.amount,payment.data.currency,row.data.currency,payment.data.date)));
    const refundsInItemCurrency=sum(refunds.map(refund=>convertUnits(ledger,refund.data.amount,refund.data.currency,row.data.currency,refund.data.date)));
    const deposit=row.data.kind==='SECURITY_DEPOSIT';
    // Returned security is a cash receipt, but does not create a second deposit obligation.
    const paidAgainstPlan=deposit?paidGross:refundsInItemCurrency===null?null:sum([paidGross,-refundsInItemCurrency]);
    const required=plannedNative(row.data);
    const original=plannedNative(row.budgetBaseline??row.data);
    const unlinkedPaid=!row.derivedFrom && row.origin?.raw?.budgetStatus==='paid' && !payments.length;
    const complete=Boolean(row.data.completed_on&&row.data.completed_on<=asOf);
    const actualPaid=unlinkedPaid?null:sum([
      ...payments.map(payment=>convert(ledger,payment.data.amount,payment.data.currency,payment.data.date)),
      ...refunds.map(refund=>{const value=convert(ledger,refund.data.amount,refund.data.currency,refund.data.date);return value===null?null:-value;}),
    ]);
    const currency=row.data.currency,originalCurrency=row.budgetBaseline?.currency??currency;
    const remaining=complete?0:required===null||paidAgainstPlan===null||unlinkedPaid?null:
      Math.max(0,required-Math.max(0,paidAgainstPlan));
    return {id:row.id,category:row.data.category,currency,originalCurrency,
      required,originalNative:original,remaining,paidNative:paidAgainstPlan,unlinkedPaid,
      missingQuote:!quote(valuationLedger,currency,asOf),missingOriginalQuote:!quote(valuationLedger,originalCurrency,asOf),
      planned:required===null?null:convert(valuationLedger,required/100,currency,asOf),
      original:original===null?null:convert(valuationLedger,original/100,originalCurrency,asOf),
      linkedPayments:payments.length,paymentIds:payments.map(payment=>payment.id),refundIds:refunds.map(refund=>refund.id),
      paid:actualPaid,complete,deposit,
      cents:remaining===null?null:convert(valuationLedger,remaining/100,currency,asOf)};
  });
  const waterfall=allocateWaterfall(available,obligations);
  const planned=allocateWaterfall(coverage.expected,obligations);
  const total=sum(obligations.map(row=>row.cents));
  const debt=ledger.records.filter(row=>row.entity==='loan').map(loan=>{
    const events=ledger.records.filter(row=>row.entity==='cash_event' && !row.data.voided && row.data.related_id===loan.id && row.data.date<=asOf);
    if(loan.origin?.raw?.status==='received'&&!events.some(row=>row.data.kind==='LOAN_DRAW')) {
      issues.push('Review received principal for '+loan.data.description);
      return null;
    }
    const principal=sum(events.filter(row=>['LOAN_DRAW','LOAN_REPAYMENT'].includes(row.data.kind))
      .map(row=>{const value=convertUnits(ledger,row.data.amount,row.data.currency,loan.data.currency,row.data.date);
        return value===null?null:value*(row.data.kind==='LOAN_DRAW'?1:-1);}));
    return principal===null?null:convert(ledger,principal/100,loan.data.currency,asOf);
  });
  return {base,available,...coverage,waterfall,planned,total,issues,historyReview,applied,baseline,grants,debt:sum(debt),
    gap:total===null || available===null || !Number.isSafeInteger(total-available)?null:Math.max(0,total-available),
    asOf,budgetRows,obligations,unsettledSnapshots};
}
function plannedNative(data) {
  const item=cents(data.amount),multiplier=periodMultiplier(data);
  const personal=data.participants?.find(participant=>participant.self)?.share??data.share??1;
  const total=item===null||multiplier===null?null:Math.round(item*multiplier*personal);
  return Number.isSafeInteger(total)&&total>=0?total:null;
}
function accountMovements(ledger,id,asOf) {
  const details=includedExpenseDetails(ledger,asOf);
  return ledger.records.filter(row=>row.data.date<=asOf&&!row.data.voided&&
    (row.entity==='account_transfer'&&(row.data.from_account_id===id||row.data.to_account_id===id) ||
      cashDirection(row)!==0&&row.data.account_id===id&&!details.has(row.id)));
}
export function accountBalances(ledger,asOf=today()) {
  const details=includedExpenseDetails(ledger,asOf);
  return ledger.records.filter(row=>row.entity==='account').map(account=>{
    const base=ledger.records.filter(row=>row.entity==='balance'&&row.data.scope==='ACCOUNT' &&
      row.data.account_id===account.id&&row.data.as_of<=asOf).reverse().sort((a,b)=>b.data.as_of.localeCompare(a.data.as_of))[0];
    const included=new Map((base?.reconciliation??[]).map(row=>[row.id,row.fingerprint]));
    let known=!!base&&![...included.keys()].some(id=>details.get(id)?.data.date>base.data.as_of);
    const values=[];
    for(const row of accountMovements(ledger,account.id,asOf)) {
      if(included.has(row.id)) {
        if(included.get(row.id)!==fingerprint(row))known=false;
        continue;
      }
      if(!base || row.data.date<=base.data.as_of) {known=false;continue;}
      const sign=row.entity==='account_transfer'?(row.data.to_account_id===account.id?1:-1):cashDirection(row);
      const value=convertUnits(ledger,row.data.amount,row.data.currency,account.data.currency,row.data.date);
      values.push(value===null?null:value*sign);
    }
    for(const id of included.keys())if(!ledger.records.some(row=>row.id===id))known=false;
    return {id:account.id,description:account.data.description,currency:account.data.currency,asOf:base?.data.as_of??null,
      cents:known?sum([convertUnits(ledger,base.data.amount,base.data.currency,account.data.currency,base.data.as_of),...values]):null};
  });
}
export function activeBudget(ledger,row) {
  const trip=ledger.records.find(record=>record.id===row.data.trip_id&&record.entity==='trip');
  if(trip?.data.status==='CANCELLED')return false;
  if(row.entity!=='trip_budget_item') return !row.data.scenario || row.data.scenario===ledger.settings.scenario;
  return !row.data.scenario || row.data.scenario===(trip?.data.scenario??'Base');
}
export function workIncome(ledger) {
  const groups=new Map();
  const reported=ledger.records.filter(row=>row.entity==='income_entry');
  const standalone=ledger.records.filter(row=>row.entity==='lesson' && (!row.origin||row.origin.edited) && row.data.status==='CONFIRMED' &&
    !reported.some(entry=>entry.data.source_id===row.id)).map(row=>({
      data:{date:row.data.date,amount:row.data.income,currency:row.data.currency},
    }));
  for(const row of [...reported,...standalone]) {
    const month=row.data.period??row.data.date?.slice(0,7);
    const group=groups.get(month)??{month,entries:[],summaries:[]};
    (row.data.period?group.summaries:group.entries).push(row);
    groups.set(month,group);
  }
  return [...groups.values()].map(group=>{
    const currencies=new Set([...group.entries,...group.summaries].map(row=>row.data.currency));
    const byCurrency=[];
    for(const currency of currencies) {
      const summaries=group.summaries.filter(row=>row.data.currency===currency);
      const entries=group.entries.filter(row=>row.data.currency===currency);
      const total=summaries.length===1?cents(summaries[0].data.amount):
        summaries.length>1?null:sum(entries.map(row=>cents(row.data.amount)));
      byCurrency.push({currency,total,source:summaries.length?'MONTHLY_SUMMARY':'RECORDED_LESSONS'});
    }
    return {month:group.month,byCurrency};
  }).sort((a,b)=>String(b.month).localeCompare(String(a.month)));
}
export function periodMultiplier(data) {
  if(!data.frequency || data.frequency==='ONCE') return 1;
  if(!data.start_date || !data.end_date || data.end_date<data.start_date) return null;
  const start=new Date(data.start_date+'T00:00:00Z'),end=new Date(data.end_date+'T00:00:00Z');
  const from=start.getTime(),to=end.getTime();
  if(!Number.isFinite(from)||!Number.isFinite(to))return null;
  if(data.frequency==='DAILY') return (to-from)/86400000+1;
  const daysInMonth=date=>{const last=new Date(date);last.setUTCMonth(last.getUTCMonth()+1,0);return last.getUTCDate();};
  const months=(end.getUTCFullYear()-start.getUTCFullYear())*12+end.getUTCMonth()-start.getUTCMonth();
  const firstDays=daysInMonth(start);
  if(months===0)return (end.getUTCDate()-start.getUTCDate()+1)/firstDays;
  return (firstDays-start.getUTCDate()+1)/firstDays+months-1+end.getUTCDate()/daysInMonth(end);
}
export function housingCost(ledger,row) {
  const lease=periodMultiplier({frequency:'MONTHLY',start_date:row.data.start_date,end_date:row.data.end_date});
  const rent=cents(row.data.amount);
  const deposit=convert(ledger,row.data.security_deposit,row.data.currency);
  const calculated=rent===null||lease===null?null:Math.round(rent*lease);
  const total=Number.isSafeInteger(calculated)?convert(ledger,calculated/100,row.data.currency):null;
  return {rent:total,deposit,total:total===null||deposit===null?null:sum([total,deposit])};
}
export function validateRelations(ledger, operations=new Map()) {
  const reject=(message,field,record,...related)=>{
    const candidates=[record,...related].map(id=>operations.get(id)).filter(Boolean);
    const proposal=candidates.find(value=>value.op==='DELETE')??candidates[0];
    if(!proposal)throw Error(message);
    const part=proposal.op==='DELETE'?'record_id':proposal.op==='UPDATE'?'changes.':'data.';
    const path=part==='record_id'?part:part+field;
    throw Error('$.operations['+proposal.index+'].'+path+': '+message);
  };
  const settings=ledger.settings;
  if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Workspace settings need recovery.');
  if(settings.widgets!==undefined&&(!Array.isArray(settings.widgets)||new Set(settings.widgets).size!==settings.widgets.length||
    settings.widgets.some(id=>!['payments','milestones','work'].includes(id))))throw Error('Overview widget settings are invalid.');
  if(settings.scenarios!==undefined&&(!Array.isArray(settings.scenarios)||settings.scenarios.some(row=>
    !row||typeof row.name!=='string'||!row.name.trim()||typeof row.archived!=='boolean')||
    new Set(settings.scenarios.map(row=>row.name)).size!==settings.scenarios.length))throw Error('Budget scenario settings are invalid.');
  for(const [key,label] of [['departure_date','departure'],['return_date','return']]) {
    if(!settings[key])continue;
    const date=new Date(settings[key]+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(settings[key])||!Number.isFinite(date.getTime())||
      date.toISOString().slice(0,10)!==settings[key])throw Error('The '+label+' date is invalid.');
  }
  if(settings.departure_date&&settings.return_date&&settings.return_date<settings.departure_date)throw Error('Return date must follow departure.');
  if(settings.auto_fx!==undefined) {
    const {enabled,reference}=settings.auto_fx??{};
    if(typeof enabled!=='boolean'||reference&&
      (reference.currency!=='EUR'||!Number.isFinite(reference.rate)||reference.rate<=0||reference.rate>1e9||
        !/^\d{4}-\d{2}-\d{2}$/.test(reference.date)||!Number.isFinite(Date.parse(reference.updated_at))||
        typeof reference.source!=='string'))throw Error('Exchange-rate settings are invalid.');
  }
  if(settings.manual_eur_rate!==undefined) {
    const {rate,date}=settings.manual_eur_rate??{};
    const instant=new Date(date+'T00:00:00Z');
    if(!Number.isFinite(rate)||rate<=0||rate>1e9||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
      !Number.isFinite(instant.getTime())||instant.toISOString().slice(0,10)!==date)throw Error('The manual planning rate is invalid.');
  }
  if(settings.theme!==undefined&&!['light','dark'].includes(settings.theme))throw Error('The appearance setting is invalid.');
  if(settings.language!==undefined&&!['en','zh-Hant'].includes(settings.language))throw Error('The interface language is invalid.');
  const timer=ledger.settings?.timer;
  if(timer && (typeof timer.id!=='string' || typeof timer.student_id!=='string' ||
    !Number.isFinite(timer.elapsed) || timer.elapsed<0 || !Number.isFinite(timer.startedAt) ||
    typeof timer.running!=='boolean' || timer.running&&!Number.isFinite(timer.lastStart) ||
    typeof timer.rate!=='number' || !Number.isFinite(timer.rate) || timer.rate<0 ||
    typeof timer.time_zone!=='string' || typeof timer.currency!=='string')) throw Error('The saved lesson timer needs recovery.');
  if(timer) {
    try {new Intl.DateTimeFormat('en',{timeZone:timer.time_zone});}
    catch {throw Error('The saved timer time zone is invalid.');}
  }
  const records=new Map(ledger.records.map(row=>[row.id,row]));
  const linkedExpenseCents=new Map();
  if(timer && !records.has(timer.student_id)) reject('The active timer still uses this student.','student_id',timer.student_id);
  if(records.size!==ledger.records.length) throw Error('Duplicate record identity.');
  const links={trip_id:['trip'],student_id:['student'],budget_item_id:['budget_item','trip_budget_item'],
    rule_id:['fixed_bill_rule'],account_id:['account'],from_account_id:['account'],to_account_id:['account'],
    balance_id:['balance'],series_id:['lesson_series'],owner_id:Object.keys(schema)};
  const payments=new Map(), refunds=new Map(), draws=new Map(),repayments=new Map(),loanChanges=new Map(),workReceipts=new Map();
  const slots=[], weeklyAggregates=new Map();
  for(const row of ledger.records) {
    if(!Object.hasOwn(schema,row.entity) || typeof row.id!=='string' || !Number.isSafeInteger(row.revision) || row.revision<1) {
      throw Error('Invalid record identity or type.');
    }
    if(row.origin && !row.origin.edited) {
      // Existing schedules participate in conflict checks even when their old
      // fields still need migration review.
      if(row.entity==='lesson' && row.data.status!=='CANCELLED' &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(row.data.start_time) && Number.isFinite(row.data.duration)) {
        try {slots.push({...lessonInterval(row.data),id:row.id});}
        catch { /* Ambiguous historical timings remain preserved for review. */ }
      }
      continue;
    }
    try {validateRecord(row.entity,row.data,{asOf:today()});}
    catch(error) {
      const field=error.message.match(/^[^.]+\.([^:]+):/)?.[1];
      if(field)reject(error.message,field,row.id);
      throw error;
    }
    const {entry_week:entryWeek,entry_created_at:createdAt}=row.data;
    if(entryWeek||createdAt) {
      const eligible=row.entity==='expense'?row.data.type==='GENERAL'&&!row.data.budget_item_id&&!row.data.trip_id&&!row.data.rule_id:
        row.entity==='cash_event'&&row.data.kind==='INCOME'&&!row.data.related_id&&!row.data.work_income_id;
      if(!eligible||!entryWeek||weekOf(entryWeek)!==entryWeek||calendarDay(entryWeek,6)!==row.data.date||
        !createdAt||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)||!Number.isFinite(Date.parse(createdAt)))
        reject('A weekly total needs its Sunday date and original creation time.','entry_week',row.id);
    }
    // Existing dated and duplicate legacy receipts keep their original meaning.
    const receiptWeek=row.entity==='cash_event'&&!row.data.work_income_id&&!row.data.related_id&&row.data.kind==='INCOME'&&
      (entryWeek??row.data.receipt_week);
    if(receiptWeek&&!row.data.voided) {
      const previous=weeklyAggregates.get(receiptWeek);
      if(previous&&(entryWeek||previous.data.entry_week))
        reject('A General Income total already exists for this week. Edit it in history.','entry_week',row.id,previous.id);
      weeklyAggregates.set(receiptWeek,row);
    }
    if(row.data.participants?.length && row.data.share!==undefined &&
      Math.abs(row.data.share-row.data.participants.find(participant=>participant.self).share)>0.000001) {
      reject('The personal share must match the participant marked as you.','participants',row.id);
    }
    for(const [key,entities] of Object.entries(links)) {
      const id=row.data[key];
      if(id && !entities.includes(records.get(id)?.entity)) reject(row.data.description+' has an invalid '+key,key,row.id,id);
    }
    if(row.entity==='expense'&&row.data.trip_id&&row.data.budget_item_id) {
      const budgetTrip=records.get(row.data.budget_item_id)?.data.trip_id;
      if(budgetTrip&&budgetTrip!==row.data.trip_id)reject('Choose the same journey for the expense and its linked budget item.','trip_id',row.id,row.data.budget_item_id);
    }
    if(row.entity==='expense'&&row.data.included_in_general_id) {
      const total=records.get(row.data.included_in_general_id);
      if(row.data.type!=='SPECIAL'||row.data.trip_id||row.data.budget_item_id||row.data.rule_id||
        total?.entity!=='expense'||total.data.type!=='GENERAL'||total.data.entry_week!==weekOf(row.data.date)||
        (total.data.account_id||null)!==(row.data.account_id||null)||total.data.currency!==row.data.currency||
        Boolean(total.data.fixed)!==Boolean(row.data.fixed)) {
        reject('An included expense needs a General total for the same week, currency, account and fixed-bill type.',
          'included_in_general_id',row.id,total?.id??row.data.included_in_general_id);
      }
      if(!row.data.voided) {
        const amount=(linkedExpenseCents.get(total.id)??0)+cents(row.data.amount);
        if(!Number.isSafeInteger(amount)||amount>cents(total.data.amount))
          reject('Included details exceed the General total. Review the amount or unlink the detail.','included_in_general_id',row.id,total.id);
        linkedExpenseCents.set(total.id,amount);
      }
    }
    if(row.data.after_balance===true && !row.data.balance_id) reject('Choose the confirmed balance for an after-balance payment.','balance_id',row.id);
    if(row.entity==='balance' && row.data.scope==='ACCOUNT' && !row.data.account_id)reject('Choose the account covered by this balance.','account_id',row.id);
    if(row.entity==='account_transfer' && row.data.from_account_id===row.data.to_account_id)reject('Choose two different accounts for an internal transfer.','to_account_id',row.id);
    if(row.entity==='cash_event') {
      const kind=row.data.kind, related=records.get(row.data.related_id);
      const {receipt_week,start_time,end_time,lesson_date,duration,work_income_id,included_work_ids=[]}=row.data;
      if(receipt_week&&(kind!=='INCOME'||weekOf(receipt_week)!==receipt_week||calendarDay(receipt_week,6)!==row.data.date||
        receipt_week>weekOf(today())))reject('The default receipt date must be Sunday of the selected week.','date',row.id);
      if((work_income_id||included_work_ids.length||start_time||end_time||lesson_date||duration||row.data.student_id)&&kind!=='INCOME')
        reject('Lesson details only apply to income receipts.','kind',row.id);
      if(included_work_ids.length&&(work_income_id||related?.entity==='grant'))
        reject('Choose a General Income receipt for included tutoring records.','included_work_ids',row.id);
      for(const id of row.data.voided?[]:work_income_id?[work_income_id]:included_work_ids) {
        const field=work_income_id?'work_income_id':'included_work_ids';
        const source=records.get(id);
        if(!(source?.entity==='income_entry'&&!source.data.period||source?.entity==='lesson'&&source.data.status==='CONFIRMED'))
          reject('The receipt needs an existing completed lesson or its earnings entry.',field,row.id,id);
        const lesson=source.entity==='income_entry'?records.get(source.data.source_id):source;
        const key=lesson?.entity==='lesson'?lesson.id:source.id;
        if(workReceipts.has(key))reject('A receipt is already linked to these earnings.',field,row.id,workReceipts.get(key));
        workReceipts.set(key,row.id);
      }
      const required=['LOAN_DRAW','LOAN_REPAYMENT'].includes(kind)?['loan']:
        kind==='REFUND'?['expense','cash_event']:kind==='SECURITY_PAYMENT'?['budget_item','trip_budget_item']:null;
      if(required && !required.includes(related?.entity)) reject('Choose the original related record for '+kind,'related_id',row.id,row.data.related_id);
      if(row.data.related_id && !related) reject('Related cash record was not found.','related_id',row.id,row.data.related_id);
      if(kind==='REFUND') {
        if(related.entity==='cash_event' && related.data.kind!=='SECURITY_PAYMENT') reject('Refunds require an expense or security deposit payment.','related_id',row.id,related.id);
        if(isSnapshotSettlement(related))reject('Link the refund to its actual payment. The wallet settlement is a cumulative estimate.','related_id',row.id,related.id);
        const refund=convertUnits(ledger,row.data.amount,row.data.currency,related.data.currency,row.data.date);
        if(refund===null)reject('Add a dated FX quote to reconcile this refund in the original payment currency.','currency',row.id,related.id);
        const previous=refunds.get(related.id);
        const total=(previous?.total??0)+refund;
        if(total>cents(related.data.amount)) reject('Refunds exceed the original payment.','amount',row.id,related.id,...(previous?.ids??[]));
        refunds.set(related.id,{total,ids:[...(previous?.ids??[]),row.id]});
      }
      if(['LOAN_DRAW','LOAN_REPAYMENT'].includes(kind)) {
        const principal=convertUnits(ledger,row.data.amount,row.data.currency,related.data.currency,row.data.date);
        if(principal===null)reject('Add a dated FX quote for this loan principal movement.','currency',row.id,related.id);
        const totals=kind==='LOAN_DRAW'?draws:repayments;
        totals.set(related.id,(totals.get(related.id)??0)+principal);
        if(operations.has(row.id)&&!loanChanges.has(related.id))loanChanges.set(related.id,row.id);
      }
    }
    if(row.entity==='bill_payment') {
      const key=row.data.rule_id+'/'+row.data.period_date;
      if(payments.has(key)) reject('This bill already has a payment on that date.','period_date',row.id,payments.get(key));
      payments.set(key,row.id);
    }
    if(row.entity==='lesson' && row.data.status!=='CANCELLED') {
      if(row.data.status==='CONFIRMED' && cents(row.data.income)===null) reject('Confirmed lessons require a stored income amount.','income',row.id);
      if(row.data.status==='CONFIRMED' && row.data.date>today()) reject('A future lesson cannot be confirmed as completed.','date',row.id);
      if(!row.data.start_time||row.data.duration==null)continue;
      let interval;
      try {interval=lessonInterval(row.data);}
      catch(error) {reject(error.message,'start_time',row.id);}
      const overlap=slots.find(slot=>interval.start<slot.end && interval.end>slot.start);
      if(overlap)reject('Lesson time conflicts with another lesson.','start_time',row.id,overlap.id);
      slots.push({...interval,id:row.id});
    }
  }
  for(const [id,paid] of repayments) if(paid>(draws.get(id)??0)) reject('Loan principal repayment exceeds the received principal.','amount',loanChanges.get(id),id);
  // Deleting parents cannot leave even legacy references pointing at removed IDs.
  for(const row of ledger.records) {
    for(const key of Object.keys(links)) if(row.data[key] && !records.has(row.data[key])) reject(row.data.description+' still references the removed record through '+key+'.',key,row.id,row.data[key]);
    if(row.entity!=='income_entry'||!row.data.source_id)continue;
    const source=records.get(row.data.source_id);
    if(!['lesson','student'].includes(source?.entity))reject(row.data.description+' needs an existing student or lesson source.','source_id',row.id,row.data.source_id);
    if(source.entity==='lesson'&&(!row.origin||row.origin.edited||!source.origin||source.origin.edited)&&
      (source.data.status!=='CONFIRMED'||row.data.amount!==source.data.income||row.data.date!==source.data.date||row.data.currency!==source.data.currency)) {
      reject('Update the lesson and its linked income together with the same date, currency and stored earnings.','amount',row.id,source.id);
    }
  }
}
export function generateSeries(ledger,from=today(),days=42) {
  const next=clone(ledger),added=[],conflicts=[];
  for(const series of ledger.records.filter(row=>row.entity==='lesson_series'&&row.data.active)) {
    for(let offset=0;offset<days;offset++) {
      const instant=new Date(Date.parse(from+'T00:00:00Z')+offset*86400000),date=instant.toISOString().slice(0,10);
      if(date<series.data.effective_from || date>(series.data.end_date??'9999-12-31') || instant.getUTCDay()!==series.data.weekday) continue;
      const exception=series.origin?.raw.exceptions?.[weekOf(date)];
      if(['skip','link'].includes(exception?.kind)||next.records.some(row=>row.entity==='lesson'&&row.data.series_id===series.id&&
        (row.data.date===date||row.origin?.raw.originalDate===date)))continue;
      const row={id:'series:'+series.id+':'+date,revision:1,entity:'lesson',data:{
        description:series.data.description,student_id:series.data.student_id,date,start_time:series.data.start_time,
        duration:series.data.duration,currency:series.data.currency,status:'PLANNED',series_id:series.id,
        time_zone:series.data.time_zone??'Asia/Hong_Kong',
        ...(series.data.rate_override!=null?{income:Math.round(series.data.rate_override*series.data.duration*100)/100}:{}),
        ...(Number.isFinite(exception?.at)?{start_at:new Date(exception.at).toISOString()}:{}),
      }};
      next.records.push(row);
      try {validateRelations(next);added.push(row.id);}
      catch(error) {next.records.pop();conflicts.push({date,description:series.data.description,message:error.message});}
    }
  }
  return {next,added,conflicts};
}
export function billOccurrences(ledger,from=today(),days=60) {
  const end=new Date(Date.parse(from+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const out=[];
  for(const row of ledger.records.filter(row=>row.entity==='fixed_bill_rule')) {
    const rule=row.data;
    const through=[end,rule.end_date??end,rule.active===false?today():end].sort()[0];
    let date=rule.due_date;
    if(date<from && rule.frequency==='WEEKLY') {
      const jump=Math.max(0,Math.floor((Date.parse(from)-Date.parse(date))/(7*86400000)));
      date=new Date(Date.parse(date)+jump*7*86400000).toISOString().slice(0,10);
    }
    if(date<from && rule.frequency==='MONTHLY') {
      const anchor=new Date(from+'T00:00:00Z');
      const last=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+1,0)).getUTCDate();
      anchor.setUTCDate(Math.min(Number(rule.due_date.slice(8)),last));
      date=anchor.toISOString().slice(0,10);
    }
    while(date<=through) {
      if(date>=from) {
        const paid=ledger.records.find(payment=>payment.entity==='bill_payment' &&
          payment.data.rule_id===row.id && payment.data.period_date===date);
        out.push({id:row.id,date,data:rule,paid});
      }
      if(rule.frequency==='ONCE') break;
      const current=new Date(date+'T00:00:00Z');
      if(rule.frequency==='WEEKLY') current.setUTCDate(current.getUTCDate()+7);
      else {
        const day=Number(rule.due_date.slice(8)),month=current.getUTCMonth()+1,year=current.getUTCFullYear();
        current.setUTCDate(1);current.setUTCMonth(month);
        const last=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth()+1,0)).getUTCDate();
        current.setUTCDate(Math.min(day,last));
      }
      date=current.toISOString().slice(0,10);
    }
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
export async function prepareBatch(ledger,source,{weeklyTransfer=false,budgetPlan=null}={}) {
  const batch=parseWtp(source,{asOf:today()}),hash=await batchHash(batch);
  const previous=ledger.batches.find(entry=>entry.id===batch.batch_id);
  if(previous) throw Error(previous.hash===hash?'This batch was already applied.':'This batch ID was used with different content.');
  const diff=previewWtp(batch,(entity,id)=>{
    const row=ledger.records.find(record=>record.id===id && record.entity===entity);
    return row?{revision:row.revision,data:row.data}:null;
  });
  if(budgetPlan)for(const change of diff) {
    if(change.op==='ADD'&&['budget_item','trip_budget_item'].includes(change.entity))change.after.scenario=budgetPlan;
  }
  if(weeklyTransfer) {
    for(const [index,change] of diff.entries()) {
      if(change.op!=='ADD')continue;
      const data=change.after;
      const generalExpense=change.entity==='expense'&&data.type==='GENERAL'&&
        !data.budget_item_id&&!data.trip_id&&!data.rule_id;
      const generalReceipt=change.entity==='cash_event'&&data.kind==='INCOME'&&
        Boolean(data.entry_week||data.receipt_week)&&!data.related_id&&!data.work_income_id;
      if(!generalExpense&&!generalReceipt)continue;
      const week=weekOf(data.date);
      if(data.date!==calendarDay(week,6)||(data.entry_week??data.receipt_week??week)!==week) {
        throw Error('$.operations['+index+'].data.date: Use the Sunday ending the selected week for a General total. Use Special for a recorded expense on its actual date.');
      }
      change.after={...data,entry_week:week,entry_created_at:new Date().toISOString()};
    }
  }
  const next=clone(ledger);
  const newIds=diff.map(()=>crypto.randomUUID());
  diff.forEach((change,index)=>{
    const original=next.records.findIndex(row=>row.id===change.record_id);
    if(change.entity==='expense'&&next.settings.legacy_expense_classes&&
      (change.op==='DELETE'||Object.hasOwn(batch.operations[index].changes??{},'type')))
      delete next.settings.legacy_expense_classes[change.record_id];
    if(change.op==='DELETE') next.records.splice(original,1);
    else if(change.op==='ADD') next.records.push({id:newIds[index],revision:1,entity:change.entity,data:change.after});
    else {
      const row=next.records[original];
      const preservePlan=['budget_item','trip_budget_item'].includes(row.entity)&&!row.budgetBaseline&&
        (row.entity==='trip_budget_item'||row.data.trip_id||ledger.settings.departure_date&&ledger.settings.departure_date<=today()||
          change.after.completed_on);
      const budgetBaseline=preservePlan?Object.fromEntries(['amount','currency','frequency','start_date','end_date','share','participants']
        .filter(key=>Object.hasOwn(row.data,key)).map(key=>[key,clone(row.data[key])])):row.budgetBaseline;
      next.records[original]={...row,revision:row.revision+1,
        origin:row.origin?{...row.origin,edited:true}:null,
        data:change.after,...(budgetBaseline?{budgetBaseline}:{}),...(change.entity==='balance'?{reconciliation:[]}:{} )};
    }
  });
  const existingIds=new Set(next.records.map(row=>row.id));
  for(const id of Object.keys(next.attachments??{})) if(!existingIds.has(id)) delete next.attachments[id];
  const operations=new Map(diff.map((change,index)=>[change.op==='ADD'?newIds[index]:change.record_id,{index,op:change.op}]));
  validateRelations(next,operations);
  const warnings=[];
  for(const change of diff.filter(change=>change.op==='ADD')) {
    if(change.entity==='document') warnings.push('Attach the local file for '+change.after.description+' after importing its metadata.');
    if(ledger.records.some(row=>row.entity===change.entity && row.data.description===change.after.description &&
      row.data.amount===change.after.amount && row.data.currency===change.after.currency &&
      row.data.date===change.after.date)) warnings.push('Possible duplicate '+change.after.description);
  }
  return {batch,hash,diff,next,warnings,before:financialModel(ledger),after:financialModel(next)};
}
export function mergeLegacy(ledger,raw,hash) {
  if(!ledger.legacy) throw Error('This ledger has no legacy migration source.');
  const before=migrateLegacy(ledger.legacy.raw,ledger.legacy.sourceHash,ledger.legacy.migrationVersion??1);
  const incoming=migrateLegacy(raw,hash),next=clone(ledger),changes=[],conflicts=[],conflictDetails=[];
  const old=new Map(before.records.map(row=>[row.id,row]));
  const latest=new Map(incoming.records.map(row=>[row.id,row]));
  for(const id of new Set([...old.keys(),...latest.keys()])) {
    const previous=old.get(id),source=latest.get(id),index=next.records.findIndex(row=>row.id===id);
    const current=next.records[index];
    if(JSON.stringify(previous?.data)===JSON.stringify(source?.data)) continue;
    if(previous&&!source&&next.records.some(row=>row.id!==id&&Object.entries(row.data).some(([key,value])=>
      key.endsWith('_id')&&value===id))) {
      conflicts.push(id);continue;
    }
    if(current && previous && JSON.stringify(current.data)!==JSON.stringify(previous.data) ||
      !current && previous && source) {
      conflicts.push(id);continue;
    }
    if(!source) {
      if(index>=0)next.records.splice(index,1);
      changes.push({id,op:'DELETE'});
    } else if(index<0) {
      next.records.push(source);changes.push({id,op:'ADD'});
    } else {
      next.records[index]={...source,revision:current.revision+1};
      changes.push({id,op:'UPDATE'});
    }
  }
  const derivationSources={...next.legacy.derivationSources};
  for(const id of conflicts) {
    const current=next.records.find(row=>row.id===id),source=latest.get(id);
    if(current?.origin&&!current.origin.edited&&!current.origin.sourceKey) {
      const version=ledger.legacy.migrationVersion??1,hash=ledger.legacy.sourceHash,key=version+':'+hash;
      derivationSources[key]={version,hash,raw:ledger.legacy.raw};
      current.origin.sourceKey=key;
    }
    conflictDetails.push({id,current:clone(current??null),source:clone(source??null)});
  }
  next.legacy={...incoming.legacy,original:ledger.legacy.original??{sourceHash:ledger.legacy.sourceHash,raw:ledger.legacy.raw},
    ...(Object.keys(derivationSources).length?{derivationSources}:{})};
  if(!conflicts.length) validateRelations(next);
  return {next,changes,conflicts,conflictDetails};
}
