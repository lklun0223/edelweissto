import {prepareBatch} from './ledger.mjs';
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
