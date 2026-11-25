export const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export const equal = (a,b) => JSON.stringify(canonical(a??null)) === JSON.stringify(canonical(b??null));

export function mergeRows(local,remote,base,choices=new Map(),same=equal) {
  const values=new Map(),conflicts=[];
  for(const key of new Set([...local.keys(),...remote.keys(),...(base?.keys()??[])])) {
    const a=local.get(key)??null,b=remote.get(key)??null, before=base?.get(key)??null;
    let value;
    if(same(a,b))value=a;
    else if(!base&&a===null)value=b;
    else if(!base&&b===null)value=a;
    else if(base&&same(a,before))value=b;
    else if(base&&same(b,before))value=a;
    else if(choices.get(key)==='device')value=a;
    else if(choices.get(key)==='cloud')value=b;
    else {conflicts.push({key,device:a,cloud:b});continue;}
    if(value!==null)values.set(key,value);
  }
  return {values,conflicts};
}

export function indexedDBCheckpoints() {
  const access=(owner,method,value)=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('workie-sync-checkpoints',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('owners');
    open.onerror=()=>reject(open.error);
    open.onblocked=()=>reject(Error('Close older Workie tabs to open the sync checkpoint.'));
    open.onsuccess=()=>{
      const db=open.result;
      const tx=db.transaction('owners',method==='put'?'readwrite':'readonly');
      const store=tx.objectStore('owners');
      const req=method==='put'?store.put(value,owner):store.get(owner);
      tx.oncomplete=()=>{db.close();resolve(req.result??null);};
      tx.onabort=()=>{db.close();reject(tx.error??Error('Could not save the sync checkpoint.'));};
    };
  });
  return {load:owner=>access(owner,'get'),save:(owner,value)=>access(owner,'put',value)};
}
