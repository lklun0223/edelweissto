import {quote,today} from './ledger.mjs';

export const RATE_URL='https://api.frankfurter.dev/v2/rates?base=EUR&quotes=HKD&providers=ecb';
const source='European Central Bank via Frankfurter';
export function rateIsStale(rate,now=today()) {
  return !rate||Date.parse(now)-Date.parse(rate.date)>4*86400000;
}
export async function fetchReferenceRate({fetcher=fetch,now=today(),signal}={}) {
  const response=await fetcher(RATE_URL,{credentials:'omit',cache:'no-store',signal});
  if(!response.ok)throw Error('The exchange-rate provider returned HTTP '+response.status+'.');
  const result=await response.json();
  const row=Array.isArray(result)?result.find(entry=>entry.base==='EUR'&&entry.quote==='HKD'):null;
  const date=row&&new Date(row.date+'T00:00:00Z');
  if(!row||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(date.getTime())||
    date.toISOString().slice(0,10)!==row.date||row.date>now||!Number.isFinite(row.rate)||row.rate<=0||row.rate>1e9) {
    throw Error('The provider returned an invalid EUR/HKD reference rate.');
  }
  return {currency:'EUR',rate:row.rate,date:row.date,source,updated_at:new Date().toISOString()};
}
export function displayQuote(ledger,currency,asOf=today()) {
  const automatic=ledger.settings.auto_fx;
  return currency==='EUR'&&automatic?.enabled&&automatic.reference?.date<=asOf?
    automatic.reference:quote(ledger,currency,asOf);
}
export function valuationLedger(ledger,asOf=today()) {
  const automatic=ledger.settings.auto_fx;
  if(!automatic?.enabled||!automatic.reference||automatic.reference.date>asOf)return ledger;
  const {currency,rate,source}=automatic.reference;
  // This quote lives only in the estimate model. Recorded dated conversions
  // still resolve through the original ledger and its manual quote records.
  return {...ledger,records:[...ledger.records,{entity:'fx_quote',data:{currency,rate,source,date:asOf}}]};
}
