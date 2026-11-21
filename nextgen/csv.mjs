export function exportRecordsCsv(records) {
  const headers=['id','revision','entity','description','amount','currency','date','category','status','data_json'];
  function cell(value) {
    let text=value===null||value===undefined?'':String(value);
    if(typeof value==='string'&&/^[=+\-@\t\r]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }
  const lines=records.map(row=>{
    const data=row.data;
    return [row.id,row.revision,row.entity,data.description,data.amount,data.currency,data.date??data.as_of,
      data.category,data.status,JSON.stringify(data)].map(cell).join(',');
  });
  return '\ufeff'+[headers.map(cell).join(','),...lines].join('\r\n')+'\r\n';
}
