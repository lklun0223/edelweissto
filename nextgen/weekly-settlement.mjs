import {convert,expenseClassification,includedExpenseDetails,isSnapshotSettlement,recordedMovements,today} from './ledger.mjs';
import {calendarDay,wallTime,weekOf} from './lesson-time.mjs';
import {difference,sumKnown} from './product-finance.mjs';

export function confirmedWeek(ledger,week) {
  return ledger.settings.weekly_settlements?.[week]?.at(-1)??null;
}

export function latestSunday(asOf=today()) {
  const end=calendarDay(weekOf(asOf),6);
  return end<=asOf?end:calendarDay(end,-7);
}

function isSunday(date) {
  return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&
    calendarDay(date)===date&&new Date(date+'T00:00:00Z').getUTCDay()===0;
}

export function sundayVersions(settings,end) {
  const week=weekOf(end);
  const legacy=(settings.weekly_settlements?.[week]??[])
    .filter(row=>Number.isSafeInteger(row.observed)&&Number.isFinite(Date.parse(row.confirmed_at))&&wallTime(row.confirmed_at).date>=end)
    .map(row=>({amount:row.observed,at:row.confirmed_at,source:'CONFIRMED'}));
  const observation=settings.weekly_observations?.[week];
  if(observation?.as_of===end)legacy.push({amount:observation.amount,at:null,source:'OBSERVED'});
  return [...legacy,...(settings.sunday_savings?.[end]??[])];
}

export function saveSundaySavings(settings,end,amount,at=new Date().toISOString()) {
  if(!isSunday(end)||end>latestSunday()||!Number.isSafeInteger(amount)) {
    throw Error('Enter a valid amount for this Sunday or an earlier Sunday.');
  }
  if(sundayVersions(settings,end).at(-1)?.amount===amount)return false;
  const days=settings.sunday_savings??={};
  const history=days[end]??=[];
  history.push({version:1,revision:history.length+1,amount,at,source:'MANUAL'});
  return true;
}

export function sundayHistory(settings,asOf=today()) {
  const ends=new Set([...Object.keys(settings.sunday_savings??{}),
    ...[...Object.keys(settings.weekly_settlements??{}),...Object.keys(settings.weekly_observations??{})].map(week=>calendarDay(week,6))]);
  const balances=new Map();
  for(const end of [...ends].sort()) {
    if(end>asOf)continue;
    const saved=sundayVersions(settings,end).at(-1);
    if(saved)balances.set(end,saved.amount);
  }
  return [...balances].map(([end,balance],index)=>{
    const change=difference(balance,balances.get(calendarDay(end,-7))??null);
    return {end,balance,change,status:index===0?'Baseline':change===null?'Previous Sunday missing':'Saved'};
  });
}

export function validateSundaySavings(days) {
  if(days===undefined)return;
  const valid=(row,index,end)=>row?.version===1&&row.revision===index+1&&row.source==='MANUAL'&&
    Number.isSafeInteger(row.amount)&&typeof row.at==='string'&&Number.isFinite(Date.parse(row.at))&&wallTime(row.at).date>=end;
  if(!days||typeof days!=='object'||Array.isArray(days)||Object.entries(days).some(([end,versions])=>
    !isSunday(end)||end>latestSunday()||!Array.isArray(versions)||!versions.length||
    !versions.every((row,index)=>valid(row,index,end))))throw Error('Invalid Sunday Savings history.');
}

export function validateWeeklyFormulaExpenses(totals) {
  if(totals===undefined)return;
  if(!totals||typeof totals!=='object'||Array.isArray(totals)||Object.entries(totals).some(([end,value])=>
    !isSunday(end)||!Number.isSafeInteger(value)||value<0))throw Error('Invalid weekly expense totals.');
}
export function validateWeeklyFormulaIncomes(totals) {
  if(totals===undefined)return;
  const valid=value=>Number.isSafeInteger(value)&&value>=0||value&&Number.isSafeInteger(value.amount)&&value.amount>=0&&
    Array.isArray(value.included)&&new Set(value.included).size===value.included.length&&value.included.every(id=>typeof id==='string'&&id.length>0);
  if(!totals||typeof totals!=='object'||Array.isArray(totals)||Object.entries(totals).some(([end,value])=>
    !isSunday(end)||!valid(value)))throw Error('Invalid weekly income totals.');
}

