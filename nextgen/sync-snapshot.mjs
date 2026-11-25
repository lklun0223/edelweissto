import {digest,exportLedger,inspectBackup} from './repository.mjs';
import {clone} from './ledger.mjs';
import {calendarDay,weekOf} from './lesson-time.mjs';
import {equal,mergeRows} from './sync-shared.mjs';

const weekSettings=new Set(['sunday_savings','weekly_formula_incomes','weekly_formula_expenses',
  'weekly_openings','weekly_observations','weekly_settlements','weekly_observation_history','legacy_expense_classes']);
const sharedSettings=new Set(['scenario','scenarios','departure_date','return_date','expense_currency',
  'planning_basis','auto_fx','manual_eur_rate',...weekSettings]);
const utf8=new TextEncoder();
export const limit=700*1024;
const sourceId=legacy=>(legacy.migrationVersion??1)+':'+legacy.sourceHash;
const sorted=rows=>[...rows].sort(([a],[b])=>a<b?-1:a>b?1:0);
function sameSyncValue(a,b) {
  // Two devices can confirm the same WTP batch at different local times.
  if(a?.id?.startsWith('wtp:')&&a.id===b?.id&&a.data?.entry_week&&b.data?.entry_week) {
    const withoutSaveTime=row=>({...row,data:{...row.data,entry_created_at:null}});
    return equal(withoutSaveTime(a),withoutSaveTime(b));
  }
  return equal(a,b);
}
const sameSyncRows=(a,b)=>a.size===b.size&&[...a].every(([key,value])=>b.has(key)&&sameSyncValue(value,b.get(key)));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeKey=key=>key&&!['__proto__','constructor','prototype'].includes(key);
const recordsExist=rows=>[...rows.keys()].some(key=>key.startsWith('record/')||key.startsWith('sunday_savings/')||
  key.startsWith('weekly_'));
function declaration(row) {
  const {data,entity}=row??{};
  if(!data||data.voided||data.work_income_id||data.related_id||data.budget_item_id)return null;
  if(entity==='cash_event'&&data.kind==='INCOME')return (data.entry_week??data.receipt_week)?'income/'+(data.entry_week??data.receipt_week):null;
  if(entity==='expense'&&data.type==='GENERAL'&&data.entry_week)return 'expense/'+data.entry_week;
  return null;
}

export function projectSync(ledger) {
  const rows=new Map();
  for(const record of ledger.records) {
    if(record.entity==='document')continue;
    rows.set('record/'+record.id,projectedRecord(record,ledger.legacy));
  }
  for(const row of ledger.batches)rows.set('batch/'+row.id,{id:row.id,hash:row.hash});
  for(const key of sharedSettings) {
    if(!Object.hasOwn(ledger.settings,key))continue;
    const value=ledger.settings[key];
    if(weekSettings.has(key)) {
      for(const [date,figure] of Object.entries(value??{}))rows.set(key+'/'+date,figure);
    } else rows.set('setting/'+key,{value});
  }
  if(ledger.legacy) {
    const {migrationVersion=1,sourceHash,raw,derivationSources,selectively_seen,syncedSourceKeys}=ledger.legacy;
    rows.set('source/'+sourceId(ledger.legacy),{version:migrationVersion,hash:sourceHash,raw});
    for(const [id,source] of Object.entries(derivationSources??{})) {
      if(syncedSourceKeys?.includes(id)||[...rows.values()].some(row=>row?.origin?.sourceKey===id))rows.set('source/'+id,source);
    }
    for(const [source,ids] of Object.entries(selectively_seen??{})) {
      for(const id of ids)rows.set('seen/'+JSON.stringify([source,id]),{source,id});
    }
  }
  return rows;
}

