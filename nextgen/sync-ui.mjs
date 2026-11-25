import {emptyLedger,today} from './ledger.mjs';
import {readLedger,commitLedger} from './repository.mjs';
import {createSnapshotSync} from './sync-snapshot.mjs';
import {indexedDBCheckpoints} from './sync-shared.mjs';
import {loadFirebase,writesEnabled} from './sync-firebase.mjs';
import {weeklyFormula,sundayHistory} from './weekly-settlement.mjs';
import {planningModel,planPosition} from './product-finance.mjs';
import {valuationLedger} from './rates.mjs';

const preference='workie-sync-auto';
const storage=indexedDBCheckpoints();
const repository={read:async()=>await readLedger()??emptyLedger(),commit:commitLedger};
const statusNames={
  local:'Local only · 僅限本機',busy:'Syncing · 同步中',synced:'Synced · 已同步',
  offline:'Offline · 離線',conflict:'Conflict · 有衝突',error:'Error · 發生錯誤',
};
const label=(value)=>value.replaceAll('_',' ');

export function mountSync({h,button,dialog,adopt,blocked,draftOpen,lang}) {
  let sdk,loading,user,transport,engine,checkpoint,unsubscribe,unobserve,busy,review,resuming;
  let generation=0,timer,host,status='local',message='',dirty=false,auto=false,remoteDirty=false;
  const t=(en,zh)=>lang()==='zh-Hant'?zh:en;
  const set=(state,detail='')=>{status=state;message=detail;draw();};
  const stop=()=>{
    generation++;
    unsubscribe?.();unsubscribe=null;
    clearTimeout(timer);
    checkpoint=null;engine=null;transport=null;review=null;dirty=false;remoteDirty=false;
  };
  async function account(current) {
    stop();user=current;
    if(!current){auto=false;set('local');return;}
    transport=sdk.transport(current.uid);
    engine=createSnapshotSync(transport,storage,repository);
    const token=generation;
    try {
      const saved=await engine.state();
      if(token!==generation)return;
      checkpoint=saved;
      auto=localStorage.getItem(preference)===transport.owner&&Boolean(saved?.rows);
      set(navigator.onLine?'local':'offline');
      listen();schedule();
    } catch(error) {if(token===generation)set('error',error.message);}
  }
  async function connect() {
    if(loading)return;
    if(blocked())return set('error',t('Review local migration before connecting.','請先檢視本機遷移。'));
    if(!navigator.onLine)return set('offline');
    loading=true;draw();
    try {
      sdk??=await loadFirebase();
      unobserve??=sdk.observe(current=>void account(current));
      await sdk.signIn();
    } catch(error) {set('error',error.code??error.message);}
    finally {loading=false;draw();}
  }
  async function disconnect() {
    localStorage.removeItem(preference);
    auto=false;
    stop();user=null;set('local');
    try {await sdk.signOut();}catch(error){set('error',error.code??error.message);}
  }
  function listen() {
    unsubscribe?.();unsubscribe=null;
    if(!writesEnabled||!auto||!transport||!checkpoint?.rows)return;
    const token=generation;
    unsubscribe=transport.listen(revision=>{
      if(token===generation&&revision!==checkpoint?.revision){
        dirty=true;
        if(busy)remoteDirty=true;else schedule();
      }
    },error=>{if(token===generation)set('error',error.code??error.message);});
  }
  function schedule() {
    if(!writesEnabled||!auto||!engine||busy||review?.conflicts.length)return;
    clearTimeout(timer);
    timer=setTimeout(()=>{if(!draftOpen()&&!blocked())void sync(false);},950);
  }
  async function locked(action) {
    if(busy)return;
    if(!navigator.locks)return set('error',t('This browser cannot coordinate safe sync between tabs.','此瀏覽器無法安全協調分頁同步。'));
    busy=true;draw();
    const token=generation;
    const active=()=>token===generation&&Boolean(user);
    try {
      await navigator.locks.request('workie-sync-workspace',{ifAvailable:true},async lock=>{
        if(!lock||!active())return;
        await action(active);
      });
    } catch(error) {
      if(active()){review=null;set(navigator.onLine?'error':'offline',error.message);}
    } finally {
      busy=false;draw();
      if(remoteDirty){remoteDirty=false;schedule();}
    }
  }
  async function applied(plan,active) {
    if(!writesEnabled)throw Error('Security Rules verification is required before cloud sync can be applied.');
    set('busy');
    const result=await engine.apply(plan,{consent:true,active});
    if(!active())return;
    checkpoint=result;
    review=null;dirty=false;
    if(plan.hasChanges||plan.first&&plan.uploads)await adopt();
    set('synced');
  }
  async function sync(manual) {
    if(!engine||blocked())return;
    if(!navigator.onLine)return set('offline');
    await locked(async active=>{
      set('busy');
      const plan=await engine.preview();
      if(!active())return;
      review=plan;
      if(plan.conflicts.length||plan.first||manual||plan.empty) {
        set(plan.conflicts.length?'conflict':'local');
        if(manual)show(plan);
      } else if(!plan.hasChanges&&!plan.uploads&&checkpoint?.revision===plan.cloudRevision&&!checkpoint?.pending) {
        dirty=false;set('synced');
      } else await applied(plan,active);
    });
  }
  function describe(value,key) {
    if(value===null)return t('Removed or missing','已移除或沒有資料');
    if(Array.isArray(value)&&value.at(-1)?.amount!==undefined)return 'HKD '+(value.at(-1).amount/100).toFixed(2);
    if(key.startsWith('weekly_formula_')&&typeof (value.amount??value)==='number')return 'HKD '+((value.amount??value)/100).toFixed(2);
    return typeof value==='object'?JSON.stringify(value):String(value);
  }
  function comparison(conflict) {
    const {device,cloud,key}=conflict;
    const a=device?.data??device,b=cloud?.data??cloud;
    const fields=a&&!Array.isArray(a)&&typeof a==='object'&&b&&!Array.isArray(b)&&typeof b==='object'&&
      (device?.data||cloud?.data)?[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])):[];
    const values=fields.length?fields.map(field=>[label(field),describe(a[field]??null,key),describe(b[field]??null,key)]):
      [[t('Value','數值'),describe(a,key),describe(b,key)]];
    return h('div',{class:'ng-sync-compare'},...values.map(([field,local,remote])=>
      h('div',{},h('strong',{},field),h('span',{},local),h('span',{},remote))));
  }
  const weeklyDisplay=(state,end)=>{
    if(!state)return '—';
    const week=weeklyFormula(state,end);
    return [week.opening,week.income,week.expense,week.closing].map(amount=>amount===null?'—':(amount/100).toFixed(2))
      .reduce((text,value,index)=>text+(['',' + ',' − ',' = '][index])+value,'HKD ');
  };
  function show(initial) {
    const token=generation;
    let plan=initial;
    const choices=new Map();
    dialog(t('Review sync','檢視同步'),(sheet,close)=>{
      const body=h('div',{class:'ng-sync-review'});
      const showPlan=()=>{
        const weekly=plan.weekly.map(end=>h('div',{class:'ng-sync-week'},
          h('strong',{},end),
          h('p',{},t('This device','本機')+' · '+weeklyDisplay(plan.deviceLedger,end)),
          h('p',{},t('Cloud','雲端')+' · '+weeklyDisplay(plan.cloudLedger,end)),
          plan.next?h('p',{},t('Merged','合併後')+' · '+weeklyDisplay(plan.next,end)):null));
        body.replaceChildren(
          h('p',{},plan.cloudRevision===0?t('The server confirmed there is no cloud workspace.','伺服器確認沒有雲端工作區。'):
            t('Cloud revision','雲端版本')+' '+plan.cloudRevision),
          h('p',{},t('This device','本機')+' '+plan.localCount+' · '+t('Cloud','雲端')+' '+plan.cloudCount+
            (plan.next?' · '+t('Merged records','合併紀錄')+' '+plan.next.records.length:'')),
          plan.empty?h('p',{},t('There are no financial or work records to sync.','沒有可同步的財務或工作紀錄。')):null,
          ...weekly,
          ...plan.conflicts.map(conflict=>{
            const select=h('select',{onchange:event=>choices.set(conflict.key,event.target.value)},
              h('option',{value:''},t('Choose a version','選擇版本')),
              h('option',{value:'device'},t('Keep this device','保留本機')),
              h('option',{value:'cloud'},t('Keep cloud version','保留雲端')),
              conflict.keepBoth?h('option',{value:'both'},t('Keep both','兩者皆保留')):null);
            return h('section',{},h('h3',{},conflict.device?.data?.description??conflict.cloud?.data?.description??label(conflict.key)),
              h('div',{class:'ng-sync-compare'},h('div',{},h('span',{}),h('strong',{},t('This device','本機')),h('strong',{},t('Cloud','雲端')))),
              comparison(conflict),h('label',{class:'ng-field'},h('span',{},t('Resolution','處理方式')),select));
          }),
          plan.next?h('p',{},t('Merged planned outlays','合併後計劃開支')+' · '+(()=>{
            const total=planPosition(planningModel(plan.next,sundayHistory(plan.next.settings).at(-1),today(),valuationLedger(plan.next))).total;
            return total===null?t('Unavailable','未能計算'):'HKD '+(total/100).toFixed(2);
          })()):null,
          plan.next&&plan.first?h('p',{},t('Confirming links this browser ledger to this Google account. Workie keeps a local restore point before the first upload.',
            '確認後會將本機帳簿連結至此 Google 帳戶。首次上載前會建立還原點。')):null,
          !writesEnabled?h('p',{},t('Cloud writes are disabled until Security Rules are verified.','驗證安全規則前，雲端寫入已停用。')):null);
        const notice=h('p',{role:'alert'});
        const next=button(plan.conflicts.length?t('Preview choices','預覽選擇'):t('Confirm sync','確認同步'),async()=>{
          if(token!==generation||!user)return void close();
          next.disabled=true;
          if(plan.conflicts.length) {
            try {
              if(plan.conflicts.some(row=>!choices.get(row.key)))throw Error(t('Choose a version for every conflict.','請選擇每項衝突的版本。'));
              const fresh=await engine.preview();
              if(fresh.revision!==plan.revision||fresh.cloudRevision!==plan.cloudRevision||fresh.cloudHash!==plan.cloudHash){
                plan=fresh;choices.clear();showPlan();return;
              }
              const resolved=await engine.preview(choices);
              if(resolved.revision!==plan.revision||resolved.cloudRevision!==plan.cloudRevision||resolved.cloudHash!==plan.cloudHash){
                plan=await engine.preview();choices.clear();
              } else plan=resolved;
              showPlan();
            } catch(error) {notice.textContent=error.message;next.disabled=false;}
          } else {
            await close();
            await locked(async active=>{
              try {await applied(plan,active);}
              catch(error) {
                if(!active()||!/changed.*review/i.test(error.message))throw error;
                const fresh=await engine.preview();
                if(!active())return;
                review=fresh;
                set(fresh.conflicts.length?'conflict':'local',t('Data changed. Review the refreshed comparison.',
                  '資料已變更。請檢視更新後的比較。'));
                show(fresh);
              }
            });
          }
        });
        next.disabled=plan.empty||!plan.conflicts.length&&!writesEnabled;
        body.append(notice,h('div',{class:'ng-actions'},next,button(t('Cancel','取消'),()=>void close())));
      };
      sheet.append(body);showPlan();
    },{quick:true});
  }
  function draw() {
    if(!host?.isConnected)return;
    const current=!navigator.onLine&&user?'offline':status;
    const badge=host.closest('details')?.querySelector('.ng-section-value');
    if(badge)badge.textContent=writesEnabled?statusNames[current]:'LOCAL_ONLY';
    const toggle=h('input',{type:'checkbox',disabled:!writesEnabled||!checkpoint?.rows||!user||busy,onchange:event=>{
      auto=event.target.checked;
      if(auto)localStorage.setItem(preference,transport.owner);
      else localStorage.removeItem(preference);
      listen();schedule();draw();
    }});
    toggle.checked=auto;
    const syncNow=button(t('Sync now','立即同步'),()=>void sync(true));
    syncNow.disabled=busy||!user||!navigator.onLine||blocked();
    const signIn=button(t('Sign in with Google','使用 Google 登入'),()=>void connect());
    signIn.disabled=loading||!navigator.onLine||blocked();
    host.replaceChildren(
      h('p',{class:'ng-caption',role:'status'},statusNames[current]+(message?' · '+message:'')),
      !writesEnabled?h('p',{class:'ng-caption'},t('Cloud writes are disabled pending Security Rules verification.','驗證安全規則前，雲端寫入已停用。')):null,
      user?h('p',{},user.email??t('Google account','Google 帳戶')):signIn,
      user?h('label',{class:'ng-check'},toggle,h('span',{},t('Auto Sync','自動同步'))):null,
      user?h('p',{class:'ng-caption'},t('Last successful sync','上次成功同步')+' · '+
        (checkpoint?.syncedAt?new Date(checkpoint.syncedAt).toLocaleString():'—')):null,
      user&&(dirty||!checkpoint?.rows||checkpoint?.pending)?h('p',{class:'ng-caption'},t('Local changes are pending review or sync.','本機變更等待檢視或同步。')):null,
      user?h('div',{class:'ng-actions'},syncNow,
        review?.conflicts.length?button(t('Review conflicts','檢視衝突'),()=>show(review)):null,
        button(t('Disconnect','中斷連線'),()=>void disconnect())):null,
      h('p',{class:'ng-caption'},t('Attachments and original backup archives stay on this device. Use complete backup to move them.',
        '附件及原始備份檔保留於本機。請使用完整備份移轉。')),
      h('p',{class:'ng-caption'},t('Synced legacy records include the source needed to verify them.','同步舊版紀錄時會包括其驗證來源。')));
  }
  addEventListener('workie-ledger-change',()=>{if(user){dirty=true;draw();schedule();}});
  function resume() {
    if(!writesEnabled||sdk||loading||resuming||!localStorage.getItem(preference)||!navigator.onLine)return;
    resuming=loadFirebase().then(value=>{sdk=value;unobserve=sdk.observe(current=>void account(current));})
      .catch(error=>set('error',error.code??error.message)).finally(()=>{resuming=null;});
  }
  addEventListener('online',()=>{draw();resume();schedule();});
  addEventListener('offline',draw);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){resume();schedule();}});
  resume();
  return {attach(node){host=node;draw();}};
}
