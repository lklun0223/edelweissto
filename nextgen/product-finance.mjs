import {allocateWaterfall} from './coverage.mjs';
import {convert,isSnapshotSettlement,recordedMovements,today} from './ledger.mjs';

export function sumKnown(values) {
  if(values.some(value=>!Number.isSafeInteger(value)))return null;
  const total=values.reduce((sum,value)=>sum+value,0);
  return Number.isSafeInteger(total)?total:null;
}

export function difference(left,right) {
  return sumKnown([left,right===null?null:-right]);
}

export function budgetScope(row) {
  return row.data.trip_id||null;
}

export function planPosition(model,scope=null) {
  const obligations=model.obligations.filter((_,index)=>budgetScope(model.budgetRows[index])===scope);
  const total=sumKnown(obligations.map(item=>item.cents));
  return {...model,obligations,total,
    waterfall:allocateWaterfall(model.available,obligations),
    planned:allocateWaterfall(model.expected,obligations),
    cashPosition:difference(model.available,total),
    expectedPosition:difference(model.expected,total)};
}

export function travelCapacity(model,trips) {
  const vienna=planPosition(model);
  const selected=new Set(trips.filter(row=>row.data.status!=='CANCELLED').map(row=>row.id));
  const tripsOutstanding=sumKnown(model.obligations.filter((_,index)=>selected.has(budgetScope(model.budgetRows[index]))).map(row=>row.cents));
  return {cash:vienna.cashPosition,expected:vienna.expectedPosition,tripsOutstanding,
    cashAfter:difference(vienna.cashPosition,tripsOutstanding),expectedAfter:difference(vienna.expectedPosition,tripsOutstanding)};
}

export function tripActual(ledger,position,tripId,asOf=today()) {
  const costs=new Set(position.obligations.map(item=>item.id));
  const expenses=ledger.records.filter(row=>row.entity==='expense'&&row.data.trip_id===tripId&&
    !costs.has(row.data.budget_item_id)&&!row.data.voided&&row.data.date<=asOf&&!isSnapshotSettlement(row));
  const ids=new Set(expenses.map(row=>row.id));
  const refunds=ledger.records.filter(row=>row.entity==='cash_event'&&row.data.kind==='REFUND'&&
    ids.has(row.data.related_id)&&!row.data.voided&&row.data.date<=asOf);
  const value=row=>convert(ledger,row.data.amount,row.data.currency,row.data.date);
  return difference(sumKnown([...position.obligations.map(row=>row.paid),...expenses.map(value)]),sumKnown(refunds.map(value)));
}

function summarise(movements) {
  const values=kind=>movements.filter(row=>kind.includes(row.kind)).map(row=>row.cents);
  const observed=list=>list.length?sumKnown(list):null;
  const cash=values(['savings','financing','deposit']);
  const income=observed(values(['income']));
  const out=observed(values(['spending','refund']));
  return {income,spending:out===null?null:-out,otherCash:observed(cash),
    net:observed(movements.map(row=>row.cents))};
}

export function periodMoney(ledger,period,asOf=today()) {
  const date=new Date(asOf+'T00:00:00Z');
  const start=period==='month'?asOf.slice(0,7)+'-01':new Date(date.getTime()-((date.getUTCDay()+6)%7)*86400000).toISOString().slice(0,10);
  const actual=recordedMovements(ledger,asOf).filter(row=>row.date>=start&&(period==='week'||row.date.slice(0,7)===start.slice(0,7)));
  const end=actual.reduce((latest,row)=>row.date>latest?row.date:latest,asOf);
  const slices=[];
  const step=period==='month'?7:1;
  for(let time=Date.parse(start+'T00:00:00Z');time<=Date.parse(end+'T00:00:00Z');time+=step*86400000) {
    const from=new Date(time).toISOString().slice(0,10);
    const to=new Date(time+(step-1)*86400000).toISOString().slice(0,10);
    slices.push({from,to:to>end?end:to,...summarise(actual.filter(row=>row.date>=from&&row.date<=to))});
  }
  return {start,end,...summarise(actual),slices};
}