async function hydrate(ledger,rows) {
  const next=clone(ledger);
  const existing=new Map(next.records.map(row=>[row.id,row]));
  next.records=next.records.filter(row=>row.entity==='document');
  const batches=new Map(next.batches.map(row=>[row.id,row]));
  next.batches=[];
  for(const key of sharedSettings)delete next.settings[key];
  const sources={},seen=new Map();
  for(const [key,value] of rows) {
    const split=key.indexOf('/'),family=key.slice(0,split),id=key.slice(split+1);
    if(split<1||!safeKey(id))throw Error('Invalid synced item key.');
    if(family==='record'&&plain(value)&&value.id===id&&value.entity!=='document') {
      if(existing.get(id)?.entity==='document')throw Error('A synced record matches a local attachment ID.');
      const before=existing.get(id);
      const projected=before&&projectedRecord(before,ledger.legacy);
      next.records.push({...clone(value),revision:before?(equal(projected,value)?before.revision:before.revision+1):1});
    } else if(family==='batch'&&plain(value)&&value.id===id) {
      const old=batches.get(id);
      if(old&&old.hash!==value.hash)throw Error('A transfer batch has a different checksum. Preserve both backups and review the source.');
      next.batches.push(old??clone(value));
    } else if(family==='setting'&&sharedSettings.has(id)&&!weekSettings.has(id)&&plain(value)&&Object.hasOwn(value,'value')) {
      next.settings[id]=clone(value.value);
    } else if(weekSettings.has(family)) {
      (next.settings[family]??={})[id]=clone(value);
    } else if(family==='source'&&plain(value)&&id===value.version+':'+value.hash&&typeof value.raw==='string'&&
      await digest(value.raw)===value.hash) {
      sources[id]=clone(value);
    } else if(family==='seen'&&plain(value)&&typeof value.id==='string'&&
      /^\d+:[a-f0-9]{64}$/.test(value.source)&&id===JSON.stringify([value.source,value.id])) {
      const ids=seen.get(value.source)??[];
      ids.push(value.id);seen.set(value.source,ids);
    } else throw Error('Unknown or unverified sync data.');
  }
  if(next.legacy) {
    next.legacy.derivationSources={...next.legacy.derivationSources,...sources};
  } else if(Object.keys(sources).length) {
    const source=Object.values(sources)[0];
    next.legacy={migrationVersion:source.version,sourceHash:source.hash,raw:source.raw,
      warnings:[],derivationSources:sources};
  }
  if(next.legacy){
    next.legacy.syncedSourceKeys=Object.keys(sources);
    const imported=next.legacy.selectively_seen??={};
    for(const [source,ids] of seen)imported[source]=[...new Set([...(imported[source]??[]),...ids])];
  }
  await inspectBackup(JSON.stringify(await exportLedger(next)));
  return next;
}

function projectedRecord(record,legacy) {
  const row=clone(record);
  delete row.revision;
  if(row.origin&&legacy&&!row.origin.sourceKey)row.origin.sourceKey=sourceId(legacy);
  return row;
}

export async function makeHead(rows,deleted,revision,operationId=crypto.randomUUID()) {
  const payload=JSON.stringify({rows:sorted(rows),deleted:[...deleted].sort()});
  const bytes=utf8.encode(payload).length;
  // Fixed document path, field names and metadata need substantially less than 2 KiB.
  if(bytes+2048>limit)throw Error('Workspace exceeds the 700 KiB sync limit. Local data is safe. Use complete backup handoff.');
  return {schema:1,revision,payload,checksum:await digest(payload),operationId};
}

export async function decodeHead(head) {
  if(!head)return {rows:new Map(),deleted:new Set(),revision:0};
  if(head.schema!==1||!Number.isSafeInteger(head.revision)||head.revision<1||
    typeof head.payload!=='string'||utf8.encode(head.payload).length+2048>limit||
    !/^[0-9a-f-]{36}$/.test(head.operationId)||head.checksum!==await digest(head.payload))throw Error('Cloud snapshot is invalid.');
  const {rows,deleted}=JSON.parse(head.payload);
  if(!Array.isArray(rows)||!rows.every(row=>Array.isArray(row)&&row.length===2&&typeof row[0]==='string'&&row[1]!==null)||
    !Array.isArray(deleted)||!deleted.every(key=>typeof key==='string'))throw Error('Invalid cloud rows.');
  const values=new Map(rows),removed=new Set(deleted);
  if(values.size!==rows.length||removed.size!==deleted.length||deleted.some(key=>values.has(key)))
    throw Error('Repeated cloud identity.');
  return {...head,rows:values,deleted:removed};
}