export function setupSundays(asOf=today()) {
  const latest=latestSunday(asOf);
  const completed=latest===asOf?calendarDay(latest,-7):latest;
  return [21,14,7,0].map(days=>calendarDay(completed,-days));
}

export function isoWeek(week) {
  const thursday=calendarDay(week,3);
  const start=weekOf(thursday.slice(0,4)+'-01-04');
  return 1+Math.round((Date.parse(week)-Date.parse(start))/604800000);
}

// A formula total is a balance explanation. The recorded movements remain the
// sole source of actual cash transactions.
export function weeklyFormula(ledger,end,asOf=today(),draft={}) {
  const week=weekOf(end);
  const cutoff=end<asOf?end:asOf;
  const predecessor=calendarDay(end,-7);
  const openingObserved=sundayVersions(ledger.settings,predecessor).at(-1)?.amount??null;
  let opening=Object.hasOwn(draft,'opening')?draft.opening:openingObserved;
  if(!Object.hasOwn(draft,'opening')&&opening===null) {
    const anchor=sundayHistory(ledger.settings,predecessor).at(-1);
    if(anchor) {
      opening=anchor.balance;
      for(let date=calendarDay(anchor.end,7);date<=predecessor&&opening!==null;date=calendarDay(date,7)) {
        opening=weeklyFormula(ledger,date,asOf,{opening}).closing;
      }
    }
  }
  const observed=Object.hasOwn(draft,'observed')?draft.observed:end<=asOf?sundayVersions(ledger.settings,end).at(-1)?.amount??null:null;
  const ids=new Map(ledger.records.map(record=>[record.id,record]));
  const rows={income:[],expenses:[]};
  const deposit=record=>record.data.kind==='SECURITY_PAYMENT'||ids.get(record.data.budget_item_id)?.data.kind==='SECURITY_DEPOSIT';
  const specialOutflow=record=>deposit(record)||record.entity==='expense'&&expenseClassification(ledger,record)==='SPECIAL';
  for(const movement of recordedMovements(ledger,cutoff,{includeLegacyWeeklyEstimate:false})) {
    if(movement.date<week||movement.kind==='savings')continue;
    const record=ids.get(movement.id);
    const incoming=['INCOME','REFUND','LOAN_DRAW'].includes(record.data.kind)&&record.entity==='cash_event';
    rows[incoming?'income':'expenses'].push({...movement,record,grant:ids.get(record.data.related_id)?.entity==='grant',
      deposit:!incoming&&deposit(record)});
  }
  const aggregates=rows.income.filter(({record})=>(record.data.entry_week??record.data.receipt_week)===week&&!record.data.work_income_id);
  const actualIncome=rows.income.length?sumKnown(rows.income.map(row=>row.cents)):null;
  const declaredIncome=ledger.settings.weekly_formula_incomes?.[end]??null;
  const incomeTotal=Object.hasOwn(draft,'income')?draft.income:typeof declaredIncome==='object'&&declaredIncome!==null?
    sumKnown([declaredIncome.amount,...rows.income.filter(row=>!declaredIncome.included.includes(row.id)).map(row=>row.cents)]):declaredIncome;
  const hasTotal=Object.hasOwn(draft,'income')?draft.income!==null:declaredIncome!==null;
  const recordedIncome=hasTotal?incomeTotal:aggregates.length<=1?actualIncome:null;
  const expenseTotal=Object.hasOwn(draft,'expense')?draft.expense:ledger.settings.weekly_formula_expenses?.[end]??null;
  const historicalTotal=rows.expenses.some(({record})=>record.data.type==='GENERAL'&&record.data.entry_week===week)?
    difference(0,sumKnown(rows.expenses.map(row=>row.cents))):null;
  const recordedExpense=expenseTotal??historicalTotal??confirmedWeek(ledger,week)?.entered_expense??null;
  const included=includedExpenseDetails(ledger,cutoff);
  const special=sumKnown([
    ...rows.expenses.filter(({record})=>specialOutflow(record)).map(row=>difference(0,row.cents)),
    ...ledger.records.filter(row=>included.has(row.id)&&row.data.date>=week&&row.data.date<=cutoff&&
      !row.representedBy&&!isSnapshotSettlement(row)&&specialOutflow(row))
      .map(row=>convert(ledger,row.data.amount,row.data.currency,row.data.date)),
  ]);
  const inferExpense=recordedExpense===null?difference(sumKnown([opening,recordedIncome]),observed):null;
  const inferIncome=recordedIncome===null&&rows.income.length===0?difference(sumKnown([observed,recordedExpense]),opening):null;
  const income=recordedIncome??(inferIncome>=0?inferIncome:null);
  const expense=recordedExpense??(inferExpense>=0?inferExpense:null);
  const estimate=difference(sumKnown([opening,recordedIncome]),recordedExpense);
  const closing=observed??estimate;
  const reconciliation=difference(observed,estimate);
  const general=difference(expense,special);
  const change=difference(closing,opening);
  const estimatedChange=change!==null&&(observed===null||openingObserved===null);
  return {week,end,rows,opening,openingEstimated:opening!==null&&openingObserved===null,observed,expense,income,closing,special,general,reconciliation,
    recordedIncome,recordedExpense,actualIncome,incomeTotal,expenseTotal,estimate,inferExpense,inferIncome,change,estimatedChange,
    ambiguousIncome:!hasTotal&&aggregates.length>1,
    missingRates:special===null||[...rows.income,...rows.expenses].some(row=>row.cents===null)};
}

