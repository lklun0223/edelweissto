import {batchHash, parseWtp, previewWtp, schemaForPrompt} from './wtp.mjs';
import {prompt} from './wtp-prompt.mjs';

const transferable = row => row.currency==='HKD' && Number.isSafeInteger(row.revision) &&
  ['GENERAL','SPECIAL'].includes(row.type) && typeof row.fixed==='boolean' && typeof row.purpose==='string';
const context = row => ({description:row.purpose,date:row.date,amount:row.amount,currency:row.currency,
  type:row.type,fixed:row.fixed});
const money = amount => new Intl.NumberFormat('en-HK',{style:'currency',currency:'HKD',currencyDisplay:'code'}).format(amount/100);
const cent = value => Math.round(value*100);
const equivalent = row => JSON.stringify([row.description.trim(),row.date,row.amount,row.currency,row.type,!!row.fixed]);

export function expensePreview(batch, rows, stamps) {
  const id=batch.batch_id;
  const existingStamp=stamps.find(entry=>entry.id===id);
  if (existingStamp) throw Error('A transfer with this batch ID is already recorded. Check transfer history before retrying.');
  if (batch.operations.some(op=>op.entity!=='expense')) throw Error('This build accepts expense proposals only.');
  const diff=previewWtp(batch,(_,id)=>{
    const row=rows.find(row=>String(row.id)===id && transferable(row));
    return row ? {revision:row.revision,data:context(row)} : null;
  });
  const after = rows.filter(transferable).filter(row=>!diff.some(change=>change.record_id===String(row.id))).map(context);
  let cash=0, flexible=0;
  const contributes = row => row && row.type==='GENERAL' && !row.fixed ? cent(row.amount) : 0;
  for (const change of diff) {
    if (change.after) {
      change.after={...change.after,description:change.after.description.trim(),fixed:!!change.after.fixed};
      if (change.after.currency!=='HKD') throw Error('This build only accepts HKD expenses. No change was applied.');
      if (after.some(row=>equivalent(row)===equivalent(change.after))) {
        throw Error('An identical expense would already exist. Review the proposed changes or existing records.');
      }
      after.push(change.after);
    }
    cash += cent(change.after?.amount??0) - cent(change.before?.amount??0);
    flexible += contributes(change.after)-contributes(change.before);
    if (!Number.isSafeInteger(cash) || !Number.isSafeInteger(flexible)) throw Error('Expense change exceeds supported totals.');
  }
  return {diff,cash,flexible};
}

export function applyChanges(plan, rows, makeId) {
  // Build the next array without mutating any current row.
  const out = rows.slice();
  for (const change of plan.diff) {
    const index=change.record_id===undefined?-1:out.findIndex(row=>String(row.id)===change.record_id);
    if (change.op!=='ADD' && index<0) throw Error('The record changed before apply.');
    if (change.op==='DELETE') {out.splice(index,1); continue;}
    const previous=index<0?null:out[index], data=change.after;
    const {description,...fields}=data;
    const record={...previous,...fields,purpose:description,id:previous?.id??makeId(),
      bill:data.fixed ? previous?.bill??null : null,revision:(previous?.revision??0)+1};
    if (!Number.isSafeInteger(record.revision)) throw Error('Expense revision exceeds the supported range.');
    if (index<0) out.push(record); else out[index]=record;
  }
  return out;
}

