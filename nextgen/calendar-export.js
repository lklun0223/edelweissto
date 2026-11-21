((root, factory)=>{
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.WorkieCalendar=api;
})(globalThis, ()=>{
  const stamp=milliseconds=>new Date(milliseconds).toISOString()
    .replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const escapeText=text=>String(text).replace(/\\/g,'\\\\').replace(/\r\n|[\r\n]/g,'\\n')
    .replace(/([,;])/g,'\\$1');
  const encode=new TextEncoder();
  function fold(line) {
    let chunk='', size=0, out='';
    for(const character of line) {
      const bytes=encode.encode(character).length;
      if(size+bytes>75){out+=chunk+'\r\n';chunk=' ';size=1;}
      chunk+=character;size+=bytes;
    }
    return out+chunk;
  }
  function buildCalendar(entries,{resolve,now,defaultZone,includeNames=false}) {
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Workie//Tutoring Calendar//EN','CALSCALE:GREGORIAN'];
    let count=0, skipped=0;
    for(const entry of entries) {
      let times;
      try{times=resolve(entry.date,entry.startTime,entry.timeZone||defaultZone);}catch{times=[];}
      const from=times.includes(entry.occurrenceAt)?entry.occurrenceAt:times.length===1?times[0]:null;
      const length=Math.round(entry.duration*3_600_000);
      if(from===null || !Number.isSafeInteger(from) || !Number.isSafeInteger(length) || length<=0 ||
        length>86_400_000 || entry.id===null || entry.id===undefined) {skipped++;continue;}
      const title=includeNames&&entry.sourceName?'Tutoring · '+entry.sourceName:'Tutoring';
      lines.push('BEGIN:VEVENT','UID:'+encodeURIComponent(String(entry.id))+'@workie.local',
        'DTSTAMP:'+stamp(now),'DTSTART:'+stamp(from),'DTEND:'+stamp(from+length),
        'SUMMARY:'+escapeText(title),'CLASS:PRIVATE','END:VEVENT');
      count++;
    }
    lines.push('END:VCALENDAR');
    return {ics:lines.map(fold).join('\r\n')+'\r\n',count,skipped};
  }
  return Object.freeze({buildCalendar});
});
