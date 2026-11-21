export const HONG_KONG='Asia/Hong_Kong';

export function calendarDay(date,offset=0) {
  return new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
}
export function weekOf(date) {
  return calendarDay(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));
}
export function wallTime(instant,zone=HONG_KONG) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return {date:value.year+'-'+value.month+'-'+value.day,time:value.hour+':'+value.minute,
    year:Number(value.year),month:Number(value.month),day:Number(value.day),hour:Number(value.hour),minute:Number(value.minute)};
}
export function possibleLessonTimes(date,time,zone='Asia/Hong_Kong') {
  const [year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
  const naive=Date.UTC(year,month-1,day,hour,minute),offsets=new Set();
  for(const delta of [-2,0,2]) {
    const probe=naive+delta*86400000,wall=wallTime(probe,zone);
    offsets.add(Date.UTC(wall.year,wall.month-1,wall.day,wall.hour,wall.minute)-probe);
  }
  return [...offsets].map(offset=>naive-offset).filter(instant=>{
    const wall=wallTime(instant,zone);
    return wall.date===date&&wall.time===time;
  }).sort((a,b)=>a-b);
}
export function lessonInterval(data) {
  if(!data.start_time||!Number.isFinite(data.duration)||data.duration<=0)throw Error('Lesson timing is unspecified.');
  const candidates=possibleLessonTimes(data.date,data.start_time,data.time_zone??'Asia/Hong_Kong');
  const explicit=data.start_at?Date.parse(data.start_at):null;
  const start=explicit!==null&&candidates.includes(Math.floor(explicit/60000)*60000)?explicit:candidates.length===1?candidates[0]:null;
  if(start===null) throw Error(candidates.length?'This local time occurs twice. Supply the verified start_at instant.':'This local time does not exist in the selected time zone.');
  return {start,end:start+data.duration*3600000};
}

export function manualTimerStart(date,time,now=Date.now()) {
  if(!date||!time)throw Error('Enter the lesson date and start time.');
  const [start]=possibleLessonTimes(date,time,HONG_KONG);
  if(!Number.isFinite(start)||start>now)throw Error('Choose a Hong Kong start time at or before now.');
  if(now-start>86400000)throw Error('For lessons over 24 hours, enter the earnings separately.');
  return start;
}
