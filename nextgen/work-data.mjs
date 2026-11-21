import {clone,emptyLedger} from './ledger.mjs';
import {digest,exportLedger,inspectBackup} from './repository.mjs';

const workEntities=new Set(['student','lesson','lesson_series','income_entry']);
const legacyKeys=['sources','records','scheduled'];

async function projectLegacy(raw,version) {
  const data=JSON.parse(raw);
  const entries=Object.fromEntries(legacyKeys.filter(key=>Array.isArray(data[key])).map(key=>[key,data[key]]));
  if(version>=4&&Array.isArray(data.workTools?.series))entries.workTools={series:data.workTools.series};
  const projected=JSON.stringify(entries);
  const hash=await digest(projected);
  return {raw:projected,hash,version};
}

export async function exportWorkData(ledger) {
  const snapshot=emptyLedger();
  snapshot.scope='work';
  snapshot.revision=ledger.revision;
  snapshot.records=clone(ledger.records.filter(row=>workEntities.has(row.entity)));
  if(ledger.legacy) {
    const source=await projectLegacy(ledger.legacy.raw,ledger.legacy.migrationVersion);
    const original=await projectLegacy(ledger.legacy.original?.raw??ledger.legacy.raw,source.version);
    snapshot.legacy={raw:source.raw,sourceHash:source.hash,migrationVersion:source.version,
      original:{raw:original.raw,sourceHash:original.hash},derivationSources:{}};
    const sourceKeys=new Map();
    for(const row of snapshot.records.filter(record=>record.origin?.sourceKey)) {
      const key=row.origin.sourceKey;
      if(!sourceKeys.has(key)) {
        const legacy=ledger.legacy.derivationSources?.[key];
        if(!legacy)throw Error('A Work record is missing its legacy source.');
        const item=await projectLegacy(legacy.raw,legacy.version);
        const safeKey=item.version+':'+item.hash;
        snapshot.legacy.derivationSources[safeKey]=item;
        sourceKeys.set(key,safeKey);
      }
      row.origin.sourceKey=sourceKeys.get(key);
    }
  }
  return exportLedger(snapshot);
}
export async function inspectWorkData(text) {
  return requireWorkScope(await inspectBackup(text));
}
export function requireWorkScope(snapshot) {
  if(snapshot.scope!=='work'||snapshot.records.some(row=>!workEntities.has(row.entity))||
    snapshot.batches.length||snapshot.audit.length||Object.keys(snapshot.attachments??{}).length) {
    throw Error('Choose a Work data file. Full workspace backups can be reviewed in Settings.');
  }
  return snapshot;
}
