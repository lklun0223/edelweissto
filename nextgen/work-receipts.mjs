import {convert,prepareBatch} from './ledger.mjs';
import {calendarDay,weekOf} from './lesson-time.mjs';
import {linkConfirmedIncome} from './work-analytics.mjs';

export const prepareOperations=(ledger,operations)=>prepareBatch(ledger,JSON.stringify({
  protocol:'workie-transfer',version:1,batch_id:crypto.randomUUID(),operations,
}));

export function generalReceipt(row) {
  return row?.entity==='cash_event'&&row.data.kind==='INCOME'&&!row.data.voided&&!row.data.related_id&&!row.data.work_income_id;
}

export function workReceipt(ledger,earning) {
  const key=row=>ledger.records.some(lesson=>lesson.entity==='lesson'&&lesson.id===row?.data.source_id)?row.data.source_id:row?.id;
  const expected=key(earning);
  const related=id=>id===expected||key(ledger.records.find(row=>row.id===id))===expected;
  return ledger.records.find(row=>row.entity==='cash_event'&&row.data.kind==='INCOME'&&!row.data.voided&&
    (row.data.work_income_id&&related(row.data.work_income_id)||row.data.included_work_ids?.some(related)));
}

export function unconfirmedLegacyReceipts(ledger,from,to) {
  return ledger.records.filter(row=>row.entity==='income_entry'&&row.origin&&!row.data.period&&
    row.data.date>=from&&row.data.date<=to&&row.data.amount>0&&!workReceipt(ledger,row));
}
export function includeReceiptInWeeklyTotal(ledger,receipt) {
  const end=calendarDay(weekOf(receipt.data.date),6);
  const totals=ledger.settings.weekly_formula_incomes;
  if(!totals||!Object.hasOwn(totals,end))return false;
  if(typeof totals[end]==='number')totals[end]={amount:totals[end],included:[]};
  if(!totals[end].included.includes(receipt.id))totals[end].included.push(receipt.id);
  return true;
}

export async function confirmLegacyReceipts(ledger,earnings) {
  const changes=new Map(),operations=[];
  for(const row of earnings) {
    if(workReceipt(ledger,row))continue;
    const week=weekOf(row.data.date);
    const aggregates=ledger.records.filter(receipt=>generalReceipt(receipt)&&
      (receipt.data.entry_week??receipt.data.receipt_week)===week);
    if(aggregates.length>1)throw Error('Resolve multiple weekly income totals before confirming these receipts.');
    const aggregate=aggregates[0];
    if(!aggregate){
      operations.push({op:'ADD',entity:'cash_event',data:{description:row.data.description,kind:'INCOME',
        amount:row.data.amount,currency:row.data.currency,date:row.data.date,lesson_date:row.data.date,work_income_id:row.id}});
      continue;
    }
    const included=changes.get(aggregate)??new Set(aggregate.data.included_work_ids??[]);
    included.add(row.id);
    changes.set(aggregate,included);
  }
  for(const [row,included] of changes) {
    const total=convert(ledger,row.data.amount,row.data.currency,row.data.date);
    const amounts=[...included].map(id=>{
      const earning=ledger.records.find(record=>record.id===id);
      return earning?convert(ledger,earning.data.amount??earning.data.income,earning.data.currency,earning.data.date):null;
    });
    if(total===null||amounts.includes(null)||amounts.reduce((sum,value)=>sum+value,0)>total)
      throw Error('Historical receipts exceed the existing weekly income total or require an exchange rate.');
    operations.push({op:'UPDATE',entity:'cash_event',record_id:row.id,expected_revision:row.revision,
      changes:{included_work_ids:[...included]}});
  }
  if(!operations.length)return ledger;
  const {next}=await prepareOperations(ledger,operations);
  for(const row of next.records.slice(ledger.records.length))includeReceiptInWeeklyTotal(next,row);
  return next;
}

export async function setIncludedWork(ledger,receiptId,workId,included=true) {
  const receipt=ledger.records.find(row=>row.id===receiptId);
  if(!generalReceipt(receipt))throw Error('Choose an existing General Income receipt.');
  const links=new Set(receipt.data.included_work_ids??[]);
  if(included)links.add(workId);else links.delete(workId);
  const {next}=await prepareOperations(ledger,[{op:'UPDATE',entity:'cash_event',record_id:receipt.id,
    expected_revision:receipt.revision,changes:{included_work_ids:[...links]}}]);
  return next;
}

export async function addSpecialIncome(ledger,data,receiptId,{receipt=null}={}) {
  const {next}=await prepareOperations(ledger,[{op:'ADD',entity:'lesson',data}]);
  const lesson=next.records.at(-1);
  linkConfirmedIncome(next,lesson.id);
  if(receipt) {
    const {next:withReceipt}=await prepareOperations(next,[{op:'ADD',entity:'cash_event',data:{
      ...receipt,kind:'INCOME',description:data.description,amount:data.income,currency:data.currency,
      lesson_date:data.date,student_id:data.student_id,work_income_id:lesson.id,
    }}]);
    return withReceipt;
  }
  return receiptId?setIncludedWork(next,receiptId,lesson.id):next;
}