export function saveWeeklyIncomeTotal(ledger,end,amount,asOf=today()) {
  const included=weeklyFormula(ledger,end,asOf).rows.income.map(row=>row.id);
  (ledger.settings.weekly_formula_incomes??={})[end]={amount,included};
}

export function retainWeeklyObservation(settings,week,observation) {
  if(!observation||observation.as_of>=calendarDay(week,6))return;
  const history=settings.weekly_observation_history??={};
  const existing=history[week]??=[];
  if(!existing.some(row=>row.as_of===observation.as_of&&row.amount===observation.amount)) {
    existing.push({...observation});
    existing.sort((a,b)=>a.as_of.localeCompare(b.as_of));
  }
}

function settlementFigures({opening,income,expense,adjustments},observed,entered) {
  const cashBeforeExpenses=sumKnown([opening,income,adjustments]);
  const calculated=difference(cashBeforeExpenses,expense);
  const implied=difference(cashBeforeExpenses,observed);
  // An entered total or a balance-derived total replaces recorded spending in
  // the equation. Its variance never becomes another ledger transaction.
  const settledExpense=observed!==null?implied:entered??expense;
  const differenceForWeek=difference(income,settledExpense);
  const closing=observed??difference(cashBeforeExpenses,settledExpense);
  return {opening,income,expense,adjustments,observed,entered,calculated,implied,settledExpense,differenceForWeek,closing,
    discrepancy:difference(settledExpense,expense)};
}

export function settlementView(report) {
  const snapshot=report.confirmed;
  return snapshot&&!report.observation&&!report.preview?
    settlementFigures(snapshot,snapshot.observed,snapshot.entered_expense??null):report;
}

