import {allocateWaterfall} from './coverage.mjs';

/**
 * Layout on one cumulative scale. This adapts the verified ledger calculation
 * for display without recomputing which category receives money.
 */
export function allocationView(model,{classifiedPreview=false}={}) {
  const partial=classifiedPreview&&model.waterfall.unclassified.length>0;
  const unclassified=new Set(model.waterfall.unclassified);
  const known=partial?model.obligations.filter(item=>!unclassified.has(item.id)):null;
  const actual=known?allocateWaterfall(model.available,known):model.waterfall;
  const projected=known?allocateWaterfall(model.expected,known):model.planned;
  const rows=actual.rows;
  const total=rows.reduce((sum,row)=>sum+(row.target??0),0);
  const drawable=!actual.unclassified.length&&rows.every(row=>row.target!==null)&&Number.isSafeInteger(total);
  const complete=drawable&&!partial;
  let start=0;
  return {complete,drawable,partial,unclassifiedCount:unclassified.size,total:drawable?total:null,rows:rows.map((row,index)=>{
    const expected=projected.rows[index].covered;
    const grant=expected===null||row.covered===null?null:Math.max(0,expected-row.covered);
    const width=drawable&&total>0?row.target/total*100:0;
    const result={...row,expected,grant,start,width,next:row.gap>0&&actual.next===row.id};
    start+=width;
    return result;
  })};
}

export function allocationDeltas(previous,current) {
  if(!previous.complete||!current.complete)return [];
  const transitions=[];
  for(const row of current.rows) {
    const old=previous.rows.find(item=>item.id===row.id);
    if(!old||old.target!==row.target||!row.target)continue;
    for(const field of ['covered','expected']) {
      if(old[field]===null||row[field]===null||old[field]===row[field])continue;
      transitions.push({id:row.id,field,from:old[field]/row.target,to:row[field]/row.target});
    }
  }
  return transitions;
}