function connect() {
  const root=document.querySelector('#workie-transfer');
  if (!root) return;
  const api=window.WorkieTransferExpense;
  const get=id=>root.querySelector('#wtp-'+id);
  const source=get('source'), status=get('status'), review=get('review'), apply=get('apply');
  const choices=get('choices'), copy=get('copy-records'), counts=get('history');
  let pending=null;
  const say=text=>{status.textContent=text;};
  const clear=()=>{pending=null;review.replaceChildren();apply.disabled=true;};
  function refresh() {
    const {rows,stamps}=api.read();
    choices.replaceChildren();
    for (const row of rows.filter(transferable).slice().sort((a,b)=>b.date.localeCompare(a.date))) {
      const label=document.createElement('label'), input=document.createElement('input');
      input.type='checkbox';input.value=String(row.id);
      label.append(input,document.createTextNode(` ${row.date} · ${row.purpose} · ${money(cent(row.amount))}`));
      choices.append(label);
    }
    copy.disabled=!choices.childElementCount;
    counts.replaceChildren();
    for (const entry of stamps.slice().reverse().slice(0,10)) {
      const item=document.createElement('li');
      item.textContent=`${entry.appliedAt} · ${entry.count} changes · ${entry.id}`;
      counts.append(item);
    }
  }
  const clipboard=async (value, success)=>{
    const fallback=get('copy-output');
    fallback.hidden=false;fallback.value=value;
    say('Text is ready to copy.');
    try{await navigator.clipboard.writeText(value);say(success);}
    catch{say('Clipboard unavailable. Select and copy the text from the box below.');}
  };
  get('copy-prompt').onclick=()=>clipboard(prompt+'\n\n'+
    'This build supports HKD expenses only. Do not export other proposed entities.\n'+schemaForPrompt(['expense']),'Instructions prepared.');
  copy.onclick=()=>{
    const ids=new Set([...choices.querySelectorAll('input:checked')].map(input=>input.value));
    if (!ids.size) {say('Select the expenses you want to share.');return;}
    const {rows,asOf}=api.read();
    clipboard(JSON.stringify({as_of:asOf,records:rows.filter(row=>ids.has(String(row.id))&&transferable(row)).map(row=>({
      record_id:String(row.id),expected_revision:row.revision,...context(row),
    }))},null,2),'Selected records prepared.');
  };
  source.addEventListener('input',clear);
  get('preview').onclick=async()=>{
    clear();
    const text=source.value;
    try {
      const {rows,stamps,asOf}=api.read();
      const batch=parseWtp(text,{asOf}), hash=await batchHash(batch);
      if (text!==source.value) return;
      const same=stamps.find(entry=>entry.id===batch.batch_id);
      if(same) throw Error(same.hash===hash?'This transfer was already applied.':'This batch ID already belongs to different changes.');
      const plan=expensePreview(batch,rows,stamps);
      const summary=document.createElement('p');
      const count=op=>plan.diff.filter(change=>change.op===op).length;
      summary.textContent=`Add ${count('ADD')} · Update ${count('UPDATE')} · Delete ${count('DELETE')}. Recorded outflow change ${money(plan.cash)}; controllable change ${money(plan.flexible)}.`;
      const list=document.createElement('ol');
      const describe=data=>data?`${data.description} · ${money(cent(data.amount))} · ${data.date} · ${data.type}${data.fixed?' · Fixed bill':''}`:'—';
      for (const change of plan.diff) {
        const item=document.createElement('li');
        item.textContent=`${change.op}: ${describe(change.before)} → ${describe(change.after)}`;
        list.append(item);
      }
      review.append(summary,list);
      say('Review each change. Edit the pasted JSON and preview again to make a correction.');
      pending={batch,hash,plan};
      apply.disabled=false;
      review.focus();
    } catch (error) {say(error.message);}
  };
  apply.onclick=async()=>{
    if (!pending) return;
    const {batch, hash, plan}=pending;
    apply.disabled=true;
    source.readOnly=true;get('preview').disabled=true;
    try {
      const saved=await api.commit(({rows,stamps,makeId,backup})=>{
        const current=expensePreview(batch,rows,stamps);
        if (JSON.stringify(plan)!==JSON.stringify(current)) throw Error('Records changed. Preview again before applying.');
        const next=applyChanges(current,rows,makeId);
        backup();
        return {rows:next,stamp:{id:batch.batch_id,hash,count:current.diff.length,appliedAt:new Date().toISOString()}};
      });
      clear();refresh();
      if (saved) say('Changes saved. A restore point is available in Settings → 自動資料備份.');
      else say('No changes saved. Preview again and check for conflicts or available storage.');
    } finally {source.readOnly=false;get('preview').disabled=false;}
  };
  get('refresh').onclick=refresh;
  refresh();
}

if (typeof document!=='undefined') connect();