export function weeklySettlement(ledger,week,options={}) {
  const end=calendarDay(week,6);
  const confirmed=confirmedWeek(ledger,week);
  const preceding=confirmedWeek(ledger,calendarDay(week,-7));
  const observation=ledger.settings.weekly_observations?.[week]??null;
  const savedOpening=ledger.settings.weekly_openings?.[week];
  const openingPoint=typeof savedOpening==='number'?{amount:savedOpening,as_of:week,source:'INITIAL'}:savedOpening;
  const opening=preceding?preceding.closing:Object.hasOwn(options,'opening')?options.opening:
    confirmed?.opening??openingPoint?.amount??null;
  const observed=Object.hasOwn(options,'observed')?options.observed:observation?.amount??confirmed?.observed??null;
  const entered=Object.hasOwn(options,'entered')?options.entered:observation?null:confirmed?.entered_expense??null;
  const from=preceding?week:openingPoint?.as_of??week;
  const asOf=options.asOf??(Object.hasOwn(options,'observed')?(observed!==null&&today()<end?today():end):observation?.as_of??end);
  const entries=ledger.records.filter(row=>!row.data.voided&&row.data.date>=from&&row.data.date<=end);
  const byId=new Map(entries.map(row=>[row.id,row]));
  const allRows=new Map(ledger.records.map(row=>[row.id,row]));
  const movements=recordedMovements(ledger,asOf,{includeLegacyWeeklyEstimate:false}).filter(row=>byId.has(row.id));
  const rows={income:[],expenses:[],adjustments:[],neutral:[]};
  for(const movement of movements) {
    const record=byId.get(movement.id);
    const grant=allRows.get(record.data.related_id)?.entity==='grant';
    const key=movement.kind==='savings'?'neutral':
      movement.kind==='income'&&!grant?'income':
      ['expense','bill_payment'].includes(record.entity)?'expenses':'adjustments';
    rows[key].push({...movement,record,grant});
  }
  for(const record of entries) {
    if(record.entity==='account_transfer'&&record.data.date<=asOf)rows.neutral.push({record,kind:'transfer'});
  }
  const total=key=>sumKnown(rows[key].map(row=>row.cents));
  const income=total('income'), expense=difference(0,total('expenses'));
  const adjustments=total('adjustments'),net=difference(income,expense);
  const changed=Boolean(confirmed&&(confirmed.opening!==opening||confirmed.income!==income||
    confirmed.expense!==expense||confirmed.adjustments!==adjustments));
  return {week,end,from,asOf,openingPoint,confirmed,preceding,observation,preview:options.preview===true,rows,net,changed,
    ...settlementFigures({opening,income,expense,adjustments},observed,entered)};
}

export function settlementVersion(report,confirmedAt=new Date().toISOString(),note='') {
  const {opening,income,expense,adjustments,observed,entered,calculated,closing}=report;
  if(calculated===null||closing===null)throw Error('Enter an opening balance and resolve any unavailable cash amounts before confirming.');
  if(entered!==null&&(!Number.isSafeInteger(entered)||entered<0||observed!==null)) {
    throw Error('Enter a valid weekly expense or an actual closing balance.');
  }
  if(report.implied!==null&&report.implied<0)throw Error('This closing balance implies negative expenses. Check receipts and other cash movements first.');
  if(report.end>today())throw Error('Confirm the weekly balance on Sunday or later.');
  if(report.asOf<report.end)throw Error('A midweek balance cannot confirm a Sunday settlement.');
  return {opening,income,expense,adjustments,observed,closing,confirmed_at:confirmedAt,
    ...(note?{note}:{}),
    ...(entered===null?{}:{entered_expense:entered})};
}

export function weeklyHistory(ledger,asOf=today()) {
  const weeks=new Set([...Object.keys(ledger.settings.weekly_settlements??{}),
    ...Object.keys(ledger.settings.weekly_observations??{})]);
  for(const row of recordedMovements(ledger,asOf,{includeLegacyWeeklyEstimate:false})) weeks.add(weekOf(row.date));
  for(const row of ledger.records) {
    if(!row.data.voided&&row.data.entry_week&&row.data.entry_week<=weekOf(asOf))weeks.add(row.data.entry_week);
  }
  return [...weeks].sort().map(week=>{
    const report=weeklySettlement(ledger,week,{asOf:ledger.settings.weekly_observations?.[week]?.as_of??calendarDay(week,6)});
    const figures=settlementView(report);
    return {week,end:report.end,asOf:report.observation?.as_of??report.end,needsReview:report.changed,
      opening:figures.opening,income:figures.income,expense:figures.settledExpense,
      change:difference(figures.closing,figures.opening),closing:figures.closing,
      status:report.observation?'Observed':report.confirmed?'Confirmed':figures.closing===null?'Missing balance':'Estimate'};
  });
}

