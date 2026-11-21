((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkieExpense = api;
})(globalThis, () => {
  const types = ['GENERAL', 'SPECIAL'];
  const bills = ['rent', 'water', 'electricity', 'internet', 'phone', 'other'];
  const dayMs = 86_400_000;
  const money = (amount) => {
    if (typeof amount !== 'number' && (typeof amount !== 'string' || !amount.trim())) return null;
    const n = Number(amount), cents = Math.round(n * 100);
    return Number.isFinite(n) && Number.isSafeInteger(cents) ? cents : null;
  };
  const day = (text) => {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const ms = Date.parse(text + 'T00:00:00Z');
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text ? ms : null;
  };
  const dateText = ms => new Date(ms).toISOString().slice(0, 10);

  function manualExpense({description, date, amount, type, bill}, id, asOf) {
    description = String(description).trim();
    if (!description || description.length > 240) throw Error('請輸入 1 至 240 字的支出用途。');
    const when = day(date);
    if (when === null || day(asOf) === null || when > day(asOf)) throw Error('請輸入今天或較早的實際付款日期。');
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || money(amount) === null) throw Error('請輸入有效金額，最多兩位小數。');
    if (!types.includes(type) || (bill !== '' && !bills.includes(bill))) throw Error('請核對支出類型及固定賬單標籤。');
    return {id, purpose: description, date, amount: money(amount) / 100, currency:'HKD',
      type, fixed: bill !== '', bill: bill || null};
  }

  const settlement = row => row.provenance === 'snapshot' ||
    /-tracked$/.test(String(row.id)) || /[（(]來自追蹤[）)]/.test(String(row.purpose));
  function summarize(records, asOf) {
    const until = day(asOf);
    if (until === null) throw Error('Invalid as-of date');
    const since = until - 27 * dayMs;
    const monday = until - ((new Date(until).getUTCDay()+6)%7) * dayMs;
    const weeks = Array.from({length:5},(_,i)=>({start:dateText(monday-(4-i)*7*dayMs),
      actual:null, controllable:null, settlement:null}));
    const observations = new Map();
    let unknown = 0;
    const add = (a,b) => {
      const sum = a + b;
      if (!Number.isSafeInteger(sum)) throw Error('支出總額超出可用範圍。');
      return sum;
    };
    for (const row of records) {
      const when = day(row.date), cents = money(row.amount);
      if (when === null || cents === null || (row.currency && row.currency !== 'HKD')) {unknown++; continue;}
      if (when < since || when > until) continue;
      const index = 4 + Math.floor((when-monday)/(7*dayMs)), bucket=weeks[index];
      const field = settlement(row) ? 'settlement' : 'actual';
      bucket[field] = add(bucket[field] ?? 0, cents);
      if (field === 'actual' && row.type === 'GENERAL' && row.fixed === false && cents >= 0) {
        bucket.controllable = add(bucket.controllable ?? 0, cents);
        observations.set(row.date, add(observations.get(row.date) ?? 0, cents));
      }
    }
    const days = observations.size;
    const total = [...observations.values()].reduce(add,0);
    const projectedCents = days >= 3 ? Math.round(total / days * 7) : null;
    return {weeks:weeks.filter(row=>row.start>=dateText(monday - Math.ceil((monday-since)/(7*dayMs))*7*dayMs)),
      projectedCents:Number.isSafeInteger(projectedCents)?projectedCents:null, days, unknown,
      firstDate:dateText(since), asOf, lastObservation:[...observations.keys()].sort().at(-1) ?? null};
  }
  return Object.freeze({manualExpense, summarize});
});
