import {clone,validateRelations,activeBudget,convert,periodMultiplier,today,financialModel,quote} from './ledger.mjs';

export function plans(ledger) {
  const names=[...new Set([ledger.settings.scenario,...ledger.records.filter(row=>row.entity==='budget_item').map(row=>row.data.scenario??'Base'),
    ...(ledger.settings.scenarios??[]).map(row=>row.name)])];
  return names.map(name=>({name,archived:ledger.settings.scenarios?.find(row=>row.name===name)?.archived??false}));
}

export function changePlan(ledger,action,name,newName=null) {
  const next=clone(ledger),existing=plans(next);
  const selected=existing.find(row=>row.name===name);
  if(!selected)throw Error('Choose an existing budget scenario.');
  if(['RENAME','COPY'].includes(action)) {
    newName=newName?.trim();
    if(!newName||newName.length>100)throw Error('Enter a scenario name up to 100 characters.');
    if(existing.some(row=>row.name===newName))throw Error('A scenario already uses this name.');
  }
  if(action==='COPY') {
    const originals=next.records.filter(row=>row.entity==='budget_item'&&(row.data.scenario??'Base')===name);
    const source=next.legacy;
    const sourceKey=source?(source.migrationVersion??1)+':'+source.sourceHash:null;
    if(sourceKey&&originals.some(row=>row.origin&&!row.origin.edited&&!row.origin.sourceKey)) {
      source.derivationSources={...source.derivationSources,[sourceKey]:{raw:source.raw,hash:source.sourceHash,version:source.migrationVersion??1}};
    }
    const copies=originals.map(row=>({
      id:crypto.randomUUID(),revision:1,entity:row.entity,data:{...clone(row.data),scenario:newName},derivedFrom:row.id,
      ...(row.origin?{origin:{...clone(row.origin),scenario:newName,sourceRecordId:row.origin.sourceRecordId??row.id,
        ...(row.origin.edited||!sourceKey?{}:{sourceKey:row.origin.sourceKey??sourceKey})}}:{}),
    }));
    next.records.push(...copies);existing.push({name:newName,archived:false});next.settings.scenario=newName;
  }else if(action==='RENAME') {
    for(const row of next.records.filter(row=>row.entity==='budget_item'&&(row.data.scenario??'Base')===name)) {
      row.data.scenario=newName;row.revision++;if(row.origin)row.origin.scenario=newName;
    }
    selected.name=newName;
    if(next.settings.scenario===name)next.settings.scenario=newName;
  }else if(action==='ARCHIVE') {
    const replacement=existing.find(row=>row.name!==name&&!row.archived);
    if(!replacement)throw Error('Keep at least one active scenario. Create or duplicate another scenario first.');
    selected.archived=true;if(next.settings.scenario===name)next.settings.scenario=replacement.name;
  }else if(action==='RESTORE')selected.archived=false;
  else throw Error('Unknown budget scenario action.');
  next.settings.scenarios=existing;
  validateRelations(next);return next;
}

export function monthlyBudget(ledger) {
  const months=new Map(),undated=[];
  for(const row of ledger.records.filter(row=>['budget_item','trip_budget_item'].includes(row.entity)&&activeBudget(ledger,row))) {
    const data=row.data,recurring=data.frequency&&data.frequency!=='ONCE';
    const from=recurring?data.start_date:data.due_date,to=recurring?data.end_date:data.due_date;
    if(!from||!to||to<from){undated.push(row.id);continue;}
    const first=new Date(from.slice(0,7)+'-01T00:00:00Z'),last=to.slice(0,7);
    const lastTime=Date.parse(last+'-01T00:00:00Z');
    const share=data.participants?.find(row=>row.self)?.share??data.share??1;
    const unitCents=data.amount==null?null:Math.round(data.amount*100);
    const fullPeriod=periodMultiplier(data);
    const nativeTotal=unitCents===null?null:Math.round(unitCents*fullPeriod*share);
    const convertedTotal=nativeTotal===null?null:convert(ledger,nativeTotal/100,data.currency);
    let elapsedPeriod=0,allocated=0;
    for(let cursor=new Date(first);cursor.getTime()<=lastTime;cursor.setUTCMonth(cursor.getUTCMonth()+1)) {
      const lastDay=new Date(cursor);lastDay.setUTCMonth(lastDay.getUTCMonth()+1,0);
      const month=cursor.toISOString().slice(0,7),monthEnd=lastDay.toISOString().slice(0,10);
      const multiplier=recurring?periodMultiplier({...data,start_date:from>month+'-01'?from:month+'-01',end_date:to<monthEnd?to:monthEnd}):1;
      elapsedPeriod+=multiplier;
      const cumulative=convertedTotal===null?null:month===last?convertedTotal:
        convert(ledger,Math.round(unitCents*Math.min(fullPeriod,elapsedPeriod)*share)/100,data.currency);
      const value=cumulative===null?null:cumulative-allocated;
      if(cumulative!==null)allocated=cumulative;
      const current=months.get(month)??{month,cents:0,items:0};
      current.cents=current.cents===null||value===null||!Number.isSafeInteger(current.cents+value)?null:current.cents+value;current.items++;
      months.set(month,current);
    }
  }
  return {months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)),undated};
}

export function rateSensitivity(ledger) {
  const model=financialModel(ledger),asOf=today();
  return [-0.1,0,0.1].map(change=>{
    const valuation=clone(ledger);
    for(const currency of new Set(model.budgetRows.map(row=>row.data.currency).filter(currency=>currency!=='HKD'))) {
      const current=quote(ledger,currency);
      if(current)valuation.records.push({id:'sensitivity-'+currency,entity:'fx_quote',revision:1,
        data:{description:'Illustrative FX assumption',currency,rate:current.rate*(1+change),date:asOf,source:'Uncommitted sensitivity only'}});
    }
    const values=financialModel(ledger,asOf,valuation).obligations.map(row=>row.cents);
    const total=values.includes(null)?null:values.reduce((sum,value)=>sum+value,0);
    return {change,total,gap:total===null||model.available===null?null:Math.max(0,total-model.available)};
  });
}