export function weeklyTimeline(rows) {
  if(!rows.length)return [];
  const items=new Map(rows.map(row=>[row.week,row]));
  const result=[];
  for(let week=rows[0].week;week<=rows.at(-1).week;week=calendarDay(week,7)) {
    result.push(items.get(week)??{week,end:calendarDay(week,6),opening:null,income:null,
      expense:null,change:null,closing:null,status:'Missing week'});
  }
  return result;
}

export function dependentSettlements(ledger,week,newClosing) {
  const results=[];
  let opening=newClosing;
  for(let next=calendarDay(week,7);;next=calendarDay(next,7)) {
    const saved=confirmedWeek(ledger,next);
    if(!saved||opening===null||opening===saved.opening)break;
    const revised=settlementFigures({...saved,opening},saved.observed,saved.entered_expense??null);
    results.push({week:next,before:saved.closing,after:revised.closing});
    opening=revised.closing;
  }
  return results;
}

export function validateSettlementHistory(history,openings,observations,previousObservations) {
  const validWeek=week=>/^\d{4}-\d{2}-\d{2}$/.test(week)&&weekOf(week)===week;
  const validObservation=(week,row)=>row&&Number.isSafeInteger(row.amount)&&/^\d{4}-\d{2}-\d{2}$/.test(row.as_of)&&
    weekOf(row.as_of)===week&&calendarDay(row.as_of)===row.as_of;
  if(previousObservations!==undefined&&(!previousObservations||typeof previousObservations!=='object'||
    Array.isArray(previousObservations)||Object.entries(previousObservations).some(([week,rows])=>
      !validWeek(week)||!Array.isArray(rows)||!rows.length||rows.some(row=>!validObservation(week,row)||row.as_of===calendarDay(week,6))))) {
    throw Error('Invalid historical savings observations.');
  }
  if(observations!==undefined) {
    if(!observations||typeof observations!=='object'||Array.isArray(observations)||
      Object.entries(observations).some(([week,row])=>!validWeek(week)||!validObservation(week,row)))throw Error('Invalid observed savings.');
  }
  if(openings!==undefined) {
    if(!openings||typeof openings!=='object'||Array.isArray(openings)||
      Object.entries(openings).some(([week,point])=>!/^\d{4}-\d{2}-\d{2}$/.test(week)||weekOf(week)!==week||
        !(Number.isSafeInteger(point)||point&&Number.isSafeInteger(point.amount)&&
          /^\d{4}-\d{2}-\d{2}$/.test(point.as_of)&&calendarDay(point.as_of)===point.as_of&&
          weekOf(point.as_of)===week&&['INITIAL','IMPORTED'].includes(point.source)))) {
      throw Error('Invalid saved weekly openings.');
    }
  }
  if(history===undefined)return;
  if(!history||typeof history!=='object'||Array.isArray(history))throw Error('Invalid weekly settlement history.');
  for(const [week,versions] of Object.entries(history)) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(week)||weekOf(week)!==week||!Array.isArray(versions)||!versions.length) {
      throw Error('Invalid weekly settlement date or history.');
    }
    for(const row of versions) {
      const entered=row?.entered_expense??null;
      if(!row||!['opening','income','expense','adjustments','closing'].every(key=>Number.isSafeInteger(row[key]))||
        row.income<0||row.expense<0||!Number.isFinite(Date.parse(row.confirmed_at))||
        row.note!==undefined&&(typeof row.note!=='string'||row.note.length>2000)||
        row.observed!==null&&!Number.isSafeInteger(row.observed)||
        entered!==null&&(!Number.isSafeInteger(entered)||entered<0||row.observed!==null)||
        row.closing!==settlementFigures(row,row.observed,entered).closing) {
        throw Error('Invalid confirmed weekly settlement figures.');
      }
    }
  }
}