const binding='workie-sync-binding';
export function createSnapshotSync(transport,checkpoints,repository) {
  const owner=transport.owner,issued=new WeakMap();
  async function ownership(bind=false) {
    const existing=await checkpoints.load(binding);
    if(existing&&existing.owner!==owner)throw Error('This browser is linked to another Workie account. Use a separate browser profile.');
    if(bind&&!existing)await checkpoints.save(binding,{owner});
  }
  return {
    async state(){await ownership();return checkpoints.load(owner);},
    async preview(choices=new Map()) {
      await ownership();
      const ledger=await repository.read();
      const local=projectSync(ledger);
      const remote=await decodeHead(await transport.read());
      const cloudLedger=remote.revision?await hydrate({...ledger,records:[],attachments:{},legacy:null,
        settings:{...ledger.settings,timer:null}},remote.rows):null;
      const saved=await checkpoints.load(owner);
      if(saved?.revision>remote.revision||saved?.revision===remote.revision&&saved.checksum&&saved.checksum!==remote.checksum)
        throw Error('Cloud revision is older than or differs from this device’s checkpoint.');
      const pending=saved?.pending;
      const acknowledged=pending&&remote.operationId===pending.operationId&&remote.checksum===pending.checksum;
      if(pending&&!acknowledged&&remote.revision>pending.expected+1)
        throw Error('Cloud advanced beyond an interrupted operation. Keep both backups and review recovery.');
      const base=saved?.rows?new Map(saved.rows):null;
      const cloud=new Map(remote.rows);
      // An acknowledged upload may have merged other-device changes absent from
      // the previous local workspace. Replay only changes actually made since the upload.
      const mergeBase=acknowledged?new Map(pending.local):base;
      const candidates=new Map(local);
      if(!mergeBase&&remote.revision) {
        for(const key of [...candidates.keys()].filter(key=>key.startsWith('setting/'))) {
          if(!ledger.records.length&&!ledger.legacy&&!Object.keys(ledger.settings.sunday_savings??{}).length&&cloud.has(key))
            candidates.delete(key);
        }
      }
      const resurrected=[...remote.deleted].filter(key=>candidates.has(key)&&!mergeBase?.has(key));
      const conflicts=[];
      for(const key of resurrected) {
        if(choices.get(key)==='cloud')candidates.delete(key);
        else if(choices.get(key)!=='device')conflicts.push({key,device:candidates.get(key),cloud:null});
      }
      const effectiveChoices=new Map(choices);
      for(const [key,localValue] of candidates) {
        const other=cloud.get(key);
        if(key.startsWith('batch/')&&other&&other.hash!==localValue.hash)effectiveChoices.delete(key);
      }
      const merged=mergeRows(candidates,cloud,mergeBase,effectiveChoices,sameSyncValue);
      for(const conflict of merged.conflicts) {
        const {key,device,cloud:other}=conflict;
        conflict.keepBoth=key.startsWith('record/')&&device?.entity==='task'&&other?.entity==='task';
        if(conflict.keepBoth&&choices.get(key)==='both') {
          const id='sync-task-'+await digest([key,other]);
          merged.values.set(key,device);
          merged.values.set('record/'+id,{...other,id});
        } else conflicts.push(conflict);
      }
      const cloudDeclarations=new Map();
      for(const [key,row] of cloud) {
        const period=key.startsWith('record/')&&!candidates.has(key)&&declaration(row);
        if(period)cloudDeclarations.set(period,[...(cloudDeclarations.get(period)??[]),[key,row]]);
      }
      for(const [key,row] of candidates) {
        const period=key.startsWith('record/')&&!cloud.has(key)&&declaration(row);
        for(const [otherKey,other] of cloudDeclarations.get(period)??[]) {
          if(!merged.values.has(key)||!merged.values.has(otherKey))continue;
          const id='declaration/'+period+'/'+key+'/'+otherKey;
          const choice=choices.get(id);
          if(choice==='device')merged.values.delete(otherKey);
          else if(choice==='cloud')merged.values.delete(key);
          else conflicts.push({key:id,device:row,cloud:other});
        }
      }
      const changedWeeks=[...new Set([...conflicts.map(row=>row.key),...choices.keys()].map(key=>key.split('/'))
        .map(parts=>parts[0]==='declaration'?['weekly_observations',parts[2]]:parts)
        .filter(([family,date])=>weekSettings.has(family)&&family!=='legacy_expense_classes'&&/^\d{4}-\d{2}-\d{2}$/.test(date))
        .map(([,date])=>calendarDay(weekOf(date),6)))].sort();
      const plan={revision:ledger.revision,cloudRevision:remote.revision,cloudHash:remote.checksum,conflicts,first:!saved?.rows,
        uploads:!sameSyncRows(merged.values,cloud),localCount:ledger.records.length,cloudCount:cloudLedger?.records.length??0,
        weekly:changedWeeks,deviceLedger:ledger,cloudLedger};
      plan.empty=!remote.revision&&!recordsExist(merged.values);
      if(!conflicts.length&&!plan.empty) {
        const next=await hydrate(ledger,merged.values);
        plan.next=next;
        plan.hasChanges=!sameSyncRows(local,merged.values);
        issued.set(plan,{next,ledger,local,remote,saved,values:merged.values});
      }
      return Object.freeze(plan);
    },
    async apply(plan,{consent=false,active=()=>true}={}) {
      const prepared=issued.get(plan);
      if(!consent||!prepared)throw Error('Review and confirm this sync first.');
      issued.delete(plan);
      const {next,ledger,local,remote,saved,values}=prepared;
      let revision=ledger.revision;
      const assertFresh=async()=>{
        if(!active())throw Error('Sync was disconnected.');
        if((await repository.read()).revision!==revision)throw Error('This device changed. Review sync again.');
      };
      await ownership();await assertFresh();
      const observed=await decodeHead(await transport.read());
      if(observed.revision!==remote.revision||observed.checksum!==remote.checksum||observed.operationId!==remote.operationId)
        throw Error('The cloud changed. Review sync again.');
      await assertFresh();
      await ownership(true);
      if(plan.uploads) {
        if(recordsExist(remote.rows)&&!recordsExist(values))throw Error('Sync cannot clear the entire cloud workspace.');
        const deleted=new Set([...remote.deleted,...remote.rows.keys()].filter(key=>!values.has(key)));
        const head=await makeHead(values,deleted,remote.revision+1);
        if(!saved?.rows){
          await assertFresh();
          revision=(await repository.commit(revision,ledger,'Restore point before first cloud sync')).revision;
        }
        await checkpoints.save(owner,{...saved,pending:{expected:remote.revision,local:sorted(local),
          operationId:head.operationId,checksum:head.checksum}});
        await assertFresh();
        await transport.write(remote,head,assertFresh);
        const verified=await decodeHead(await transport.read());
        if(verified.operationId!==head.operationId||verified.checksum!==head.checksum)
          throw Error('Cloud acknowledgement changed. Review recovery before retrying.');
        Object.assign(observed,verified);
      }
      await assertFresh();
      if(plan.hasChanges)await repository.commit(revision,next,'Apply reviewed cloud changes');
      if(!active())throw Error('Sync was disconnected.');
      const result={revision:observed.revision,checksum:observed.checksum,operationId:observed.operationId,
        rows:sorted(values),syncedAt:new Date().toISOString()};
      await checkpoints.save(owner,result);
      return result;
    },
  };
}
