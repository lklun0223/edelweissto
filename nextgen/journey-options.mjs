/**
 * The reference value is only available when every item can be converted.
 * Preserve subtotals in the currencies recorded on the original estimates.
 */
export function journeyOptions(items,convertAmount) {
  const options=new Map();
  for(const item of items) {
    const data=item.data;
    const name=data.scenario??'Base';
    if(!options.has(name))options.set(name,{name,original:new Map(),reference:0});
    const option=options.get(name);
    const currency=data.currency||'';
    const original=option.original.has(currency)?option.original.get(currency):0;
    const cents=data.amount==null?null:Math.round(data.amount*100);
    option.original.set(currency,add(original,cents));
    option.reference=add(option.reference,convertAmount(data.amount,data.currency));
  }
  return [...options.values()];
}
function add(left,right) {
  return left===null||right===null||!Number.isSafeInteger(left+right)?null:left+right;
}
