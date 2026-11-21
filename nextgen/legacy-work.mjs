import {possibleLessonTimes} from './lesson-time.mjs';

const money=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
const time=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value??'')?value:null;
const hours=value=>money(value)>0&&money(value)<=24?money(value):null;

function timing(raw) {
  const actual=raw.actualTiming;
  const zone=raw.timeZone??actual?.timeZone??'Asia/Hong_Kong';
  const start=time(raw.startTime),duration=hours(raw.duration),end=time(raw.endTime);
  const supplied=raw.occurrenceAt??actual?.startAt;
  let startAt=null;
  if(start&&Number.isFinite(supplied)) {
    try {
      const minute=Math.floor(supplied/60000)*60000;
      if(possibleLessonTimes(raw.date,start,zone).includes(minute))startAt=new Date(supplied).toISOString();
    } catch { /* The original value stays in the immutable source. */ }
  }
  return {start_time:start,end_time:end,duration,time_zone:zone,start_at:startAt};
}

export function migrateWorkDetails(result,input,add,studentIds) {
  const seriesIds=new Map();
  for(const [index,raw] of (input.workTools?.series??[]).entries()) {
    const id=add('lesson_series',{description:'Weekly lesson · '+(input.sources?.find(row=>String(row.id)===String(raw.sourceId))?.name??'Historical student'),
      student_id:studentIds.get(String(raw.sourceId))??'',weekday:(raw.weekday+1)%7,start_time:raw.startTime,duration:raw.duration,
      currency:'HKD',effective_from:raw.effectiveFrom,active:raw.active===true,time_zone:raw.timeZone??'Asia/Hong_Kong',
      rate_override:money(raw.rateOverride),note:raw.note??''},raw,'workTools/series/'+index);
    seriesIds.set(String(raw.id),id);
  }
  const lessons=new Map();
  const seriesFor=raw=>seriesIds.get(String(raw.seriesId))??null;
  for(const row of result.records) {
    const raw=row.origin.raw;
    if(row.entity==='student') {
      row.data.contact=raw.phone||raw.contact||'';
      row.data.address=raw.detailAddress||raw.address||'';
      row.data.note=raw.note??raw.notes??'';
    } else if(row.entity==='lesson') {
      const cancelled=raw.cancelled===true||/^(cancelled|canceled)$/i.test(raw.status??'');
      row.data={...row.data,...timing(raw),status:cancelled?'CANCELLED':row.data.status,
        series_id:seriesFor(raw),income:money(row.data.income),note:raw.note??''};
      if(raw.id!==undefined)lessons.set(String(raw.id),row);
    }
  }
  const lookup=new Map(result.records.map(row=>[row.id,row]));
  for(const entry of result.records.filter(row=>row.entity==='income_entry')) {
    const raw=entry.origin.raw;
    entry.data.amount=money(raw.income);
    entry.data.note=raw.note??'';
    const matched=raw.scheduledId===undefined?null:lessons.get(String(raw.scheduledId));
    if(matched?.data.status==='CANCELLED') {
      entry.data.source_id=studentIds.get(String(raw.sourceId))??null;
      continue;
    }
    if(matched) {
      matched.data.status='CONFIRMED';
      matched.data.income=entry.data.amount;
      if(raw.startTime!==undefined||raw.occurrenceAt!==undefined||raw.actualTiming)Object.assign(matched.data,timing({...matched.origin.raw,...raw}));
      entry.data.source_id=matched.id;
      continue;
    }
    const student=lookup.get(studentIds.get(String(raw.sourceId)));
    if(!student||!raw.date||entry.data.amount===null)continue;
    const id=add('lesson',{description:raw.sourceName??student.data.description,student_id:student.id,date:raw.date,
      ...timing(raw),status:'CONFIRMED',currency:'HKD',income:entry.data.amount,
      series_id:seriesFor(raw),note:raw.note??''},raw,'completed_lessons/'+entry.origin.path.split('/').at(-1));
    entry.data.source_id=id;
  }
}
