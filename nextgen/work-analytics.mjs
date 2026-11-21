import {cents,workIncome} from './ledger.mjs';

export function incomeTrend(ledger,months=6) {
  const recorded=workIncome(ledger).filter(row=>/^\d{4}-\d{2}$/.test(row.month));
  if(!recorded.length)return [];
  const end=new Date(recorded[0].month+'-01T00:00:00Z');
  return Array.from({length:months},(_,index)=>{
    const date=new Date(end);date.setUTCMonth(date.getUTCMonth()-months+index+1);
    const month=date.toISOString().slice(0,7);
    return {month,byCurrency:recorded.find(row=>row.month===month)?.byCurrency??[]};
  });
}

export function weeklyIncome(ledger) {
  const reported=ledger.records.filter(row=>row.entity==='income_entry'&&!row.data.period);
  const sources=new Set(reported.map(row=>row.data.source_id));
  const confirmed=ledger.records.filter(row=>row.entity==='lesson'&&row.data.status==='CONFIRMED'&&
    (!row.origin||row.origin.edited)&&!sources.has(row.id)).map(row=>({data:{...row.data,amount:row.data.income}}));
  const weeks=new Map();
  for(const {data} of [...reported,...confirmed]) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date??''))continue;
    const start=new Date(data.date+'T00:00:00Z');
    if(!Number.isFinite(start.getTime()))continue;
    start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
    const week=start.toISOString().slice(0,10),key=week+'/'+data.currency;
    const row=weeks.get(key)??{week,currency:data.currency,total:0,count:0};
    const value=cents(data.amount);
    row.total=value===null||row.total===null||!Number.isSafeInteger(row.total+value)?null:row.total+value;
    row.count++;weeks.set(key,row);
  }
  return [...weeks.values()].sort((a,b)=>b.week.localeCompare(a.week)||a.currency.localeCompare(b.currency));
}

export function studentAttendance(ledger,studentId) {
  const lessons=ledger.records.filter(row=>row.entity==='lesson'&&row.data.student_id===studentId);
  const confirmed=lessons.filter(row=>row.data.status==='CONFIRMED');
  const history=ledger.records.filter(row=>row.entity==='income_entry'&&row.data.source_id===studentId);
  const duration=row=>row.entity==='lesson'?row.data.duration:row.origin?.raw.duration;
  const sessions=[...confirmed,...history];
  const hours=sessions.reduce((sum,row)=>sum+(Number.isFinite(duration(row))?duration(row):0),0);
  const unknownHours=sessions.filter(row=>!Number.isFinite(duration(row))).length;
  const linked=ledger.records.filter(row=>row.entity==='income_entry'&&confirmed.some(lesson=>lesson.id===row.data.source_id));
  const earnings=[...history,...linked,...confirmed.filter(row=>!linked.some(entry=>entry.data.source_id===row.id))];
  const currencies=[...new Set(earnings.map(row=>row.data.currency))];
  const byCurrency=currencies.map(currency=>{
    const entries=earnings.filter(row=>row.data.currency===currency);
    const values=entries.map(row=>cents(row.entity==='lesson'?row.data.income:row.data.amount));
    return {currency,total:values.includes(null)?null:values.reduce((sum,value)=>sum+value,0)};
  });
  return {sessions:sessions.length,hours,unknownHours,byCurrency,
    planned:lessons.filter(row=>row.data.status==='PLANNED').length,
    cancelled:lessons.filter(row=>row.data.status==='CANCELLED').length,
    history:[...lessons,...history].sort((a,b)=>String(b.data.date).localeCompare(String(a.data.date)))};
}

// A manual lesson edit and its linked earnings are one reviewable transaction.
// Protocol callers submit the same explicit changes in their own batch.
export function lessonOperations(ledger,lesson,data=null) {
  const linked=ledger.records.filter(row=>row.entity==='income_entry'&&row.data.source_id===lesson.id);
  const operation=data?{op:'UPDATE',entity:'lesson',record_id:lesson.id,expected_revision:lesson.revision,changes:data}:
    {op:'DELETE',entity:'lesson',record_id:lesson.id,expected_revision:lesson.revision};
  return [operation,...linked.map(row=>data?.status==='CONFIRMED'?{
    op:'UPDATE',entity:'income_entry',record_id:row.id,expected_revision:row.revision,
    changes:{description:data.description,amount:data.income,currency:data.currency,date:data.date},
  }:{op:'DELETE',entity:'income_entry',record_id:row.id,expected_revision:row.revision})];
}

export function linkConfirmedIncome(ledger,lessonId) {
  const lesson=ledger.records.find(row=>row.id===lessonId&&row.entity==='lesson');
  if(lesson?.data.status!=='CONFIRMED'||ledger.records.some(row=>row.entity==='income_entry'&&row.data.source_id===lessonId))return;
  const {description,income,currency,date}=lesson.data;
  ledger.records.push({id:crypto.randomUUID(),revision:1,entity:'income_entry',data:{description,amount:income,currency,date,source_id:lessonId}});
}
