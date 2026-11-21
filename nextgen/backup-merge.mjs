import {clone,validateRelations} from './ledger.mjs';
import {retainWeeklyObservation} from './weekly-settlement.mjs';

const financialContext=row=>JSON.stringify([row?.reconciliation??null,row?.requiresReconciliation??false,row?.representedBy??null]);

export function backupChanges(current,incoming) {
  const existing=new Map(current.records.map(row=>[row.id,row]));
  const added=new Map(incoming.records.map(row=>[row.id,row]));
  const changes=[];
  for(const id of new Set([...existing.keys(),...added.keys()])) {
    const before=existing.get(id),after=added.get(id);
    const fileChanged=current.attachments?.[id]!==incoming.attachments?.[id];
    if(before?.entity===after?.entity&&JSON.stringify(before?.data)===JSON.stringify(after?.data)&&
      financialContext(before)===financialContext(after)&&!fileChanged)continue;
    changes.push({id,before,after,fileChanged,op:!before?'ADD':!after?'DELETE':'CONFLICT'});
  }
  return changes;
}

export function withTransferHistory(current,incoming) {
  const batches=new Map(current.batches.map(row=>[row.id,row]));
  for(const batch of incoming.batches) {
    if(batches.has(batch.id)&&batches.get(batch.id).hash!==batch.hash)throw Error('A transfer batch conflicts with this device history. Batch '+batch.id);
    batches.set(batch.id,clone(batch));
  }
  return [...batches.values()];
}

export function mergeBackup(current,incoming,useBackup) {
  const next=clone(current);
  for(const [end,versions] of Object.entries(incoming.settings.sunday_savings??{})) {
    const days=next.settings.sunday_savings??={};
    const existing=days[end]??[];
    if(existing.slice(0,versions.length).some((row,index)=>{
      const other=versions[index];
      return row.amount!==other.amount||row.at!==other.at;
    }))throw Error('Both backups contain different Sunday Savings histories for '+end+'. Use complete-backup replacement to choose the incoming history.');
    if(existing.length<versions.length)days[end]=clone(versions);
  }
  for(const [week,rows] of Object.entries(incoming.settings.weekly_observation_history??{})) {
    for(const row of rows)retainWeeklyObservation(next.settings,week,row);
  }
  if(incoming.settings.weekly_openings)next.settings.weekly_openings={...incoming.settings.weekly_openings,...next.settings.weekly_openings};
  if(incoming.settings.weekly_observations) {
    const observations=next.settings.weekly_observations??={};
    for(const [week,row] of Object.entries(incoming.settings.weekly_observations)) {
      const known=next.settings.weekly_settlements?.[week]?.length??0;
      const provided=incoming.settings.weekly_settlements?.[week]?.length??0;
      if(!observations[week]&&provided>=known)observations[week]=clone(row);
    }
  }
  if(incoming.settings.weekly_settlements) {
    const history=next.settings.weekly_settlements??={};
    for(const [week,versions] of Object.entries(incoming.settings.weekly_settlements)) {
      const existing=history[week]??[];
      const common=Math.min(existing.length,versions.length);
      if(existing.slice(0,common).some((row,index)=>JSON.stringify(row)!==JSON.stringify(versions[index]))) {
        throw Error('Both backups contain different confirmed values for '+week+'. Use the explicit complete-backup replacement if you intend to keep the incoming history.');
      }
      if(existing.length<versions.length)history[week]=clone(versions);
    }
  }
  next.batches=withTransferHistory(current,incoming);
  next.audit.push(...clone(incoming.audit));
  next.attachments??={};
  const incomingSource=incoming.legacy;
  let sourceKey=null;
  if(incomingSource) {
    if(!next.legacy)next.legacy=clone(incomingSource);
    else {
      const version=incomingSource.migrationVersion??1,hash=incomingSource.sourceHash;
      sourceKey=version+':'+hash;
      next.legacy.derivationSources={
        ...next.legacy.derivationSources,
        ...clone(incomingSource.derivationSources??{}),
        [sourceKey]:{version,hash,raw:incomingSource.raw},
      };
    }
  }
  for(const change of backupChanges(current,incoming)) {
    if(change.op==='DELETE'||change.op==='CONFLICT'&&!useBackup.has(change.id))continue;
    if(change.before&&change.before.entity!==change.after.entity)throw Error('The same record ID identifies different kinds of records. Keep the current record.');
    const row=clone(change.after);
    row.revision=Math.max(row.revision,change.before?.revision??0,current.revision)+1;
    if(row.origin&&!row.origin.edited&&!row.origin.sourceKey&&sourceKey)row.origin.sourceKey=sourceKey;
    const index=next.records.findIndex(record=>record.id===row.id);
    if(index>=0)next.records[index]=row;
    else next.records.push(row);
    delete next.attachments[row.id];
    if(incoming.attachments?.[row.id])next.attachments[row.id]=incoming.attachments[row.id];
  }
  validateRelations(next);
  return next;
}
