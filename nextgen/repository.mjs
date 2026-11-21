import {clone,emptyLedger,migrateLegacy,validateRelations} from './ledger.mjs';
import {validateSettlementHistory} from './weekly-settlement.mjs';
import {inspectLedger,stageLegacy,verifySnapshot} from './legacy-vault.mjs';

export async function digest(value) {
  const bytes=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function open() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('workie-nextgen-ledger',1);
    request.onupgradeneeded=()=>{
      request.result.createObjectStore('state');
      request.result.createObjectStore('restore',{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(Error('Close other Workie tabs before upgrading storage.'));
  });
}
export async function readLedger() {
  const db=await open();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('state','readonly'),request=tx.objectStore('state').get('current');
      tx.oncomplete=()=>resolve(request.result??null);
      tx.onabort=()=>reject(tx.error);
    });
  } finally {db.close();}
}
export async function commitLedger(expectedRevision,next,reason) {
  validateRelations(next);
  validateSettlementHistory(next.settings.weekly_settlements,next.settings.weekly_openings,next.settings.weekly_observations,
    next.settings.weekly_observation_history);
  const db=await open();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(['state','restore'],'readwrite'),store=tx.objectStore('state');
      let saved,error;
      store.get('current').onsuccess=event=>{
        try {
          const current=event.target.result;
          if((current?.revision??0)!==expectedRevision) throw Error('Another tab changed the records. Reload and review your changes again.');
          saved=clone(next);
          saved.revision=expectedRevision+1;
          const previous=new Map((current?.records??[]).map(row=>[row.id,row]));
          const incoming=new Map(saved.records.map(row=>[row.id,row]));
          const changes=[];
          for(const id of new Set([...previous.keys(),...incoming.keys()])) {
            const before=previous.get(id),after=incoming.get(id);
            if(before&&after&&before.revision===after.revision&&JSON.stringify(before.data)===JSON.stringify(after.data))continue;
            changes.push({record_id:id,entity:(after??before).entity,
              op:before?(after?'UPDATE':'DELETE'):'ADD',previous_revision:before?.revision??null,
              revision:after?.revision??null,before:before?clone(before.data):null,after:after?clone(after.data):null});
          }
          const history=new Map();
          for(const entry of [...(current?.audit??[]),...(saved.audit??[])]) {
            const key=entry.id??JSON.stringify(entry);
            const previousEntry=history.get(key);
            if(previousEntry&&JSON.stringify(previousEntry)!==JSON.stringify(entry))throw Error('An imported audit entry conflicts with this device history.');
            history.set(key,entry);
          }
          saved.audit=[...history.values(),{id:crypto.randomUUID(),at:new Date().toISOString(),reason,revision:saved.revision,
            changes,previous_source:current?.legacy?.sourceHash??null,source:saved.legacy?.sourceHash??null,
            ...(JSON.stringify(current?.settings)!==JSON.stringify(saved.settings)?
              {settings_before:current?clone(current.settings):null,settings_after:clone(saved.settings)}:{})}];
          if(current||reason!=='Activate legacy migration') {
            const restore=tx.objectStore('restore');
            restore.add({id:crypto.randomUUID(),at:new Date().toISOString(),reason,data:current??emptyLedger()});
            restore.getAll().onsuccess=event=>{
              const points=event.target.result.sort((a,b)=>b.at.localeCompare(a.at));
              for(const point of points.slice(20)) restore.delete(point.id);
            };
          }
          store.put(saved,'current');
        } catch(caught) {error=caught;tx.abort();}
      };
      tx.oncomplete=()=>resolve(saved);
      tx.onabort=()=>{
        const failure=error??tx.error;
        if(failure?.name==='QuotaExceededError') {
          reject(new Error('This device is out of browser storage. Your previous records are intact. Export a backup, free space and retry.',{cause:failure}));
        } else {
          reject(failure??Error('Storage write failed. Export a backup and check free storage.'));
        }
      };
    });
  } finally {db.close();}
}
export async function migrationPreview(storage,backup=null) {
  const localRaw=storage.getItem('tutoring_data');
  const localHash=localRaw===null?null:await digest(localRaw);
  let raw=localRaw;
  if(backup!==null) {
    const parsed=JSON.parse(backup.replace(/^\uFEFF/,''));
    raw=parsed?.format==='workie-legacy-snapshot'?(await verifySnapshot(parsed)).rawLedger:backup.replace(/^\uFEFF/,'');
    const {value}=inspectLedger(raw);
    if(!Array.isArray(value.sources)||!Array.isArray(value.records))
      throw Error('This file does not contain the original Workie students and income lists.');
  }
  if(raw===null) return {next:emptyLedger(),counts:{},sourceHash:null,localHash};
  const sourceHash=await digest(raw);
  const next=migrateLegacy(raw,sourceHash);
  const counts=Object.fromEntries([...new Set(next.records.map(row=>row.entity))]
    .map(entity=>[entity,next.records.filter(row=>row.entity===entity).length]));
  if(backup!==null&&localHash&&localHash!==sourceHash)
    next.legacy.original={sourceHash:localHash,raw:localRaw};
  return {next,counts,sourceHash,localHash,fromBackup:backup!==null};
}
export async function activateMigration(preview,storage) {
  if(await readLedger()) throw Error('This browser already has a NextGen ledger.');
  const current=storage.getItem('tutoring_data');
  if((current===null?null:await digest(current))!==(preview.fromBackup?preview.localHash:preview.sourceHash))
    throw Error('Legacy records changed. Preview migration again.');
  if(current!==null)await stageLegacy(storage);
  if(storage.getItem('tutoring_data')!==current)throw Error('Legacy records changed. Preview migration again.');
  // The raw source is committed in the same transaction as all migrated records.
  return commitLedger(0,preview.next,'Activate legacy migration');
}
export async function restorePoints() {
  const db=await open();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('restore','readonly'),request=tx.objectStore('restore').getAll();
      tx.oncomplete=()=>resolve(request.result.sort((a,b)=>b.at.localeCompare(a.at)));
      tx.onabort=()=>reject(tx.error);
    });
  } finally {db.close();}
}
export async function restoreLedger(id,expectedRevision) {
  const point=(await restorePoints()).find(row=>row.id===id);
  if(!point) throw Error('Restore point was not found.');
  const current=await readLedger();
  const next=clone(point.data);
  if(next.settings.timer?.running) {
    const timer=next.settings.timer;
    timer.elapsed+=Math.max(0,Date.parse(point.at)-timer.lastStart);
    timer.running=false;timer.lastStart=null;
  }
  if(next.settings.timer)next.settings.timer.requiresReview=true;
  // Retain consumed batch IDs and advance revisions so copied context cannot
  // become valid again after undo, deletion restoration, or a backup import.
  next.batches=[...new Map([...next.batches,...current.batches].map(row=>[row.id,row])).values()];
  for(const row of next.records) {
    const previous=current.records.find(record=>record.id===row.id);
    row.revision=Math.max(row.revision,previous?.revision??0,expectedRevision)+1;
  }
  return commitLedger(expectedRevision,next,'Restore '+point.at);
}
export async function exportLedger(ledger) {
  const payload=clone(ledger);
  const exportedAt=Date.now();
  if(payload.settings.timer) {
    const timer=payload.settings.timer;
    if(timer.running)timer.elapsed+=Math.max(0,exportedAt-timer.lastStart);
    timer.running=false;timer.lastStart=null;timer.requiresReview=true;
  }
  return {format:'workie-nextgen-backup',version:2,exportedAt:new Date(exportedAt).toISOString(),
    payload,checksum:await digest(payload)};
}
export async function inspectBackup(source) {
  const envelope=JSON.parse(source);
  if(envelope.format!=='workie-nextgen-backup' || envelope.version!==2 ||
    envelope.checksum!==await digest(envelope.payload)) throw Error('Backup format or checksum is invalid.');
  const state=envelope.payload;
  if(state?.version!==2 || !Array.isArray(state.records) || !Array.isArray(state.batches) ||
    !Number.isSafeInteger(state.revision) || typeof state.settings?.scenario!=='string' ||
    !Array.isArray(state.audit)) throw Error('Backup record structure is invalid.');
  if(state.records.some(row=>!row.id || !Number.isSafeInteger(row.revision) || row.revision<1)) throw Error('Backup contains invalid record identities.');
  if(state.legacy) {
    if(state.legacy.sourceHash!==await digest(state.legacy.raw)) throw Error('Original legacy source checksum does not match.');
    if(state.legacy.original && state.legacy.original.sourceHash!==await digest(state.legacy.original.raw)) throw Error('Initial legacy source checksum does not match.');
    const original=migrateLegacy(state.legacy.raw,state.legacy.sourceHash,state.legacy.migrationVersion??1);
    const originals=new Map(original.records.map(row=>[row.id,row]));
    const derivations=new Map();
    for(const [key,entry] of Object.entries(state.legacy.derivationSources??{})) {
      if(!entry||typeof entry.raw!=='string'||key!==entry.version+':'+entry.hash||entry.hash!==await digest(entry.raw)) {
        throw Error('A copied scenario source does not match its checksum.');
      }
      derivations.set(key,new Map(migrateLegacy(entry.raw,entry.hash,entry.version).records.map(row=>[row.id,row])));
    }
    for(const row of state.records.filter(row=>row.origin && !row.origin.edited)) {
      const sourceRows=row.origin.sourceKey?derivations.get(row.origin.sourceKey):originals;
      const source=sourceRows?.get(row.origin.sourceRecordId??row.id);
      let expected=source?.data;
      if(source?.entity==='budget_item'&&row.origin.scenario)expected={...expected,scenario:row.origin.scenario};
      if(!source || source.entity!==row.entity || JSON.stringify(expected)!==JSON.stringify(row.data)) {
        throw Error('A migrated legacy record does not match its preserved source.');
      }
    }
  } else if(state.records.some(row=>row.origin)) throw Error('Legacy provenance is missing.');
  if(state.batches.some(row=>typeof row.id!=='string' || !/^[a-f0-9]{64}$/.test(row.hash)) ||
    new Set(state.batches.map(row=>row.id)).size!==state.batches.length) throw Error('Transfer audit is invalid.');
  for(const [id,value] of Object.entries(state.attachments??{})) {
    if(!state.records.some(row=>row.entity==='document'&&row.id===id) || typeof value!=='string' ||
      !/^data:[^,]*;base64,[A-Za-z0-9+/=]*$/.test(value)) throw Error('Attached file is invalid.');
  }
  if(state.settings.timer?.running) {
    const exported=Date.parse(envelope.exportedAt);
    if(Number.isFinite(exported))state.settings.timer.elapsed+=Math.max(0,exported-state.settings.timer.lastStart);
    state.settings.timer.running=false;state.settings.timer.lastStart=null;state.settings.timer.requiresReview=true;
  }
  validateRelations(state);
  validateSettlementHistory(state.settings.weekly_settlements,state.settings.weekly_openings,state.settings.weekly_observations,
    state.settings.weekly_observation_history);
  return state;
}
