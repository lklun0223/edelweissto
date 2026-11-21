import {BatchIdentifierError,batchHash,schema,parseWtp,schemaForPrompt,TransferSyntaxError} from './wtp.mjs';
import {prompt,weeklyTransferGuidance} from './wtp-prompt.mjs';
import {exportRecordsCsv} from './csv.mjs';
import {CATEGORIES} from './coverage.mjs';
import {calendarDay,HONG_KONG,lessonInterval,manualTimerStart,possibleLessonTimes,wallTime,weekOf} from './lesson-time.mjs';
import {dependentSettlements,latestSunday,retainWeeklyObservation,saveSundaySavings,settlementVersion,settlementView,sundayHistory,sundayVersions,weeklyHistory,weeklySettlement} from './weekly-settlement.mjs';
import {incomeTrend,weeklyIncome,studentAttendance,lessonOperations,linkConfirmedIncome} from './work-analytics.mjs';
import {addSpecialIncome,generalReceipt,prepareOperations,setIncludedWork,workReceipt} from './work-receipts.mjs';
import {translate} from './i18n.mjs';
import {backupChanges,mergeBackup,withTransferHistory} from './backup-merge.mjs';
import {allocationView,allocationDeltas} from './allocation-view.mjs';
import {fundingInstrument} from './presentation.mjs';
import {budgetScope,difference,periodMoney,planPosition,sumKnown,travelCapacity,tripActual} from './product-finance.mjs';
import {budgetTransferContext,prepareScopedBudgetBatch,subsidyScope,subsidyTransferContext,prepareScopedSubsidyBatch,TransferContextError,transferExample} from './budget-transfer.mjs';
import {actionIcons,adaptiveChrome,movementCurve,resizePanel,tweenNumbers} from './interaction.mjs';
import {displayQuote,fetchReferenceRate,rateIsStale,valuationLedger} from './rates.mjs';
import {exportWorkData,inspectWorkData,requireWorkScope} from './work-data.mjs';
import {clone,today,cents,financialModel,prepareBatch,reconcileBalance,quote,convert,billOccurrences,mergeLegacy,workIncome,generateSeries,activeBudget,accountBalances,legacyMigrationVersion,isSnapshotSettlement,includedExpenseDetails,emptyLedger} from './ledger.mjs';
import {readLedger,migrationPreview,activateMigration,commitLedger,restorePoints,restoreLedger,exportLedger,inspectBackup,digest} from './repository.mjs';

const names={
  budget_item:'Budget item',expense:'Expense',savings_deposit:'Savings deposit',
  income_entry:'Income summary',grant:'Grant',loan:'Loan',cash_event:'Money movement',
  trip:'Trip',trip_budget_item:'Trip budget',fixed_bill_rule:'Fixed bill',bill_payment:'Bill payment',
  task:'Task',student:'Student',lesson:'Lesson',account:'Account',fx_quote:'Exchange rate',balance:'Confirmed balance',
  document:'Local document',
  lesson_series:'Weekly lesson pattern',
  account_transfer:'Transfer between accounts',
  course:'Course approval',housing_option:'Housing option',
};
const optionLabels={
  TRANSPORT:'行 · Transport',HOUSING:'住 · Housing',FOOD:'食 · Food',LEISURE:'樂 · Leisure',
  HIGH:'High · 高',MEDIUM:'Medium · 中',LOW:'Low · 低',GENERAL:'General · 一般',SPECIAL:'Special · 特別',
  IN:'Into exchange fund',OUT:'Out of exchange fund',COST:'Cost',SECURITY_DEPOSIT:'Refundable security deposit',
  RESERVE:'Emergency reserve',ONCE:'One-off',MONTHLY:'Monthly',DAILY:'Daily',WEEKLY:'Weekly',
  QUOTED:'Quoted',ESTIMATE:'Estimate',CONFIRMED:'Confirmed',PLANNED:'Planned',CANCELLED:'Cancelled',
  INCOME:'Actual income',REFUND:'Refund received',LOAN_DRAW:'Loan principal received',
  LOAN_REPAYMENT:'Principal repaid',INTEREST:'Interest / fees paid',SECURITY_PAYMENT:'Security deposit paid',
  CASH:'Cash',BANK:'Bank',EWALLET:'E-wallet',VISA:'Visa D',UNIVERSITY:'University deadlines',
  COURSES:'Courses / credit approval',GRANT:'Grant application',INSURANCE:'Insurance / ÖGK',
  ARRIVAL:'Arrival checklist',RETURN:'Return / end of lease',PACKING:'Packing list',OTHER:'Other',
  EXCHANGE:'Exchange fund',ACCOUNT:'One account',
  PENDING:'Pending',APPROVED:'Approved',REJECTED:'Rejected',SHORTLISTED:'Shortlisted',APPLIED:'Applied',RESERVED:'Reserved',
};
const descriptions={
  balance:'選擇交換資金總額或單一賬戶，確認涵蓋範圍及截至日期。核對後，該範圍的原有收支會標為已包含。',
  savings_deposit:'將已有資金調入交換用途。這筆轉入只影響交換資金範圍。',
  income_entry:'收入統計記錄。交換資金透過已核對餘額、Savings deposit 或實際 Cash event 記錄。',
  cash_event:'記錄已發生的收款、貸款本金、押金支付或退款。退款請連結原始支付。',
  grant:'只將已批核等待發放的尚未到帳金額加入預期涵蓋。已發放資助請核對實際收款。',
  expense:'記錄實際付款。固定賬單仍包含在總支出，可控支出另列。',
  fx_quote:'每一單位原幣兌 HKD。輸入報價日期及來源，供離線換算使用。',
  budget_item:'設定計劃成本及付款日。已付款項請用 Expense 連結此項目。',
};
const editorDescriptions={
  balance:'Choose the exchange fund or a single account. Confirm the date and which payments the balance includes.',
  savings_deposit:'Move money you already own into the exchange fund.',
  income_entry:'Record a reporting total for Work. Use a savings deposit or an actual payment to update exchange cash.',
  cash_event:'Record a payment or receipt that already happened. Link refunds to the original payment.',
  grant:'Approved grants affect expected coverage. Record a receipt when the money arrives.',
  expense:'Record an actual payment. Fixed bills count toward total outflow and are shown separately from controllable spending.',
  fx_quote:'Enter the HKD value of one unit of the currency, with its quote date and source.',
  budget_item:'Plan the cost and payment date. Link the actual expense when you pay.',
};
const groups={
  Expenses:['expense','fixed_bill_rule','bill_payment'],
  Funding:['savings_deposit','grant','loan','cash_event','income_entry','account','account_transfer','balance','fx_quote'],
  Work:['student','lesson','lesson_series','income_entry'],
  Administration:['task','course','document'],
};
const tabs=['Home','Budget','Trips','Pre-departure','Settings'];
const folioTitles={Home:'Vienna exchange',Budget:'Budget',Trips:'Trips','Pre-departure':'Pre-departure',Settings:'Settings'};
const folioSections={Home:'財務總覽',Budget:'交換預算',Trips:'旅程','Pre-departure':'出發前',Settings:'設定'};
const routeIcons={Home:'house',Budget:'layers',Trips:'map','Pre-departure':'wallet',Settings:'settings'};
const secondarySections=new Set();
const recordFilters=new Map();
let ledger=null,view='Home',pending=null,editing=null,dialogOpener=null;
let renderedModel=null;
let root,content,status,dialog,form,undoAction;
let query='',filterEntity='',filterCategory='';
let weeklyChartRange='8';
let migrationRequired=false,resetChrome;
const expenseFilter={type:'',category:'',from:'',to:''};
let expenseFiltersOpen=false;
let financePeriod='week';
let settlementWeek=weekOf(today()), settlementDetail='';
let selectedSunday=null;
let prepTool=null;
const savingsDrafts=new Map();
let fxStatus='',fxLoading=false;
let currentTrip=null;
const budgetDisclosures=new Map();
let workDays=7,workDate=today(),showCurrentHour=false,workMobileGrid=false;
const workZone=HONG_KONG;
try {
  const saved=JSON.parse(sessionStorage.getItem('workie_calendar_view')??'null');
  if([1,3,7].includes(saved?.days))workDays=saved.days;
  if(/^\d{4}-\d{2}-\d{2}$/.test(saved?.date??'')&&Number.isFinite(Date.parse(saved.date)))workDate=saved.date;
} catch {}
const viewState=new Map();
const chartSelections=new Map();
let firstOverview=true;
let selectedAllocation='';
let selectedWeek='';
let transferDraft='';
const budgetDrafts=new Map();
const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const tr=text=>translate(text,ledger?.settings.language);
const pageHeading=()=>root.querySelector('#ng-page-title');
function legacyChanges() {
  if(!ledger?.legacy)return {changed:false,financial:false};
  const raw=localStorage.getItem('tutoring_data');
  if(raw===null)return {changed:false,financial:false};
  if(raw===ledger.legacy.raw)return {changed:false,financial:false};
  try {
    const old=JSON.parse(ledger.legacy.raw),current=JSON.parse(raw);
    if(!current)return {changed:true,financial:true};
    const changed=key=>JSON.stringify(old[key])!==JSON.stringify(current[key]);
    const financial=['expenses','finance','tripCategories','budgetPlanning','exchangeRate'].some(changed);
    return {changed:financial||['sources','records','scheduled','smartExpenses','workTools'].some(changed),financial};
  } catch {return {changed:true,financial:true};}
}
function displayModel() {
  const model=financialModel(ledger,today(),valuationLedger(ledger));
  if(!legacyChanges().financial)return model;
  const unknown=waterfall=>({...waterfall,remaining:null,rows:waterfall.rows.map(row=>({...row,covered:null,gap:null}))});
  return {...model,available:null,expected:null,gap:null,waterfall:unknown(model.waterfall),planned:unknown(model.planned),
    issues:[...model.issues,'Review financial changes made in the legacy workspace.']};
}
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('workie-nextgen'):null;
function markActive() {
  try {localStorage.setItem('workie_nextgen_active','true');} catch {}
  document.documentElement.classList.remove('ng-boot');
}
const h=(tag,attributes={},...children)=>{
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attributes)) {
    if(key==='class') node.className=value;
    else if(key==='text') node.textContent=value;
    else if(key.startsWith('on')) node.addEventListener(key.slice(2),value);
    else if(value!==false && value!==null && value!==undefined) node.setAttribute(key,value===true?'':value);
  }
  node.append(...children.flat().filter(value=>value!==null && value!==undefined));
  return node;
};
const button=(text,onclick,kind='secondary')=>h('button',{type:'button',class:'ng-button '+kind,onclick},text);
function icon(name) {
  const shape=window.lucide?.[name];
  return shape?window.lucide.createElement(shape,{class:'ng-action-icon','aria-hidden':'true','focusable':'false','stroke-width':'1.75'}):null;
}
function actionButton(label,name,onclick,{kind='secondary',only=false,display=label}={}) {
  name=actionIcons[name]??name;
  const text=tr(label);
  const showLabel=!only||!window.lucide?.[name];
  return h('button',{type:'button',class:'ng-button ng-action-control '+kind+(showLabel?'':' ng-icon-action'),
    'aria-label':text,title:!showLabel||display!==label?text:null,onclick},icon(name),showLabel?h('span',{},tr(display)):null);
}
function segments(name,label,choices,value,onchange) {
  const selected=choices.findIndex(([key])=>key===value);
  const track=h('div',{class:'ng-segment-track',style:'--segments:'+choices.length+';--segment:'+Math.max(0,selected)},
    ...choices.map(([key,text,disabled],index)=>h('label',{},
      h('input',{type:'radio',name,value:key,checked:key===value,disabled,onchange:()=>{
        track.style.setProperty('--segment',index);
        onchange?.(key);
      }}),h('span',{},tr(text)))));
  return h('fieldset',{class:'ng-segment-control'},h('legend',{class:'ng-screen-reader'},tr(label)),track);
}
function commandMenu(label,actions,...details) {
  const summary=h('summary',{'aria-label':label,title:label},icon('Ellipsis')??'⋯');
  const panel=h('div',{class:'folio-context-panel ng-command-panel',role:'group','aria-label':label},actions,details);
  const menu=h('details',{class:'folio-context folio-row-context ng-command-menu'},summary,panel);
  const choices=()=>[...panel.querySelectorAll('button:not(:disabled)')];
  panel.addEventListener('click',event=>{
    if(!event.target.closest('button'))return;
    menu.open=false;
    if(!document.querySelector('dialog[open]'))summary.focus({preventScroll:true});
  });
  menu.addEventListener('keydown',event=>{
    if(event.key==='Tab') {
      requestAnimationFrame(()=>{if(menu.open&&!menu.contains(document.activeElement))menu.open=false;});
      return;
    }
    if(event.key==='Escape'&&menu.open) {
      event.preventDefault();menu.open=false;summary.focus({preventScroll:true});return;
    }
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const items=choices();
    if(!items.length)return;
    event.preventDefault();
    menu.open=true;
    const here=items.indexOf(document.activeElement);
    const target=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowUp'?
      (here<0?items.length-1:(here+items.length-1)%items.length):(here+1)%items.length;
    items[target].focus();
  });
  return menu;
}
const figureSize=text=>text.length>19?'wide':text.length>15?'long':null;
function moneyText(cents,currency=null) {
  const text=amount(cents,currency);
  const prefix=text.match(/^(-?)([A-Z]{3})(?=\s)/);
  return h('span',{class:'ng-money','data-size':figureSize(text)},prefix?
    [prefix[1],h('span',{class:'ng-money-unit'},prefix[2]),text.slice(prefix[0].length)]:text);
}
function chartControls(name,output,choices) {
  const select=(choice,announce=true)=>{
    const changed=chartSelections.get(name)!==choice.key;
    chartSelections.set(name,choice.key);
    for(const entry of choices) {
      const current=entry===choice;
      entry.control.setAttribute('aria-pressed',String(current));
      if(entry.segment)entry.segment.dataset.selected=String(current);
    }
    if(announce||output.textContent!==choice.label)output.textContent=choice.label;
    choice.inspect?.();
    if(changed&&announce&&!reduceMotion())output.animate([{opacity:.55,translate:'0 3px'},{opacity:1,translate:'none'}],
      {duration:180,easing:'ease-out'});
  };
  for(const [index,choice] of choices.entries()) {
    const {control}=choice;
    control.setAttribute('aria-pressed','false');
    control.setAttribute('aria-controls',output.id);
    control.addEventListener('click',()=>select(choice));
    control.addEventListener('focus',()=>select(choice));
    control.addEventListener('pointermove',event=>{
      if(event.pointerType==='mouse'&&chartSelections.get(name)!==choice.key)select(choice);
    });
    control.addEventListener('keydown',event=>{
      const target={ArrowLeft:index-1,ArrowRight:index+1,Home:0,End:choices.length-1}[event.key];
      if(target===undefined)return;
      event.preventDefault();
      choices[Math.max(0,Math.min(target,choices.length-1))].control.focus();
    });
  }
  const selected=choices.find(choice=>choice.key===chartSelections.get(name));
  if(selected)select(selected,false);
}
function openDialog(modal) {
  if(modal.open||document.querySelector('dialog[open]'))return false;
  const title=modal.querySelector('h2');
  if(title) {
    title.id||='ng-dialog-title-'+crypto.randomUUID();
    modal.setAttribute('aria-labelledby',title.id);
  }
  modal.lang=ledger?.settings.language??'en';
  modal.showModal();
  if(modal.matches('.ng-budget-transfer-dialog')) {
    adjustEditorViewport();
    title?.setAttribute('tabindex','-1');
    title?.focus({preventScroll:true});
  }
  if(modal===dialog) {
    adjustEditorViewport();
    const origin=dialogOpener?.getBoundingClientRect();
    const sheet=modal.getBoundingClientRect();
    if(origin&&sheet.width&&sheet.height) {
      const within=(value,max)=>Math.max(0,Math.min(max,value));
      modal.style.transformOrigin=within(origin.x+origin.width/2-sheet.x,sheet.width)+'px '+
        within(origin.y+origin.height/2-sheet.y,sheet.height)+'px';
    }
    title?.setAttribute('tabindex','-1');
    title?.focus({preventScroll:true});
  }
  return true;
}
async function dismissEditor(focus) {
  if(!dialog.open||dialog.dataset.closing)return;
  if(!reduceMotion()) {
    dialog.dataset.closing='true';
    await Promise.allSettled(dialog.getAnimations().map(animation=>animation.finished));
    delete dialog.dataset.closing;
  }
  dialog.close();
  (focus?.isConnected?focus:pageHeading())?.focus({preventScroll:true});
}
async function dismissSheet(modal,focus) {
  if(!modal.open||modal.dataset.closing)return;
  modal.dataset.closing='true';
  if(!reduceMotion()) {
    const animation=modal.animate([{opacity:1,translate:'0 0'},{opacity:0,
      translate:matchMedia('(max-width: 690px)').matches?'0 24px':'12px 0'}],
    {duration:165,easing:movementCurve,fill:'forwards'});
    await animation.finished.catch(()=>{});
  }
  modal.close();modal.remove();
  (focus?.isConnected?focus:pageHeading())?.focus({preventScroll:true});
}
function adjustEditorViewport() {
  const viewport=window.visualViewport;
  const surface=document.querySelector('.ng-budget-transfer-dialog[open]')??dialog;
  if(!surface?.open||!viewport)return;
  const offset=Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop);
  surface.style.setProperty('--ng-viewport-height',viewport.height+'px');
  surface.style.setProperty('--ng-viewport-bottom',offset+'px');
}
function say(message,error=false) {
  status.textContent=tr(message);
  status.setAttribute('role',error?'alert':'status');
}
function amount(cents,currency=null) {
  if(cents===null || !Number.isFinite(cents)) return '待核對';
  if(currency===null) {
    const preferred=ledger?.settings.currency??'HKD';
    const rate=ledger?displayQuote(ledger,preferred)?.rate:1;
    if(rate) {cents=Math.round(cents/rate);currency=preferred;}
    else currency='HKD';
  }
  if(!/^[A-Z]{3}$/.test(currency))return '原幣待核對';
  return new Intl.NumberFormat(ledger?.settings.language==='zh-Hant'?'zh-HK':'en-HK',{style:'currency',currency,currencyDisplay:'code'}).format(cents/100);
}
const fieldLabel=key=>({
  description:'Name / 用途',amount:'Amount / 金額',currency:'Original currency',date:'Actual date',
  as_of:'Balance as of',due_date:'Payment / deadline',expected_date:'Expected disbursement',
  priority:'Priority',type:'Expense type',fixed:'Fixed bill',bill:'Bill label',share:'Your share (0–1)',
  payee:'Payee',
  frequency:'Frequency',start_date:'Start date',end_date:'End date',source:'Source / reference',
  scope:'Balance scope',source_date:'Source date',confidence:'Estimate confidence',period:'Reporting month',
  rate:'Rate / 每單位價格',student_id:'Student',start_time:'Start time',duration:'Duration (hours)',
  lesson_date:'Lesson date (optional)',end_time:'End time',rate_override:'Hourly rate override',
  related_id:'Original record',budget_item_id:'Budget item',rule_id:'Bill rule',trip_id:'Journey',
  included_in_general_id:'Included in General total',
  account_id:'Account',source_id:'Related source',note:'Notes',income:'Stored lesson income',
    balance_id:'Confirmed balance',after_balance:'This payment occurred after the selected balance was confirmed',
    from_account_id:'From account',to_account_id:'To account',owner_id:'Related record',
    home_approval:'Home-university approval',host_approval:'Host-university approval',credits:'Credits',
    repayment_amount:'Scheduled repayment amount',repayment_frequency:'Repayment frequency',period_date:'Bill period due date',
})[key]??key.replaceAll('_',' ');
function download(value,name,type='application/json') {
  const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}));
  const link=h('a',{href:url,download:name});
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function run(action) {
  try {await action();} catch(error) {say(error.message,true);}
}
async function save(next,reason,expectedRevision=next.revision,{previousWeek=null,announce=true}={}) {
  if(migrationRequired)throw Error('Review the existing local records before saving changes in Workie.');
  if(ledger.revision!==expectedRevision)throw Error('More recent changes exist. Review and retry.');
  const before=financialModel(ledger,today(),valuationLedger(ledger));
  const beforePeriod=content.querySelector('.ng-period-summary')?periodMoney(ledger,financePeriod):null;
  const beforeWeek=content.querySelector('#ng-weekly-title')?previousWeek??settlementView(weeklyWithDraft(settlementWeek)):null;
  ledger=await commitLedger(expectedRevision,next,reason);
  markActive();
  if(ledger.settings.theme)applyTheme(ledger.settings.theme);
  channel?.postMessage(ledger.revision);
  pending=null;render();
  if(announce)say('Saved on this device.');
  if(beforePeriod)animateAmounts(content,beforePeriod,periodMoney(ledger,financePeriod));
  if(beforeWeek) {
    const updated=settlementView(weeklyWithDraft(settlementWeek));
    animateSettlement(content.querySelector('.ng-week-flow'),beforeWeek,updated);
  }
  if(['Home','Budget','Trips'].includes(view)&&!legacyChanges().financial&&!reduceMotion()) {
    const chart=model=>allocationView(view==='Home'?planPosition(model):model);
    for(const delta of allocationDeltas(chart(before),chart(renderedModel))) {
      for(const track of content.querySelectorAll('[data-allocation="'+delta.id+'-'+delta.field+'"]')) {
        const scale=track.dataset.allocationAxis==='y'?'scaleY':'scaleX';
        track.animate([{transform:scale+'('+delta.from+')'},{transform:scale+'('+delta.to+')'}],
          {duration:scale==='scaleY'?680:480,easing:'cubic-bezier(.19,1,.22,1)'});
      }
    }
    if(before.available!==renderedModel.available&&before.available!==null&&renderedModel.available!==null) {
      content.querySelector('.folio-balance-amount')?.animate([{opacity:.72,transform:'translateY(3px)'},{opacity:1,transform:'none'}],
        {duration:260,easing:'ease-out'});
    }
  }
}
function animateAmounts(host,before,after) {
  if(reduceMotion())return;
  for(const field of host.querySelectorAll('[data-period-metric]')) {
    const key=field.dataset.periodMetric;
    if(before[key]!==after[key])field.animate([{opacity:.5,translate:'0 5px'},{opacity:1,translate:'none'}],
      {duration:260,easing:'cubic-bezier(.2,.75,.25,1)'});
  }
}
function showUndo(previousRevision,message,recordId) {
  const savedRevision=ledger.revision;
  say(message);
  undoAction.replaceChildren(h('span',{},tr(message)),actionButton('Undo','Undo2',()=>run(async()=>{
    if(ledger.revision!==savedRevision)throw Error('More recent changes exist. Review the restore points in Settings.');
    const point=(await restorePoints()).find(row=>row.data.revision===previousRevision);
    if(!point)throw Error('The restore point is no longer on this device.');
    ledger=await restoreLedger(point.id,savedRevision);
    channel?.postMessage(ledger.revision);render();say('Restore completed.');
    const restored=recordId&&content.querySelector('[data-record-id="'+CSS.escape(recordId)+'"] button');
    (restored||pageHeading())?.focus({preventScroll:true});
  })));
  undoAction.querySelector('button').focus({preventScroll:true});
}
function cashEntryDefaults(data) {
  const base=renderedModel?.base;
  if(base&&!base.requiresReconciliation&&data.date===base.data.as_of&&data.date===today()) {
    return {...data,balance_id:base.id,after_balance:true};
  }
  return data;
}
function expenseCurrencies() {
  const support=ledger.records.filter(row=>row.entity==='fx_quote').map(row=>row.data.currency);
  return [...new Set(['HKD','EUR',ledger.settings.expense_currency,...support])].filter(code=>/^[A-Z]{3}$/.test(code??''));
}
function currencyOption(currency) {
  return h('option',{value:currency},currency+({HKD:' $',EUR:' €',USD:' $',GBP:' £',JPY:' ¥'}[currency]??''));
}
function recordWeeklyExpense(report) {
  transferDialog(tr('New expense'),(modal,close)=>{
    const totals=ledger.records.filter(row=>row.entity==='expense'&&row.data.type==='GENERAL'&&
      row.data.entry_week===report.week&&!row.data.voided);
    const original=totals.length===1?totals[0]:null;
    const figure=entryAmount('amount',original?.data.amount??'',true);
    figure.min='.01';
    const currency=h('select',{name:'currency'},...expenseCurrencies().map(currencyOption));
    const defaultCurrency=ledger.settings.expense_currency??'HKD';
    currency.value=original?.data.currency??defaultCurrency;
    const description=h('input',{name:'description',maxlength:240,value:original?.data.description??''});
    const date=h('input',{name:'date',type:'date',max:today(),value:today(),required:true});
    const actualDate=entryField('Expense date',date);
    const fixed=h('input',{type:'checkbox',role:'switch',name:'fixed',checked:original?.data.fixed,'aria-describedby':'ng-expense-guidance'});
    const category=h('select',{name:'category'},h('option',{value:''},tr('No category')),
      ...CATEGORIES.map(row=>h('option',{value:row.id},row.label+' · '+tr(row.name))));
    const categoryField=entryField('Category (optional)',category);
    const included=h('input',{name:'included_in_general',type:'checkbox'});
    const includedField=h('label',{class:'ng-check'},included,h('span',{},tr('Already included in the General total')));
    const aggregateForDate=()=>ledger.records.find(row=>row.entity==='expense'&&row.data.type==='GENERAL'&&
      row.data.entry_week&&row.data.date===calendarDay(weekOf(date.value||today()),6)&&!row.data.voided&&
      row.data.currency===currency.value&&!row.data.account_id&&Boolean(row.data.fixed)===fixed.checked);
    const hint=h('p',{id:'ng-expense-guidance',class:'ng-caption'},
      tr('Counts toward cash outflow and is excluded from controllable spending.'));
    const period=h('p',{class:'ng-caption'},weekEnding(report.end));
    const ambiguity=h('p',{class:'ng-entry-error'},tr('Several totals exist. Use History / Manage to review them before adding another.'));
    let mode='GENERAL';
    const drafts={};
    const choices=segments('type','Expense type',[['GENERAL','General'],['SPECIAL','Special']],mode,key=>{
      const height=fields.getBoundingClientRect().height;
      drafts[mode]={amount:figure.value,currency:currency.value,description:description.value,fixed:fixed.checked};
      mode=key;present();resizePanel(fields,height);
      const draft=drafts[key]??{amount:'',currency:defaultCurrency,description:'',fixed:false};
      figure.value=draft.amount;currency.value=draft.currency;description.value=draft.description;fixed.checked=draft.fixed;
      present();
    });
    function present() {
      actualDate.hidden=date.disabled=mode==='GENERAL';
      period.hidden=mode==='SPECIAL';hint.hidden=!fixed.checked;
      categoryField.hidden=mode==='GENERAL';
      includedField.hidden=mode==='GENERAL'||!aggregateForDate();
      if(includedField.hidden)included.checked=false;
      ambiguity.hidden=mode==='SPECIAL'||totals.length<2;
    }
    fixed.addEventListener('change',present);
    date.addEventListener('input',present);currency.addEventListener('change',present);
    const fields=h('div',{},actualDate,period,ambiguity);
    const panel=h('form',{id:'ng-new-expense',class:'ng-entry-form ng-expense-composer'},choices,
      h('div',{class:'ng-amount-entry'},entryField('Amount',figure),entryField('Currency',currency)),fields,includedField);
    entrySubmit(panel,modal,close,'Save expense',async current=>{
      const aggregate=mode==='GENERAL';
      if(aggregate&&totals.length>1)throw Error('Several totals exist. Use History / Manage to review them before adding another.');
      const data={...(aggregate?original?.data:null),description:description.value.trim()||tr('Expense'),amount:Number(figure.value),
        currency:currency.value,date:aggregate?report.end:date.value,type:mode,fixed:fixed.checked,
        ...(aggregate?{entry_week:report.week,entry_created_at:original?.data.entry_created_at??new Date().toISOString()}:
          {category:category.value||null,included_in_general_id:included.checked?aggregateForDate()?.id??null:null})};
      const operation=aggregate&&original?{op:'UPDATE',entity:'expense',record_id:original.id,expected_revision:original.revision,changes:data}:
        {op:'ADD',entity:'expense',data:cashEntryDefaults(data)};
      const {next}=await prepareOperations(current,[operation]);
      return {next,reason:'Record pre-departure expense',message:'Expense saved.',id:operation.record_id??next.records.at(-1).id};
    },'expense');
    panel.append(h('details',{class:'ng-entry-options ng-week-bridge'},
      h('summary',{},h('span',{},icon('ChevronDown'),tr('More details'))),
      entryField('Description (optional)',description),
      categoryField,
      h('label',{class:'ng-expense-fixed ng-switch'},h('span',{},tr('Fixed bill')),fixed,h('i',{'aria-hidden':'true'})),hint,
      manageWeekly('expense',close,report.week)));
    modal.append(panel);present();
  },{quick:true});
}
function applyTheme(theme) {
  document.documentElement.classList.toggle('dark',theme==='dark');
  document.documentElement.classList.toggle('light',theme==='light');
  document.documentElement.style.colorScheme=theme;
  document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#1b171e':'#f7f1e7';
  document.querySelector('#ng-theme')?.setAttribute('aria-pressed',String(theme==='dark'));
  try {localStorage.setItem('workie_nextgen_theme',theme);} catch {}
}
async function changeTheme(theme) {
  if(!ledger){applyTheme(theme);return;}
  const next=clone(ledger);next.settings.theme=theme;await save(next,'Change appearance');
}
function metrics(model,{includeAvailable=true}={}) {
  return h('dl',{class:'ng-metrics'},
    ...[...(includeAvailable?[['Available now',amount(model.available)]]:[]),['Expected coverage',amount(model.expected)],
      ['Approved, awaiting issue',amount(model.approved)],['Remaining budget gap',amount(model.gap)]]
      .map(([label,value])=>h('div',{},h('dt',{},tr(label)),h('dd',{},value))));
}
function waterfall(model,{folio=false}={}) {
  const chart=allocationView(model);
  const fill=(row,field)=>h('span',{class:field==='covered'?'ng-track-cash':'ng-track-expected',
    'data-allocation':row.id+'-'+field,style:'transform:scaleX('+(row.target?(row[field]??0)/row.target:0)+')'});
  const ruler=chart.complete&&chart.total>0?h('div',{class:'ng-funding-ruler','aria-hidden':'true'},
    ...chart.rows.filter(row=>row.target>0).map(row=>h('span',{class:'ng-ruler-segment',style:'--segment:'+row.width+'%'},
      fill(row,'expected'),fill(row,'covered')))):null;
  const detail=h('output',{class:'ng-allocation-detail','aria-live':'polite'});
  const list=h('div',{class:'ng-allocation-list'});
  if(folio)list.addEventListener('keydown',event=>{
    const controls=[...list.children],index=controls.indexOf(event.target);
    const target={ArrowUp:index-1,ArrowDown:index+1,Home:0,End:controls.length-1}[event.key];
    if(index<0||target===undefined)return;
    event.preventDefault();
    controls[Math.max(0,Math.min(controls.length-1,target))].focus();
  });
  const inspect=row=>{
    selectedAllocation=row.id;
    for(const button of list.children)button.setAttribute('aria-pressed',String(button.dataset.category===row.id));
    detail.replaceChildren(h('strong',{},row.label+' '+tr(row.name)),
      h('dl',{},...[['Available now',row.covered],['Added by approved grants',row.grant],['Still needed with grants',row.expected===null?null:row.target-row.expected]]
        .map(([label,value])=>h('div',{},h('dt',{},tr(label)),h('dd',{},amount(value))))),
      button(tr('Open budget category'),()=>navigate('Budget',{query:'',filterEntity:'',filterCategory:row.id,scroll:0})));
  };
  for(const row of chart.rows) {
    const label=row.label+' '+tr(row.name);
    const select=()=>inspect(row);
    list.append(h('button',{type:'button',class:'ng-allocation','data-category':row.id,'aria-pressed':'false',
      onclick:select,onfocus:select,onpointerenter:event=>{if(event.pointerType==='mouse')select();}},
      h('span',{class:'ng-category'},h('b',{},row.label),h('span',{},tr(row.name),
        row.next?h('small',{class:'ng-next-threshold'},tr('Next threshold')):null)),
      h('span',{class:'ng-allocation-values'},h('strong',{},amount(row.covered)),h('small',{},tr('Plan')+' '+amount(row.target))),
      h('span',{class:'ng-track','aria-hidden':'true','data-known':String(row.covered!==null),
        style:folio&&chart.complete?'--folio-segment-start:'+row.start+'%;--folio-segment-width:'+row.width+'%':null},
        fill(row,'expected'),fill(row,'covered'))));
  }
  inspect(chart.rows.find(row=>row.id===selectedAllocation)||chart.rows.find(row=>row.next)||chart.rows[0]);
  const data=h('details',{class:'ng-chart-data'},h('summary',{},tr('Allocation data')),
    h('table',{class:'ng-table'},h('caption',{},tr('Budget allocation')),
      h('thead',{},h('tr',{},...['Category','Plan','Available now','With approved grants'].map(label=>h('th',{scope:'col'},tr(label))))),
      h('tbody',{},...chart.rows.map(row=>h('tr',{},h('th',{scope:'row'},row.label+' '+tr(row.name)),
        ...[row.target,row.covered,row.expected].map(value=>h('td',{},amount(value))))))));
  return h('section',{class:'ng-waterfall'+(folio?' folio-allocation':''),'aria-label':tr('Sequential budget allocation')},
    h('div',{class:'ng-section-title'},h('h2',{},tr(folio?'Funding waterfall':'Budget allocation')),h('span',{class:'ng-caption'},'行 → 住 → 食 → 樂')),
    ruler,ruler?h('div',{class:'ng-ruler-axis'},h('span',{},amount(0)),h('span',{},amount(chart.total))):null,
    h('p',{class:'ng-chart-legend'},h('span',{},h('i',{class:'ng-legend-swatch cash','aria-hidden':'true'}),tr('Available now')),
      h('span',{},h('i',{class:'ng-legend-swatch expected','aria-hidden':'true'}),tr('Approved, awaiting issue'))),
    list,detail,data,
    model.waterfall.unclassified.length?h('div',{class:'ng-warning'},tr('Assign a main category to review coverage.'),
      button(tr('Review budget'),()=>navigate('Budget',{query:'',filterEntity:'',filterCategory:'',scroll:0}))):null);
}
function overview() {
  const model=planPosition(renderedModel);
  const known=model.available!==null;
  const hasPlan=model.obligations.length>0;
  const formatted=known?amount(model.available):'';
  const money=formatted.match(/^([-−+]?)([A-Z]{3})\s*(.+)$/);
  const hero=h('section',{class:'v3-balance','aria-labelledby':'folio-balance-label'},
    h('h2',{id:'folio-balance-label'},tr('Cash available now')),
    known?h('p',{class:'folio-balance-amount','data-finance-metric':'cash','data-size':figureSize(money?money[3]:formatted)},
      money?h('span',{class:'folio-currency'},money[2]):null,h('strong',{},money?money[1]+money[3]:formatted)):null,
    h('p',{class:'folio-balance-date'},model.base?tr('Exchange cash baseline')+' · '+compactDate(model.base.data.as_of,{day:'numeric',month:'short',year:'numeric'}):
      tr('Set the amount you have already reserved for Vienna.')),
    model.base?button(tr(known?'Cash sources':'Review available cash'),()=>cashReview(model)):
      actionButton('Set your available exchange funds','funds',()=>edit('balance',null,{scope:'EXCHANGE',as_of:today(),
        currency:'HKD',description:tr('Exchange cash')}),{kind:'primary'}));
  const position=(label,value,key)=>h('div',{},h('dt',{},tr(label)),h('dd',{'data-finance-metric':key,'data-shortfall':String(value!==null&&value<0)},amount(value)));
  const summary=hasPlan?h('dl',{class:'ng-metrics ng-home-position'},
    model.total===null?null:position('Vienna still to pay',model.total,'remaining'),
    model.cashPosition===null?null:position(model.cashPosition<0?'Cash shortfall':'Cash surplus',model.cashPosition,'cash-position'),
    model.expectedPosition===null?null:position(model.expectedPosition<0?'Shortfall with grants':'Surplus with grants',model.expectedPosition,'expected-position')):null;
  const access=h('div',{class:'ng-home-actions'},
    needsSetup()?actionButton('Finish setup','Sparkles',()=>onboarding()):null,
    sundayHistory(ledger.settings).length?null:actionButton('Add your first Sunday savings','Wallet',()=>{
      navigate('Pre-departure',{scroll:0});content.querySelector('#ng-sunday-amount')?.focus();
    }),
    model.grants.length?actionButton('Subsidy','subsidy',()=>showSection('Pre-departure','subsidy')):
      actionButton('Add subsidy information','subsidy',()=>edit('grant',null,{status:'可申請',currency:'HKD'})));
  const instrument=hasPlan&&(known||model.expected!==null)?fundingInstrument({h,button,chart:allocationView(model,{classifiedPreview:true}),amount,tr,selected:selectedAllocation,
    onSelect:id=>{selectedAllocation=id;},
    onOpenCategory:id=>navigate('Budget',{query:'',filterEntity:'',filterCategory:id,scroll:0}),
    onReviewPlan:()=>navigate('Budget',{query:'',filterEntity:'',filterCategory:'',scroll:0})}):
    h('section',{class:'ng-surface ng-home-next'},h('h2',{},tr('Vienna budget')),
      h('p',{class:'ng-caption'},tr(hasPlan?'Set exchange funds to see how much of your plan is covered.':'Add your planned costs when you are ready.')),
      hasPlan?button(tr('Review budget'),()=>navigate('Budget')):
        h('div',{class:'ng-actions'},actionButton('Add Vienna budget item','budget',()=>edit('budget_item',null,
          {currency:'HKD',priority:'MEDIUM',scenario:ledger.settings.scenario}),{kind:'primary'}),
          actionButton('Import Vienna budget','import',()=>importBudgetFromAI(null,'Vienna Budget'))));
  const stage=h('div',{class:'v3-overview'+(firstOverview?' v3-reveal':'')},
    h('div',{class:'v3-overview-summary'},hero,summary,access,
      model.base&&model.historyReview.length?h('div',{class:'ng-funding-review'},actionButton(model.historyReview.length?
        model.historyReview.length+' '+tr(model.historyReview.length===1?'historical payment needs review':'historical payments need review'):
        'Review available cash','CircleAlert',()=>cashReview(model))):null),instrument);
  firstOverview=false;
  content.append(stage);
}
function cashReview(model) {
  const opening=weeklySettlement(ledger,settlementWeek).opening;
  const references=new Map(ledger.records.map(row=>[row.id,row]));
  transferDialog(tr('Cash sources'),(modal,close)=>{
    const difference= model.issues.filter(message=>!message.startsWith('Reconcile historical payment ')&&
      !message.startsWith('Reconcile edited payment '));
    modal.append(h('div',{},h('p',{class:'ng-caption'},tr('Weekly savings tracks your starting savings. Home starts from cash you explicitly set aside for Vienna.')),
      h('dl',{class:'ng-counts'},
        h('dt',{},tr('Weekly opening savings')),h('dd',{},weeklyMoney(opening)),
        h('dt',{},tr('Confirmed exchange amount')),h('dd',{},moneyText(model.baseline,'HKD')),
        h('dt',{},tr('Cash available now')),h('dd',{},moneyText(model.available,'HKD'))),
      h('p',{class:'ng-caption'},tr('Account balances track individual accounts. Savings deposits move existing money into the exchange fund. Remaining Vienna commitments come from Budget items and their linked payments.')),
      model.historyReview.length?h('details',{class:'ng-secondary'},h('summary',{},tr('Historical payment review'),icon('ChevronDown')),
        h('ul',{class:'ng-cash-review-list'},...model.historyReview.map(item=>{
          const row=references.get(item.id);
          const source=row?.origin?.path?.startsWith('expenses/')?'Gen 1 expense history':
            row?.origin?'Preserved legacy source':'Workie ledger';
          return h('li',{},h('strong',{},row?.data.description??tr('Saved record')),
            h('small',{},tr(source)+' · '+tr(item.reason)),
            row?.data.budget_item_id?h('small',{},tr('Linked budget payment')):null);
        }))):null,
      difference.length?h('ul',{class:'ng-caption'},...difference.map(message=>h('li',{},tr(message)))):null,
      actionButton(model.base?'Review exchange cash':'Confirm exchange cash','funds',async()=>{
        await close();
        edit('balance',model.base,{scope:'EXCHANGE',as_of:today(),description:tr('Exchange cash')});
      },{kind:'primary'})));
  });
}
function milestones() {
  const tasks=ledger.records.filter(row=>['task','course','grant'].includes(row.entity)&&row.data.due_date&&!row.data.done&&row.data.status!=='已發放')
    .sort((a,b)=>a.data.due_date.localeCompare(b.data.due_date));
  const departure=ledger.settings.departure_date;
  const days=departure?Math.round((Date.parse(departure+'T00:00:00Z')-Date.parse(today()+'T00:00:00Z'))/86400000):null;
  return h('section',{class:'ng-surface ng-milestones'},h('h2',{},tr('Exchange milestones')),
    h('p',{class:'ng-countdown'},days===null?'Set your departure date in Settings':days>0?days+' days to departure':days===0?'Departure day':Math.abs(days)+' days since departure'),
    departure?h('p',{class:'ng-caption'},departure+' · as of '+today()):null,
    tasks.length?h('ol',{class:'ng-timeline'},...tasks.slice(0,6).map(row=>h('li',{},
      h('time',{datetime:row.data.due_date},row.data.due_date),button(row.data.description,()=>edit(row.entity,row)),
      h('small',{},row.data.source?row.data.source:'User-maintained date')))):
      h('p',{class:'ng-caption'},'Add dated tasks in Administration to build your milestone timeline.'));
}
function searchRecords() {
  if(document.querySelector('dialog[open]'))return;
  const opener=document.activeElement;
  const modal=h('dialog',{class:'ng-search-dialog'});
  const search=h('input',{type:'search','aria-label':tr('Search all records'),placeholder:'Budgets, payments, students, journeys…'});
  const results=h('div',{class:'ng-search-results'});
  function update() {
    const text=search.value.toLowerCase();
    const matching=ledger.records.filter(row=>JSON.stringify(row.data).toLowerCase().includes(text)).slice(0,40);
    results.replaceChildren(...(matching.length?matching.map(row=>button(tr(names[row.entity])+' · '+row.data.description,()=>{
      close();edit(row.entity,row);
    })): [h('p',{class:'ng-caption',role:'status'},tr('No matching records'))]));
  }
  const close=()=>{modal.close();modal.remove();opener?.focus();};
  modal.append(h('h2',{},tr('Search Workie')),search,results,button(tr('Close'),close));
  modal.addEventListener('cancel',event=>{event.preventDefault();close();});
  search.oninput=update;document.body.append(modal);openDialog(modal);update();search.focus();
}
const welcomePreference='workie_welcome_v1';
let aiSetupSelection='vienna';
function needsSetup() {
  if(ledger.settings.setup_complete||migrationRequired)return false;
  if(localStorage.getItem(welcomePreference))return true;
  return !ledger.legacy&&!ledger.records.length&&!Object.entries(ledger.settings).some(([key,value])=>
    value!=null&&!['currency','scenario','theme','language','auto_fx','expense_currency'].includes(key)&&
    (typeof value!=='object'||Object.keys(value).length>0));
}
function onboarding(mode='welcome') {
  if(typeof mode!=='string')mode='welcome';
  const choose=async(close,step)=>{
    await close();onboarding(step);
  };
  transferDialog(tr(mode==='welcome'?'Welcome to Workie':mode==='fresh'?'Set up Workie':'Set up with AI'),(modal,close)=>{
    modal.classList.add('ng-welcome-sheet');
    if(mode==='fresh') {
      freshSetup(modal,close);
      return;
    }
    if(mode==='ai') {
      aiSetup(modal,close);
      return;
    }
    const path=(title,caption,symbol,action,disabled=false,primary=false)=>{
      const item=actionButton(title,symbol,action,{kind:primary?'primary':'secondary'});
      item.classList.add('ng-welcome-path');item.disabled=disabled;
      item.querySelector('span').append(h('small',{},tr(caption)));
      return item;
    };
    modal.append(h('p',{class:'ng-welcome-intro'},tr('Your savings, Vienna plans and tutoring, together in Workie.')),
      h('div',{class:'ng-welcome-paths'},
        path('Start fresh','Set the basics at your own pace.','Wallet',()=>choose(close,'fresh'),migrationRequired,!migrationRequired),
        path('Restore Gen 1 JSON','Preview a backup before restoring.','ArchiveRestore',async()=>{await close();chooseLegacyBackup();},false,migrationRequired),
        path('Set up with AI','Bring in a plan from your own chat.','Sparkles',()=>{
          localStorage.setItem(welcomePreference,'in-progress');void choose(close,'ai');
        },migrationRequired)),
      button(tr('Explore without setting up'),async()=>{
        if(needsSetup())localStorage.setItem(welcomePreference,'explore');
        await close();render();
      }));
    if(migrationRequired)modal.append(h('p',{class:'ng-caption'},tr('Earlier Workie records are available to review.')));
  },{quick:true,onDismiss:mode==='welcome'?()=>{
    if(needsSetup()&&!localStorage.getItem(welcomePreference))localStorage.setItem(welcomePreference,'explore');
  }:undefined});
}
function freshSetup(modal,close) {
  const panel=h('div',{class:'ng-welcome-steps'});
  const currentBalance=ledger.records.some(row=>row.entity==='balance'&&row.data.scope!=='ACCOUNT');
  const canSetCash=!currentBalance&&!renderedModel.applied.length&&!renderedModel.issues.length;
  const settings=ledger.settings;
  const revision=ledger.revision;
  const draft={currency:settings.currency??'HKD',sunday:latestSunday(),savings:'',departure:settings.departure_date??'',
    returning:settings.return_date??'',cash:''};
  let step=0;
  const bind=(key,attributes)=>h('input',{...attributes,value:draft[key],oninput:event=>{draft[key]=event.target.value;}});
  const error=h('p',{class:'ng-entry-error',role:'alert'});
  function draw() {
    error.textContent='';
    const currency=h('select',{name:'currency',onchange:event=>{draft.currency=event.target.value;}},
      ...['HKD','EUR'].map(code=>h('option',{value:code,selected:draft.currency===code},code)));
    const heading=h('h3',{tabindex:'-1'},tr(['Personal finances','Vienna exchange','Review setup'][step]));
    const form=h('form',{class:'ng-entry-form',onsubmit:async event=>{
      event.preventDefault();
      try {
        const savings=savingsCents(draft.savings),cash=savingsCents(draft.cash);
        if(savings===undefined||cash===undefined||cash<0)throw Error('Enter a valid amount.');
        if(savings!==null&&(!draft.sunday||latestSunday(draft.sunday)!==draft.sunday||draft.sunday>latestSunday()))
          throw Error('Choose an ending Sunday.');
        if(draft.departure&&draft.returning&&draft.departure>draft.returning)throw Error('Return must be on or after departure.');
        if(step<2){step++;draw();return;}
        submit.disabled=true;
        if(revision!==ledger.revision)throw Error('Records changed in another tab. Reopen setup to continue.');
        const next=clone(ledger);
        next.settings.currency=draft.currency;
        if(draft.departure)next.settings.departure_date=draft.departure;
        if(draft.returning)next.settings.return_date=draft.returning;
        if(savings!==null)saveSundaySavings(next.settings,draft.sunday,savings);
        if(canSetCash&&cash!==null)next.records.push({id:crypto.randomUUID(),revision:1,entity:'balance',
          data:{scope:'EXCHANGE',description:tr('Exchange cash'),amount:cash/100,currency:'HKD',as_of:today()},reconciliation:[]});
        next.settings.setup_complete=true;
        await save(next,'Complete Workie setup',next.revision);
        localStorage.removeItem(welcomePreference);await close();navigate('Home');
      } catch(problem) {
        error.textContent=tr(problem.message);submit.disabled=false;
      }
    }});
    const review=(title,value)=>h('div',{},h('dt',{},tr(title)),h('dd',{},value??tr('Not provided')));
    const date=(value)=>value?compactDate(value,{day:'numeric',month:'short',year:'numeric'}):null;
    if(step===0)form.append(entryField('Preferred currency',currency),
      entryField('Sunday Savings (optional)',bind('savings',{name:'setup_savings',type:'text',inputmode:'decimal'})),
      entryField('Sunday ending date',bind('sunday',{name:'setup_sunday',type:'date',max:latestSunday()})));
    else if(step===1){
      form.append(entryField('Departure date (optional)',bind('departure',{name:'setup_departure',type:'date'})),
        entryField('Return date (optional)',bind('returning',{name:'setup_return',type:'date'})));
      if(canSetCash)form.append(entryField('Cash set aside for Vienna (HKD, optional)',
        bind('cash',{name:'setup_cash',type:'text',inputmode:'decimal'})));
    }
    else form.append(h('dl',{class:'ng-welcome-review'},review('Preferred currency',draft.currency),
      review('Sunday Savings',draft.savings.trim()?amount(savingsCents(draft.savings),'HKD'):null),
      review('Departure date',date(draft.departure)),review('Return date',date(draft.returning)),
      canSetCash?review('Vienna cash',draft.cash.trim()?amount(savingsCents(draft.cash),'HKD'):null):null));
    const submit=h('button',{type:'submit',class:'ng-button primary'},tr(step===2?'Enter Workie':'Continue'));
    form.append(error,h('div',{class:'ng-actions'},submit,button(tr('Back'),async()=>{
      if(step){step--;draw();}else {await close();onboarding();}
    })));
    panel.replaceChildren(heading,form);
    if(panel.isConnected)heading.focus({preventScroll:true});
  }
  modal.append(panel);draw();
}
function aiSetup(modal,close) {
  const trips=ledger.records.filter(row=>row.entity==='trip'&&row.data.status!=='CANCELLED');
  if(!['vienna','subsidy',...trips.map(row=>row.id)].includes(aiSetupSelection))aiSetupSelection='vienna';
  const options=[['vienna',tr('Vienna Budget')],['subsidy',tr('Subsidy')],...trips.map(row=>[row.id,row.data.description])];
  const choice=h('select',{name:'setup_context',onchange:event=>{aiSetupSelection=event.target.value;}},
    ...options.map(([value,label])=>h('option',{value,selected:value===aiSetupSelection},label)));
  const transferAction=action=>async()=>{
    const selected=choice.value;
    const scope=selected==='vienna'?null:selected==='subsidy'?subsidyScope:selected;
    const label=options.find(([value])=>value===selected)[1];
    await close();action(scope,label,()=>onboarding('ai'));
  };
  const error=h('p',{class:'ng-entry-error',role:'alert'});
  const tripName=h('input',{name:'setup_trip',maxlength:120,required:true});
  const create=h('form',{class:'ng-entry-form',onsubmit:async event=>{
    event.preventDefault();
    if(!tripName.value.trim())return;
    create.querySelector('button').disabled=true;
    try{
      const {next}=await prepareOperations(ledger,[{op:'ADD',entity:'trip',data:{description:tripName.value.trim(),status:'PLANNED'}}]);
      aiSetupSelection=next.records.at(-1).id;
      await save(next,'Create trip for setup');
      await close();onboarding('ai');
    }catch(problem){error.textContent=tr(problem.message);create.querySelector('button').disabled=false;}
  }},entryField('Trip name',tripName),h('button',{class:'ng-button',type:'submit'},tr('Create trip')),error);
  modal.append(h('p',{class:'ng-caption'},tr('Copy instructions to your AI chat, then bring the final changes back here.')),
    entryField('Choose setup context',choice),
    h('div',{class:'ng-actions'},
      actionButton('Export to AI','export',transferAction(exportBudgetToAI),{kind:'primary'}),
      actionButton('Import from AI','import',transferAction(importBudgetFromAI))),
    h('details',{class:'ng-entry-options'},h('summary',{},tr('Add a trip')),create),
    button(tr('Done'),async()=>{
      try {
        const next=clone(ledger);next.settings.setup_complete=true;
        await save(next,'Finish AI setup');localStorage.removeItem(welcomePreference);
        await close();navigate('Home');
      } catch(problem) {error.textContent=tr(problem.message);}
    }));
}
function recordRow(row,folio=false) {
  const data=row.data,flags=[];
  if(isSnapshotSettlement(row))flags.push('Wallet settlement estimate');
  const due=paymentUrgency(data);
  if(due.rank<3)flags.push(due.label);
  if(data.priority==='HIGH') flags.push('High priority');
  if(row.origin && data.category===null) flags.push('Choose category');
  const value=data.amount===null || data.amount===undefined?'':amount(Math.round(data.amount*100),data.currency??'HKD');
  const budget=['budget_item','trip_budget_item'].includes(row.entity);
  const participantShare=data.participants?.find(participant=>participant.self)?.share??data.share??1;
  const annotation=budget?[data.subcategory,optionLabels[data.frequency]??'One-off',
    participantShare!==1?'Your share '+(participantShare*100).toFixed(1)+'%':''].filter(Boolean).join(' · '):
    row.entity==='course'?'Credits '+data.credits+' · Home '+optionLabels[data.home_approval]+' · Host '+optionLabels[data.host_approval]:'';
  const remaining=budget?renderedModel?.obligations.find(item=>item.id===row.id):null;
  const paymentIds=new Set(budget?ledger.records.filter(payment=>payment.data.budget_item_id===row.id||
    payment.entity==='cash_event'&&payment.data.kind==='SECURITY_PAYMENT'&&payment.data.related_id===row.id)
    .filter(payment=>!payment.data.voided).map(payment=>payment.id):[]);
  const refunds=paymentIds.size?ledger.records.filter(payment=>payment.entity==='cash_event'&&payment.data.kind==='REFUND'&&
    !payment.data.voided&&payment.data.date<=today()&&paymentIds.has(payment.data.related_id)): [];
  const refunded=refunds.map(payment=>convert(ledger,payment.data.amount,payment.data.currency,payment.data.date));
  const actions=[];
  if(row.entity==='student')actions.push(button(tr('Student details'),()=>studentInspector(row)));
  if(row.entity==='grant')actions.push(actionButton('Record grant receipt','payment',()=>edit('cash_event',null,
    {description:'Grant receipt · '+data.description,kind:'INCOME',related_id:row.id,currency:data.currency||'HKD'})));
  if(row.entity==='loan')actions.push(button('Record draw',()=>edit('cash_event',null,
    {description:'Loan draw · '+data.description,kind:'LOAN_DRAW',related_id:row.id,currency:data.currency||'HKD'})),
    button('Record repayment',()=>edit('cash_event',null,
      {description:'Loan repayment · '+data.description,kind:'LOAN_REPAYMENT',related_id:row.id,currency:data.currency||'HKD'})));
  if(budget&&!folio&&data.kind!=='RESERVE')actions.push(button('Link payment',()=>data.kind==='SECURITY_DEPOSIT'?
    edit('cash_event',null,{description:data.description,kind:'SECURITY_PAYMENT',related_id:row.id,currency:data.currency}):
    edit('expense',null,{description:data.description,budget_item_id:row.id,trip_id:data.trip_id,currency:data.currency})));
  if(budget)actions.push(button(tr(data.completed_on?'Reopen item':'Mark complete'),()=>settleBudget(row,data.completed_on?null:today())));
  if(row.entity==='expense'&&!isSnapshotSettlement(row)||row.entity==='cash_event'&&data.kind==='SECURITY_PAYMENT') {
    actions.push(button('Record refund',()=>edit('cash_event',null,
      {description:'Refund · '+data.description,kind:'REFUND',related_id:row.id,currency:data.currency})));
  }
  if(['expense','grant'].includes(row.entity)) actions.push(button(row.entity==='expense'?'Attach receipt':'Attach document',()=>attachDocument(null,row.id)));
  if(typeof data.source==='string' && /^https?:\/\/\S+$/.test(data.source)) {
    actions.push(h('a',{href:data.source,target:'_blank',rel:'noopener noreferrer',class:'ng-button'},tr('Open source')));
  }
  const documents=ledger.records.filter(record=>record.entity==='document'&&record.data.owner_id===row.id);
  for(const documentRow of documents) {
    if(ledger.attachments?.[documentRow.id]) actions.push(button(documentRow.data.file_name,()=>{
      const link=h('a',{href:ledger.attachments[documentRow.id],download:documentRow.data.file_name});
      document.body.append(link);link.click();link.remove();
    }));
  }
  const linkedBudget=row.entity==='task'&&ledger.records.find(item=>item.id===data.budget_item_id);
  if(linkedBudget)actions.push(button(tr('Open linked budget item'),()=>edit(linkedBudget.entity,linkedBudget)));
  if(row.entity==='task') actions.push(button(tr(data.done?'Reopen':'Complete'),()=>run(async()=>{
    const prepared=await prepareBatch(ledger,JSON.stringify({protocol:'workie-transfer',version:1,batch_id:crypto.randomUUID(),
      operations:[{op:'UPDATE',entity:row.entity,record_id:row.id,expected_revision:row.revision,changes:{done:!data.done}}]}));
    await save(prepared.next,'Update task');
  })));
  if(row.entity==='document') {
    if(ledger.attachments?.[row.id]) actions.push(button(tr('Download'),()=>{
      const link=h('a',{href:ledger.attachments[row.id],download:data.file_name});document.body.append(link);link.click();link.remove();
    }));
    actions.push(button(ledger.attachments?.[row.id]?'Replace file':'Attach file',()=>attachDocument(row)));
  }
  const recordActions=h('div',{class:'ng-record-actions'},...actions,
    actionButton('Edit','Pencil',()=>edit(row.entity,row),{only:true}),
    actionButton('Delete','Trash2',()=>remove(row),{kind:'danger',only:true}));
  if(folio===true) {
    const during=Boolean(ledger.settings.departure_date&&today()>=ledger.settings.departure_date);
    const state=remaining?.complete?'Complete':!remaining?.linkedPayments?'Unpaid':remaining.cents===0?'Paid':'Partly paid';
    const metadata=[data.due_date?tr('Due')+' '+compactDate(data.due_date):null,data.subcategory,
      data.frequency&&data.frequency!=='ONCE'?tr(optionLabels[data.frequency]??data.frequency):null].filter(Boolean);
    const actions=h('div',{class:'ng-budget-row-actions'},
      data.kind!=='RESERVE'?actionButton('Record payment','payment',()=>openBudgetPayment(row),{only:true}):null,
      commandMenu(tr('Actions for')+' '+data.description,recordActions,
          remaining?.deposit?h('p',{class:'ng-caption'},tr('Refundable deposit')):null,
          participantShare!==1?h('p',{class:'ng-caption'},tr('Your share')+' '+(participantShare*100).toFixed(1)+'%'):null,
          data.confidence?h('p',{class:'ng-caption'},tr(optionLabels[data.confidence]??data.confidence)):null,
          data.kind==='RESERVE'?h('p',{class:'ng-caption'},tr('Emergency reserve')):null));
    return h('article',{class:'folio-budget-item','data-record-id':row.id,'data-urgency':String(due.rank)},
      h('button',{type:'button',class:'folio-budget-open',onclick:()=>edit(row.entity,row)},
        h('span',{class:'folio-budget-name'},h('strong',{},data.description),
          metadata.length?h('small',{},metadata.join(' · ')):null,flags.length?h('small',{class:'folio-record-flag'},flags.map(tr).join(' · ')):null),
        h('span',{class:'folio-budget-money'},
          h('strong',{},during&&remaining?moneyText(remaining.paid):value),
          remaining?h('small',{},tr(state)+' · '+tr('Left')+' ',moneyText(remaining.cents)):null)),
      actions,remaining?budgetPaymentHistory(row,remaining):null);
  }
  return h('article',{class:'ng-record','data-record-id':row.id,'data-urgency':String(due.rank)},
    h('button',{type:'button',class:'ng-record-open',onclick:()=>edit(row.entity,row)},
      h('span',{},h('strong',{},data.description),h('small',{},[tr(names[row.entity]),data.date??data.due_date??'',
        tr(optionLabels[data.status]??data.status??''),...flags.map(tr)].filter(Boolean).join(' · ')),
        annotation?h('small',{},annotation):null,
        row.entity==='expense'&&data.payee?h('small',{},tr('Payee')+' · '+data.payee):null,
        remaining?h('small',{},'Plan '+amount(remaining.planned)+' · Paid '+amount(remaining.paid)+' · Remaining '+amount(remaining.cents)):null,
        refunded.length?h('small',{},tr('Refunded')+' '+amount(refunded.includes(null)?null:refunded.reduce((sum,value)=>sum+value,0))):null,
        budget&&data.confidence?h('small',{},tr(optionLabels[data.confidence]??data.confidence)):null,
        budget&&data.kind==='RESERVE'?h('small',{},tr('Emergency reserve')+' · '+tr('Held in the plan. Record spending separately.')):null,
        row.entity==='grant'&&data.expected_date?h('small',{},'Expected disbursement '+data.expected_date):null,
        row.entity==='loan'&&data.repayment_amount!=null?h('small',{},'Scheduled repayment '+amount(Math.round(data.repayment_amount*100),data.currency)+' · '+
          (optionLabels[data.repayment_frequency]??'Schedule pending')):null,
        data.source_date?h('small',{},'Source recorded '+data.source_date):null),
      h('b',{},value.replaceAll('\u00a0',' '))),
    recordActions);
}
const expandedPayments=new Set();
function openBudgetPayment(item,payment=null,refundFor=null) {
  const deposit=item.data.kind==='SECURITY_DEPOSIT';
  const entity=payment?.entity??(refundFor||deposit?'cash_event':'expense');
  const defaults=refundFor?
    {currency:refundFor.data.currency,description:tr('Refund')+' · '+refundFor.data.description,kind:'REFUND',related_id:refundFor.id}:
    deposit?{description:item.data.description,currency:item.data.currency,kind:'SECURITY_PAYMENT',related_id:item.id}:
      {description:item.data.description,currency:item.data.currency,category:item.data.category,type:'SPECIAL',
        budget_item_id:item.id,trip_id:item.data.trip_id??null};
  const opener=document.activeElement;
  opener.dataset.editorAnchor='payment-'+item.id;
  expandedPayments.add(item.id);
  edit(entity,payment,{...defaults,paymentFor:item.data.description,paymentItem:item.id});
}
function budgetPaymentHistory(item,obligation) {
  const selected=new Set([...obligation.paymentIds,...obligation.refundIds]);
  const payments=ledger.records.filter(row=>selected.has(row.id)).reverse().sort((a,b)=>b.data.date.localeCompare(a.data.date));
  const stats=[['Original budget',obligation.original],['Actual spending',obligation.paid],['Remaining',obligation.cents]];
  const settled=difference(obligation.original,obligation.paid);
  if(obligation.complete)stats.push([settled===null?'Settlement':settled<0?'Overspend':'Savings',settled]);
  const open=expandedPayments.has(item.id);
  return h('details',{class:'ng-linked-history',open,
    ontoggle:event=>{
      if(!event.target.isConnected)return;
      if(event.target.open)expandedPayments.add(item.id);else expandedPayments.delete(item.id);
    }},
    h('summary',{},icon('List'),tr('Payments'),h('small',{},String(payments.length)),icon('ChevronDown')),
    h('dl',{class:'ng-payment-totals'},...stats.map(([label,value])=>h('div',{},h('dt',{},tr(label)),h('dd',{},moneyText(value))))),
    ...payments.map(payment=>{
      const refund=payment.data.kind==='REFUND';
      const value=Math.round(payment.data.amount*100);
      return h('div',{class:'ng-linked-payment','data-payment-id':payment.id},
        h('div',{},h('strong',{},payment.data.description),h('small',{},compactDate(payment.data.date)+' · '+tr(refund?'Refund':'Payment'))),
        moneyText(refund?-value:value,payment.data.currency),
        h('div',{class:'ng-payment-actions'},
          actionButton(refund?'Edit refund':'Edit payment','Pencil',()=>openBudgetPayment(item,payment),{only:true}),
          refund?null:actionButton('Record refund','Undo2',()=>openBudgetPayment(item,null,payment),{only:true}),
          actionButton(refund?'Delete refund':'Delete payment','Trash2',()=>remove(payment),{only:true,kind:'danger'})));
    }),
    payments.length?null:h('p',{class:'ng-caption'},tr('No payments recorded.')));
}
function compactDate(date,options={day:'numeric',month:'short'}) {
  return new Intl.DateTimeFormat(ledger?.settings.language==='zh-Hant'?'zh-HK':'en-GB',{...options,timeZone:'UTC'})
    .format(new Date(date+'T00:00:00Z'));
}
function paymentUrgency(data,date=today()) {
  if(!data.due_date||data.done||data.status==='CANCELLED'||data.status==='已發放')return {rank:3};
  const days=(Date.parse(data.due_date+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000;
  if(days<0)return {rank:0,label:'Overdue'};
  if(days===0)return {rank:1,label:'Due today'};
  if(days<=7)return {rank:2,label:'Due within seven days'};
  return {rank:3};
}
function listView(workspace=view,host=content,{withWorkTools=true}={}) {
  if(host!==content) {
    if(!recordFilters.has(workspace))recordFilters.set(workspace,{query:'',entity:''});
  }
  const isEmbedded=host!==content;
  const filtersForSection=recordFilters.get(workspace);
  const entities=groups[workspace];
  const isWork=workspace==='Work';
  const tools=h('div',{class:'ng-tools'});
  const select=h('select',{'aria-label':tr('Record type'),onchange:event=>{
    if(isEmbedded){filtersForSection.entity=event.target.value;renderRows();}
    else {filterEntity=event.target.value;render();}
  }},
    h('option',{value:''},tr('All records')),...entities.map(entity=>h('option',{value:entity},tr(names[entity]))));
  select.value=isEmbedded?filtersForSection.entity:filterEntity;
  const search=h('input',{type:'search',placeholder:tr(workspace==='Expenses'?'Search expenses':'Search records'),
    value:isEmbedded?filtersForSection.query:query,'aria-label':tr('Search records'),
    oninput:event=>{if(isEmbedded)filtersForSection.query=event.target.value;else query=event.target.value;renderRows();}});
  tools.append(search,select);
  let expenseCategory=null,dateError=null;
  if(workspace==='Expenses') {
    const linkedCategories=new Map(ledger.records.filter(row=>['budget_item','trip_budget_item'].includes(row.entity)).map(row=>[row.id,row.data.category]));
    expenseCategory=row=>row.data.category??linkedCategories.get(row.data.budget_item_id);
    const type=h('select',{'aria-label':tr('Expense type filter'),onchange:event=>{expenseFilter.type=event.target.value;renderRows();}},
      h('option',{value:''},tr('Any expense type')),...['GENERAL','SPECIAL','UNCLASSIFIED'].map(value=>h('option',{value},tr(optionLabels[value]??'Historical, unclassified'))));
    type.value=expenseFilter.type;
    const category=h('select',{'aria-label':tr('Expense category filter'),onchange:event=>{expenseFilter.category=event.target.value;renderRows();}},
      h('option',{value:''},tr('All categories')),...CATEGORIES.map(row=>h('option',{value:row.id},row.label+' '+tr(row.name))));
    category.value=expenseFilter.category;
    const date=(key,label)=>h('label',{class:'ng-field'},h('span',{},tr(label)),
      h('input',{type:'date',value:expenseFilter[key],'aria-describedby':'ng-expense-filter-error',
        onchange:event=>{expenseFilter[key]=event.target.value;renderRows();}}));
    const resetExpense=button(tr('Clear filters'),()=>{
      filtersForSection.query='';filtersForSection.entity='';
      Object.assign(expenseFilter,{type:'',category:'',from:'',to:''});
      render();
      content.querySelector('#ng-section-expenses input[type="search"]')?.focus();
    });
    dateError=h('p',{id:'ng-expense-filter-error',class:'ng-inline-error',role:'alert'});
    tools.append(h('details',{class:'ng-subcategory-tools ng-expense-filter',open:expenseFiltersOpen,
      ontoggle:event=>{if(event.target.isConnected)expenseFiltersOpen=event.target.open;}},
      h('summary',{},tr('Filter by category or date')),
      h('div',{class:'ng-tools'},type,category,date('from','From date'),date('to','Through date'),resetExpense,dateError)));
  }
  const availableEntities=entities.filter(entity=>entity!=='document');
  const kind=h('select',{'aria-label':tr('New record type')},...availableEntities.map(entity=>
    h('option',{value:entity},tr(names[entity]))));
  const add=button(tr('Add '+names[availableEntities[0]].toLowerCase()),()=>edit(kind.value),'primary');
  kind.onchange=()=>{add.textContent=tr('Add '+names[kind.value].toLowerCase());};
  const actions=h('div',{class:'ng-actions ng-record-create'},kind,add);
  const rows=h('div',{id:isEmbedded?'ng-records-'+workspace.toLowerCase():'ng-records',class:'ng-surface'});
  const filters=h('div',{class:'ng-record-controls'},actions,tools);
  if(isWork&&withWorkTools) {
    host.append(h('details',{class:'folio-work-records'},h('summary',{},tr('Students, lessons & work records')),filters,rows));
  } else {
    host.append(filters,rows);
  }
  const date=today();
  function renderRows() {
    const text=isEmbedded?filtersForSection.query:query;
    const entity=isEmbedded?filtersForSection.entity:filterEntity;
    const invalidRange=workspace==='Expenses'&&expenseFilter.from&&expenseFilter.to&&expenseFilter.from>expenseFilter.to;
    if(dateError)dateError.textContent=invalidRange?tr('The end date must be on or after the start date.'):'';
    if(invalidRange){rows.replaceChildren(h('p',{class:'ng-empty'},tr('Choose a valid date range to see matching records.')));return;}
    const filtered=ledger.records.filter(row=>entities.includes(row.entity) &&
      (!entity || row.entity===entity) &&
      JSON.stringify(row.data).toLowerCase().includes(text.toLowerCase()) &&
      (workspace!=='Expenses'||((!expenseFilter.type||row.entity==='expense'&&(row.data.type??'UNCLASSIFIED')===expenseFilter.type)&&
        (!expenseFilter.category||row.entity==='expense'&&expenseCategory(row)===expenseFilter.category)&&
        (!expenseFilter.from||row.data.date&&row.data.date>=expenseFilter.from)&&(!expenseFilter.to||row.data.date&&row.data.date<=expenseFilter.to))))
      .sort((a,b)=>{
        const urgent=row=>paymentUrgency(row.data,date).rank;
        const priority={HIGH:0,MEDIUM:1,LOW:2};
        return urgent(a)-urgent(b) || (priority[a.data.priority]??1)-(priority[b.data.priority]??1) ||
          (a.data.due_date??'9999').localeCompare(b.data.due_date??'9999') || a.data.description.localeCompare(b.data.description);
      });
    const hasFilters=text||entity||workspace==='Expenses'&&Object.values(expenseFilter).some(Boolean);
    rows.replaceChildren(...(filtered.length?filtered.map(recordRow):[
      h('div',{class:'ng-empty-state'},h('h2',{},tr(hasFilters?'No matching records':'No records yet')),
        h('p',{class:'ng-caption'},tr(hasFilters?'Try another search or clear the filters.':'Add a record to start this workspace.')),
        hasFilters?button(tr('Clear filters'),()=>{
          if(isEmbedded)Object.assign(filtersForSection,{query:'',entity:''});
          else {query='';filterEntity='';filterCategory='';}
          if(workspace==='Expenses')Object.assign(expenseFilter,{type:'',category:'',from:'',to:''});
          render();
          (isEmbedded?content.querySelector('#'+host.id):content)?.querySelector('input[type="search"]')?.focus();
        }):null),
    ]));
  }
  renderRows();
  if(workspace==='Funding') fundingWorkspace(host);
  if(workspace==='Expenses') bills(host);
  if(workspace==='Administration') {
    actions.append(button(tr('Attach local document'),()=>attachDocument()));
    checklistTemplates(host);
    host.prepend(h('div',{class:'ng-admin-overview'},
      h('div',{class:'ng-admin-calendar'},milestones(),arrivalPanel()),reminderCentre()));
  }
  if(isWork&&withWorkTools) {workAnalytics(host);workCalendar(host);host.append(timerPanel());workDataTools(host);}
}
function workAnalytics(host=content) {
  const trend=incomeTrend(ledger),currencies=[...new Set(trend.flatMap(month=>month.byCurrency.map(value=>value.currency)))];
  const section=h('section',{class:'ng-surface ng-work-analytics'},h('h2',{},tr('Recorded income trend')),
    h('p',{class:'ng-caption'},'Monthly summaries replace class earnings in the same month and currency. Empty months have no recorded value.'));
  if(!trend.length)section.append(h('p',{class:'ng-empty'},'Confirm a lesson or add an income summary to start your recorded history.'));
  for(const currency of currencies) {
    const largest=Math.max(1,...trend.flatMap(month=>month.byCurrency.filter(value=>value.currency===currency).map(value=>value.total??0)));
    const readout=h('output',{id:'ng-work-income-'+currency,class:'ng-chart-readout',role:'status'},tr('Choose a month to inspect its recorded value.'));
    const choices=trend.map(month=>{
      const value=month.byCurrency.find(value=>value.currency===currency);
      const total=value?amount(value.total,currency):tr('No recorded value');
      const source=tr(value?.source==='MONTHLY_SUMMARY'?'Monthly summary':value?'Recorded lessons':'No recorded value');
      const label=[month.month,total,value?source:null].filter(Boolean).join(' · ');
      const track=h('span',{class:'ng-income-track','aria-hidden':'true','data-known':String(value?.total!=null)},h('span',{
        class:'ng-income-value',style:'height:'+((value?.total??0)/largest*100)+'%'}));
      const control=h('button',{type:'button',class:'ng-button ng-income-point','aria-label':label},track,h('small',{},month.month.slice(5)));
      return {key:month.month,label,total,source,control};
    });
    chartControls('income-'+currency,readout,choices);
    const chart=h('div',{class:'ng-income-chart',role:'group','aria-label':currency+' '+tr('Recorded monthly income')},...choices.map(choice=>choice.control));
    section.append(h('div',{class:'ng-income-instrument'},h('h3',{},currency),chart,readout,
      h('details',{class:'ng-chart-data'},h('summary',{},tr('Monthly income data')+' · '+currency),
        h('table',{class:'ng-table'},h('thead',{},h('tr',{},...['Month','Amount','Source'].map(label=>h('th',{scope:'col'},tr(label))))),
          h('tbody',{},...choices.map(choice=>h('tr',{},h('th',{scope:'row'},choice.key),h('td',{},choice.total),h('td',{},choice.source))))))));
  }
  const weeks=weeklyIncome(ledger);
  section.append(h('details',{class:'ng-plan-tools'},h('summary',{},'Weekly recorded income'),
    h('p',{class:'ng-caption'},'Monday to Sunday class records. Monthly summaries are shown in the monthly chart.'),
    weeks.length?h('table',{class:'ng-table'},h('thead',{},h('tr',{},h('th',{},'Week of'),h('th',{},'Recorded income'),h('th',{},'Entries'))),
      h('tbody',{},...weeks.map(row=>h('tr',{},h('th',{scope:'row'},row.week),h('td',{},amount(row.total,row.currency)),h('td',{},String(row.count)))))):
      h('p',{class:'ng-empty'},'No weekly class earnings recorded.')));
  const students=ledger.records.filter(row=>row.entity==='student');
  const attendance=students.map(student=>({student,value:studentAttendance(ledger,student.id)}));
  const largest=Math.max(1,...attendance.map(({value})=>value.hours));
  section.append(h('h3',{},tr('Attendance & recorded hours')),
    h('p',{class:'ng-caption'},'Completed sessions and historical income records with stored duration. Planned and cancelled lessons are shown separately.'),
    ...attendance.map(({student,value})=>{
      return h('div',{class:'ng-attendance-row'},button(student.data.description,()=>studentInspector(student)),
        h('span',{},value.sessions+' completed · '+value.hours.toFixed(2)+'h'+(value.unknownHours?' · '+value.unknownHours+' durations need review':'')),
        h('meter',{min:0,max:largest,value:value.hours,
          'aria-label':student.data.description+' recorded hours'}));
    }));
  host.prepend(section);
}
function studentInspector(student) {
  const value=studentAttendance(ledger,student.id),opener=document.activeElement;
  const modal=h('dialog',{class:'ng-search-dialog ng-student-inspector ng-settlement-sheet'});
  const close=()=>{modal.close();modal.remove();opener?.focus();};
  const {data}=student;
  const information=[
    ['Banknote','Hourly rate',amount(data.rate==null?null:Math.round(data.rate*100),data.currency)],
    ['Phone','Contact',data.contact],['MapPin','Location',data.location],['Map','Address',data.address],
  ].flatMap(([symbol,label,detail])=>detail?[h('div',{},h('dt',{},icon(symbol),tr(label)),h('dd',{},detail))]:[]);
  const hours=value.hours.toFixed(2)+(value.unknownHours?' · '+value.unknownHours+' '+tr('unknown durations'):'');
  const history=value.history.slice(0,40);
  modal.append(h('header',{class:'ng-student-heading'},
    h('div',{},h('h2',{},data.description),h('p',{class:'ng-caption'},[data.grade,data.subject].filter(Boolean).join(' · '))),
    actionButton('Close','X',close,{only:true})),
    h('div',{class:'ng-student-actions'},
      actionButton('Edit student','Pencil',()=>{close();edit('student',student);}),
      actionButton('Add lesson','CalendarPlus',()=>{close();edit('lesson',null,{student_id:student.id,
        description:'Lesson · '+data.description,currency:data.currency});})),
    h('dl',{class:'ng-student-facts'},...information),
    data.note?h('p',{class:'ng-student-note'},data.note):null,
    h('details',{class:'ng-week-bridge'},h('summary',{},h('span',{},icon('ChevronDown'),tr('Attendance and earnings'))),
      h('dl',{class:'ng-student-facts'},
        h('div',{},h('dt',{},tr('Completed sessions')),h('dd',{},String(value.sessions))),
        h('div',{},h('dt',{},tr('Recorded hours')),h('dd',{},hours)),
        h('div',{},h('dt',{},tr('Planned / cancelled')),h('dd',{},value.planned+' / '+value.cancelled)),
        ...value.byCurrency.map(entry=>h('div',{},h('dt',{},tr('Stored earnings')),h('dd',{},amount(entry.total,entry.currency)))))),
    h('h3',{},tr('Session history')),
    history.length?h('ul',{class:'ng-student-sessions'},...history.map(row=>h('li',{},h('button',{
      type:'button',class:'ng-study-row',onclick:()=>{close();edit(row.entity,row);}},
    icon(({CONFIRMED:'CircleCheck',CANCELLED:'CircleX',PLANNED:'CalendarDays'})[row.data.status]??'ReceiptText'),
    h('span',{},h('strong',{},row.data.date?compactDate(row.data.date,{day:'numeric',month:'short',year:'numeric'}):row.data.description),
      h('small',{},[tr(optionLabels[row.data.status]??'Historical earnings'),row.data.start_time??tr('Lesson time unspecified'),
        row.data.date&&row.data.description!==data.description?row.data.description:null].filter(Boolean).join(' · '))),icon('ChevronRight'))))):
      h('p',{class:'ng-caption'},tr('No sessions recorded.')));
  modal.addEventListener('cancel',event=>{event.preventDefault();close();});
  document.body.append(modal);openDialog(modal);
}
function fundingWorkspace(host=content) {
  const model=renderedModel;
  const accounts=accountBalances(ledger);
  const lead=h('section',{class:'ng-funding-lead'},h('div',{class:'ng-funding-readout'},
    h('h2',{},tr('Available now')),h('p',{},amount(model.available)),
    model.base&&model.available!==null?h('p',{class:'ng-caption'},tr('Balance confirmed through')+' '+model.base.data.as_of):
      h('p',{class:'ng-caption'},tr('Confirm the exchange balance to see available cash.'))),
    metrics(model,{includeAvailable:false}));
  const instruments=h('div',{class:'ng-funding-analysis'},fundingSources(model),
    accounts.length?h('section',{class:'ng-surface ng-account-balances'},h('h2',{},tr('Account balances')),
      h('p',{class:'ng-caption'},tr('Account balances are a separate breakdown. Exchange cash appears above.')),
      h('dl',{},...accounts.map(account=>h('div',{},h('dt',{},account.description),
        h('dd',{},amount(account.cents,account.currency)),
        h('small',{},account.asOf?tr('Confirmed through')+' '+account.asOf:tr('Confirm an account balance to start')))))):null);
  host.prepend(lead,instruments);
}
function fundingSources(model) {
  const base=model.base?[{id:model.base.id,description:tr('Confirmed balance')+' · '+model.base.data.as_of,cents:model.baseline}]:[];
  const rows=[...base,...model.applied];
  const sources=rows.filter(row=>row.cents>0);
  const total=sources.reduce((sum,row)=>sum+row.cents,0);
  const isComplete=model.available!==null&&Number.isSafeInteger(total);
  const proportion=row=>isComplete&&row.cents>0?row.cents/total*100:null;
  const chart=isComplete&&sources.length?h('div',{class:'ng-source-composition','aria-hidden':'true'},
    ...sources.map((row,index)=>h('span',{style:'width:'+proportion(row)+'%',class:'ng-source-segment ng-source-'+index%4})))
    :h('p',{class:'ng-caption'},tr(isComplete?'No positive funding recorded.':'Reconcile the balance and missing amounts to see funding proportions.'));
  const output=h('output',{id:'ng-funding-source-readout',class:'ng-chart-readout',role:'status'},tr('Choose an entry to inspect its amount.'));
  const choices=rows.map(row=>{
    const index=sources.indexOf(row),share=proportion(row);
    const details=[row.description,amount(row.cents),share===null?null:share.toFixed(1)+'%'].filter(Boolean).join(' · ');
    const control=h('button',{type:'button',class:'ng-button'},
      index>=0&&isComplete?h('span',{class:'ng-source-dot ng-source-'+index%4,'aria-hidden':'true'}):null,
      h('span',{},row.description+' · '+amount(row.cents)));
    return {key:row.id??row.description,label:details,control,segment:isComplete&&index>=0?chart.children[index]:null};
  });
  chartControls('funding',output,choices);
  const table=rows.length?h('details',{class:'ng-chart-data'},h('summary',{},tr('Funding source data')),
    h('table',{class:'ng-table'},h('thead',{},h('tr',{},...['Source','Amount','Share of inflows'].map(label=>h('th',{scope:'col'},tr(label))))),
      h('tbody',{},...rows.map(row=>h('tr',{},h('th',{scope:'row'},row.description),h('td',{},amount(row.cents)),
        h('td',{},proportion(row)===null?'—':proportion(row).toFixed(1)+'%')))))):null;
  return h('section',{class:'ng-surface ng-funding-instrument'},h('h2',{},tr('Funding sources')),
    chart,h('p',{class:'ng-caption'},tr('The chart shows positive funding before outflows. Loans remain liabilities.')),
    choices.length?h('div',{class:'ng-source-legend',role:'group','aria-label':tr('Funding sources')},...choices.map(choice=>choice.control)):null,
    choices.length?output:null,table);
}
function reminderCentre() {
  const current=today();
  const horizon=new Date(Date.parse(current+'T00:00:00Z')+14*86400000).toISOString().slice(0,10);
  const reminders=ledger.records.flatMap(row=>{
    const data=row.data;
    if(row.entity==='task'&&!data.done&&data.due_date&&data.due_date<=horizon)return [{row,date:data.due_date,label:'Task due'}];
    if(row.entity==='course'&&[data.home_approval,data.host_approval].includes('PENDING')&&data.due_date&&data.due_date<=horizon)
      return [{row,date:data.due_date,label:'Course approval'}];
    if(row.entity==='grant') {
      if(data.status==='已批核等待發放'&&data.expected_date&&data.expected_date<=horizon)return [{row,date:data.expected_date,label:'Expected grant disbursement'}];
      if(data.status==='可申請'&&data.due_date&&data.due_date<=horizon)return [{row,date:data.due_date,label:'Grant application deadline'}];
    }
    if(['trip_budget_item','budget_item'].includes(row.entity)&&data.trip_id&&activeBudget(ledger,row)&&data.due_date&&data.due_date<=horizon&&
      renderedModel.obligations.find(item=>item.id===row.id)?.cents!==0)return [{row,date:data.due_date,label:'Journey payment due'}];
    return [];
  });
  const start=new Date(Date.parse(current+'T00:00:00Z')-30*86400000).toISOString().slice(0,10);
  for(const occurrence of billOccurrences(ledger,start,44).filter(row=>!row.paid&&row.data.active!==false))reminders.push({occurrence,date:occurrence.date,label:'Unpaid fixed bill'});
  reminders.sort((a,b)=>a.date.localeCompare(b.date));
  return h('section',{class:'ng-surface'},h('h2',{},'Reminders'),
    h('p',{class:'ng-caption'},'Due and upcoming records through '+horizon+'. Reminders update when you open Workie and are available offline.'),
    reminders.length?h('ol',{class:'ng-timeline'},...reminders.map(({row,occurrence,date,label})=>h('li',{},
      h('time',{datetime:date},date+(date<current?' · Overdue':'')),
      button(row?.data.description??occurrence.data.description,()=>row?edit(row.entity,row):
        edit('bill_payment',null,{description:occurrence.data.description,amount:occurrence.data.amount,
          currency:occurrence.data.currency,rule_id:occurrence.id,period_date:date})),h('small',{},label)))):
      h('p',{class:'ng-empty'},'No pending reminders in this period.'));
}
const arrivalTasks=['Confirm accommodation access and contact','Review saved arrival and registration instructions',
  'Check the next university appointment','Keep emergency and insurance contacts accessible'];
async function addChecklist(group,descriptions) {
  const next=clone(ledger);
  const missing=descriptions.filter(description=>!next.records.some(row=>row.entity==='task'&&row.data.group===group&&row.data.description===description));
  if(!missing.length){say(tr('These checklist items already exist.'));return;}
  for(const description of missing)next.records.push({id:crypto.randomUUID(),revision:1,entity:'task',
    data:{description,group,done:false,due_date:null,note:'Planning prompt. Review dates and requirements using your own official source.'}});
  await save(next,'Add '+group+' checklist');
  say(missing.length+' '+tr('items added. Add verified dates where needed.'));
}
function arrivalPanel() {
  const zone='Europe/Vienna',saved=ledger.settings.arrival_time;
  const start=Number.isFinite(saved?.instant)?saved.instant:null;
  const time=h('input',{type:'datetime-local',required:true,value:saved?.local??''});
  const repeated=h('select',{'aria-label':tr('Occurrence of local arrival time'),hidden:true},
    h('option',{value:''},tr('Choose an occurrence')),h('option',{value:'0'},tr('First occurrence')),h('option',{value:'1'},tr('Second occurrence')));
  const error=h('p',{class:'ng-inline-error',role:'alert'});
  time.oninput=()=>{repeated.hidden=true;repeated.value='';error.textContent='';};
  const form=h('form',{class:'ng-arrival-form',onsubmit:event=>{
    event.preventDefault();
    const [date,localTime]=time.value.split('T');
    const candidates=possibleLessonTimes(date,localTime,zone);
    if(!candidates.length){error.textContent=tr('This arrival time does not exist in Vienna. Choose a different local time.');return;}
    if(candidates.length>1&&repeated.value===''){
      repeated.hidden=false;repeated.focus();error.textContent=tr('This local time occurs twice. Choose the verified occurrence.');return;
    }
    run(async()=>{
      const next=clone(ledger);
      next.settings.arrival_time={local:time.value,instant:candidates[Number(repeated.value)]};
      await save(next,'Set arrival time');
    });
  }},h('label',{class:'ng-field'},h('span',{},tr('Arrival time in Vienna')),time),repeated,
    h('button',{type:'submit',class:'ng-button'},tr('Save arrival time')),error);
  const now=Date.now(),end=start===null?null:start+72*3600000;
  const format=value=>new Intl.DateTimeFormat(ledger.settings.language??'en',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(value);
  const windowStatus=start===null?'Set your arrival time to see the 72-hour window.':
    now<start?'Before arrival':now<end?'Arrival window in progress':'Arrival window ended';
  const tasks=ledger.records.filter(row=>row.entity==='task'&&row.data.group==='ARRIVAL');
  return h('section',{class:'ng-surface ng-arrival','aria-labelledby':'ng-arrival-title'},
    h('h2',{id:'ng-arrival-title'},tr('First 72 hours')),
    h('p',{class:'ng-caption',role:'status'},tr(windowStatus)),
    start===null?null:h('p',{class:'ng-arrival-window'},h('time',{datetime:new Date(start).toISOString()},format(start)),
      ' – ',h('time',{datetime:new Date(end).toISOString()},format(end)),' · ',tr('Vienna')),
    form,
    ...tasks.map(row=>h('div',{class:'ng-arrival-task','data-arrival-task':row.id},
      h('label',{class:'ng-check'},h('input',{type:'checkbox',checked:row.data.done,onchange:event=>run(async()=>{
        const next=clone(ledger),task=next.records.find(item=>item.id===row.id);
        task.data.done=event.target.checked;task.revision++;await save(next,'Update arrival checklist');
        content.querySelector('[data-arrival-task="'+CSS.escape(row.id)+'"] input')?.focus({preventScroll:true});
      })}),h('span',{},row.data.description)),
      row.data.due_date?h('time',{datetime:row.data.due_date},row.data.due_date):null,
      button(tr('Edit task'),()=>edit('task',row)))),
    arrivalTasks.some(description=>!tasks.some(row=>row.data.description===description))?
      button(tr('Add arrival checklist'),()=>run(()=>addChecklist('ARRIVAL',arrivalTasks)),tasks.length?'':'primary'):null);
}
function checklistTemplates(host=content) {
  const templates={
    VISA:['Save the current official Visa D instructions','Review documents against your saved official checklist','Record your application and collection dates'],
    UNIVERSITY:['Record host-university deadlines','Keep university contact details available offline','Review your registration confirmation'],
    HOUSING:['Compare lease dates, monthly cost and refundable deposit','Save the accommodation quote and source','Record the reservation status'],
    GRANT:['Save the grant application source and due date','Record the current approval stage','Review the expected disbursement date'],
    INSURANCE:['Save the policy or cover confirmation','Keep insurer contact details offline','Review outstanding insurance / ÖGK steps against the official source'],
    ARRIVAL:arrivalTasks,
    RETURN:['Record the checkout / handover date','Review deposit-refund instructions and contact','Record refunds only when actually received','Export a complete backup before handoff'],
    PACKING:['Review required documents for this trip','Check chargers and personal essentials','Review the items you need for the trip conditions'],
  };
  const select=h('select',{'aria-label':tr('Checklist template')},...Object.keys(templates).map(key=>h('option',{value:key},tr(optionLabels[key]??key))));
  host.prepend(h('section',{class:'ng-surface'},h('h2',{},tr('Prepare your exchange')),
    h('p',{class:'ng-caption'},'Start with a planning checklist, then add your verified dates and official sources.'),
    h('div',{class:'ng-actions'},select,button(tr('Add checklist'),()=>run(()=>addChecklist(select.value,templates[select.value])))),
    h('div',{class:'ng-administration-links'},
      h('h3',{},tr('University / ÖH fee')),
      button(tr('Plan university / ÖH fee'),()=>edit('budget_item',null,
        {description:'University / ÖH fee',subcategory:'University fees',priority:'MEDIUM',due_date:null})),
      button(tr('Track university / ÖH deadline'),()=>edit('task',null,
        {description:'University / ÖH fee',group:'UNIVERSITY',due_date:null})))));
}
function budgetWorkspace(trip=null) {
  const key=trip?.id??null;
  const position=planPosition(renderedModel,key);
  const records=renderedModel.budgetRows.filter(row=>budgetScope(row)===key);
  const original=sumKnown(position.obligations.map(item=>item.original));
  const actual=trip?tripActual(ledger,position,trip.id):sumKnown(position.obligations.map(item=>item.paid));
  const during=Boolean(ledger.settings.departure_date&&today()>=ledger.settings.departure_date);
  const entity=trip?'trip_budget_item':'budget_item';
  const defaults={priority:'MEDIUM',currency:trip?.data.currency??'HKD',
    ...(trip?{trip_id:trip.id,scenario:trip.data.scenario??'Base'}:{scenario:ledger.settings.scenario})};
  const labels=during||trip?
    [['Actual expenditure',actual],['Original budget',original],['Still to pay',position.total],
      ['Savings / overspend',difference(original,sumKnown([actual,position.total]))]]:
    [['Planned expenditure',sumKnown(position.obligations.map(item=>item.planned))],['Paid so far',actual],['Still to pay',position.total]];
  const add=category=>edit(entity,null,{...defaults,category});
  const summary=h('section',{class:'ng-final-budget-summary','data-budget-scope':key??'vienna','data-budget-phase':during?'actual':'planned'},
    trip?h('h2',{},trip.data.description):null,
    h('dl',{class:'ng-plan-summary'},...labels.map(([label,value])=>h('div',{},h('dt',{},tr(label)),h('dd',{},moneyText(value))))),
    h('div',{class:'ng-actions ng-budget-command'},actionButton('Add budget item','budget',()=>add(trip?undefined:filterCategory||undefined),{kind:'primary',display:'Add item'}),
      actionButton('Export to AI','export',()=>exportBudgetToAI(key,trip?.data.description??tr('Vienna Budget')),{display:'AI export'}),
      actionButton('Import from AI','import',()=>importBudgetFromAI(key,trip?.data.description??tr('Vienna Budget')),{display:'AI import'})));
  const chapters=h('div',{class:'ng-budget-chapters',id:'ng-records'});
  if(!budgetDisclosures.has(key))budgetDisclosures.set(key,new Set([filterCategory||CATEGORIES[0].id]));
  const expanded=budgetDisclosures.get(key);
  if(!trip&&filterCategory)expanded.add(filterCategory);
  for(const category of CATEGORIES) {
    const rows=records.filter(row=>row.data.category===category.id);
    const obligations=position.obligations.filter(item=>item.category===category.id);
    const section=h('details',{class:'ng-final-category','data-budget-category':category.id,open:expanded.has(category.id),
      ontoggle:event=>{if(event.target.open)expanded.add(category.id);else expanded.delete(category.id);}},
      h('summary',{},h('span',{},h('b',{},category.label),tr(category.name)),
        h('strong',{},moneyText(sumKnown(obligations.map(item=>item.cents)))),icon('ChevronDown')),
      ...rows.map(row=>recordRow(row,true)),
      rows.length?null:h('p',{class:'ng-caption'},tr('No items in this category.')),
      actionButton('Add '+category.name.toLowerCase()+' item','Plus',()=>add(category.id)));
    chapters.append(section);
  }
  const unassigned=records.filter(row=>!CATEGORIES.some(category=>category.id===row.data.category));
  if(unassigned.length) {
    const ids=new Set(unassigned.map(row=>row.id));
    const subtotal=sumKnown(position.obligations.filter(item=>ids.has(item.id)).map(item=>item.cents));
    chapters.append(h('details',{class:'ng-secondary'},h('summary',{},h('span',{},tr('Items needing a category')),
        h('small',{class:'ng-section-value'},String(unassigned.length)),icon('ChevronDown')),
      h('p',{class:'ng-caption'},tr('Included in the plan total, outside the category allocation.')+' ',moneyText(subtotal)),
      actionButton('Classify items','ListFilter',()=>classifyBudget(unassigned,!trip)),
      ...unassigned.map(row=>recordRow(row,true))));
  }
  content.append(summary,chapters);
}
function classifyBudget(rows,vienna) {
  const revision=ledger.revision;
  transferDialog(tr('Classify items'),(modal,close)=>{
    const suggestions=new Map(),fields=new Map();
    const status=h('p',{role:'alert',class:'ng-entry-error'});
    const controls=rows.map(row=>{
      const auto=vienna&&/\bvisa\s*d\b|[oö]gk|\binsurance\b|(?:phone|sim)\s*card|保[險险]|電話卡|簽證\s*d/i.test(row.data.description);
      if(auto)suggestions.set(row.id,'LEISURE');
      const select=h('select',{},h('option',{value:''},tr('Leave unchanged')),
        ...CATEGORIES.map(category=>h('option',{value:category.id},category.label+' '+tr(category.name))));
      fields.set(row.id,select);
      return h('label',{class:'ng-field'},h('span',{},row.data.description),select,
        auto?h('small',{class:'ng-caption'},tr('Suggested: Leisure → Other')):null);
    });
    const submit=h('button',{type:'submit',class:'ng-button primary',disabled:true},tr('Save categories'));
    const panel=h('form',{class:'ng-entry-form',onchange:update,onsubmit:async event=>{
      event.preventDefault();
      if(submit.disabled)return;
      submit.disabled=true;status.textContent='';
      try {
        if(revision!==ledger.revision)throw Error('Records changed. Open classification again.');
        const operations=rows.flatMap(row=>{
          const category=fields.get(row.id).value;
          if(!category)return [];
          const changes={category,...(category==='LEISURE'&&suggestions.has(row.id)?{subcategory:'Other'}:{})};
          return [{op:'UPDATE',entity:row.entity,record_id:row.id,expected_revision:row.revision,changes}];
        });
        if(!operations.length)return;
        const {next}=await prepareOperations(ledger,operations);
        await save(next,'Classify reviewed budget items',revision);
        await close();showUndo(revision,'Categories saved.');
      } catch(error){status.textContent=tr(error.message);}
      finally {update();}
    }},h('p',{class:'ng-caption'},tr('Changing categories changes their funding order. The saved amounts stay the same.')),
      suggestions.size?button(tr('Select suggestions'),()=>{for(const [id,category] of suggestions)fields.get(id).value=category;update();}):null,
      ...controls,status,submit);
    function update(){submit.disabled=![...fields.values()].some(control=>control.value);}
    modal.append(panel);
  });
}
function tripWorkspace() {
  const trips=ledger.records.filter(row=>row.entity==='trip').sort((a,b)=>
    (a.data.start_date??'9999').localeCompare(b.data.start_date??'9999')||a.data.description.localeCompare(b.data.description));
  const trip=trips.find(row=>row.id===currentTrip);
  if(trip) {
    const tasks=ledger.records.filter(row=>row.entity==='task'&&row.data.trip_id===trip.id);
    content.append(h('div',{class:'ng-trip-tools'},
      actionButton('All trips','ChevronLeft',()=>openTrip(null)),actionButton('Edit trip','Pencil',()=>edit('trip',trip),{only:true}),
      actionButton('Delete trip','Trash2',()=>remove(trip),{kind:'danger',only:true})));
    budgetWorkspace(trip);
    const dated=renderedModel.budgetRows.filter(row=>budgetScope(row)===trip.id&&row.data.due_date&&
      renderedModel.obligations.find(item=>item.id===row.id)?.cents!==0);
    content.append(h('details',{class:'ng-secondary'},h('summary',{},tr('Packing and payment reminders')),
      ...tasks.map(row=>recordRow(row)),
      ...dated.map(row=>h('p',{},compactDate(row.data.due_date)+' · '+row.data.description)),
      button(tr('Add packing item'),()=>edit('task',null,{trip_id:trip.id,group:'PACKING'}))));
    return;
  }
  const capacity=travelCapacity(renderedModel,trips);
  const limit=Math.max(1,Math.abs(capacity.cashAfter??0),Math.abs(capacity.expectedAfter??0));
  const capacityScale=(label,key)=>{
    const value=capacity[key];
    return h('div',{class:'ng-capacity-result'},
      h('div',{},h('dt',{},tr(label)),h('dd',{'data-travel-metric':key,'data-shortfall':String(value!==null&&value<0)},moneyText(value))),
      h('div',{class:'ng-capacity-track','aria-hidden':'true','data-known':String(value!==null)},
        value===null?null:h('span',{'data-negative':String(value<0),style:'--travel-span:'+Math.abs(value)/limit*50+'%'})));
  };
  const capacityPanel=h('section',{class:'ng-travel-capacity'},h('h2',{},tr('Travel capacity')),
    h('dl',{class:'ng-plan-summary'},...[
      ['Cash after Vienna','cash'],['With approved grants','expected'],['Selected trips outstanding','tripsOutstanding'],
    ].map(([label,key])=>h('div',{},h('dt',{},tr(label)),
      h('dd',{'data-travel-metric':key,'data-shortfall':String(capacity[key]!==null&&capacity[key]<0)},moneyText(capacity[key]))))),
    h('dl',{class:'ng-capacity-scale','aria-label':tr('Remaining capacity after selected trips')},
      capacityScale('Cash after trips','cashAfter'),capacityScale('With grants after trips','expectedAfter')),
    h('div',{class:'ng-actions'},actionButton('Add trip','trip',()=>edit('trip',null,{status:'PLANNED'}),{kind:'primary'})));
  const list=h('div',{class:'ng-trip-list'});
  for(const row of trips) {
    const plan=planPosition(renderedModel,row.id),spent=tripActual(ledger,plan,row.id);
    const meta=[row.data.destination,row.data.start_date?compactDate(row.data.start_date):null,
      tr(({PLANNED:'Selected',CONFIRMED:'Reserved',CANCELLED:'Cancelled'})[row.data.status]??'Selected')].filter(Boolean).join(' · ');
    list.append(h('button',{type:'button',class:'ng-trip-row','data-trip-id':row.id,onclick:()=>openTrip(row.id)},
      h('span',{},h('strong',{},row.data.description),h('small',{},meta)),
      h('span',{'data-trip-amounts':''},h('strong',{},moneyText(plan.total)),h('small',{},tr('Outstanding')),
        h('small',{},tr('Spent')+' ',moneyText(spent))),
      icon('ChevronRight')??h('b',{'aria-hidden':'true'},'›')));
  }
  if(!trips.length)list.append(h('p',{class:'ng-empty'},tr('Add a trip to give it a separate budget.')));
  content.append(h('div',{class:'ng-trips-layout'},capacityPanel,
    h('section',{class:'ng-trips-portfolio'},h('h2',{},tr('Trip plans')),list)));
}
function openTrip(id) {
  if(currentTrip===id)return;
  currentTrip=id;
  history.pushState({...history.state,workieRoute:'Trips',workieTrip:id},'');
  render();
  window.scrollTo({top:0,behavior:'instant'});
  pageHeading().focus({preventScroll:true});
}
function settleBudget(row,completed_on) {
  return run(async()=>{
    const batch={protocol:'workie-transfer',version:1,batch_id:crypto.randomUUID(),
      operations:[{op:'UPDATE',entity:row.entity,record_id:row.id,expected_revision:row.revision,changes:{completed_on}}]};
    const prepared=await prepareBatch(ledger,JSON.stringify(batch));
    await save(prepared.next,completed_on?'Complete budget item':'Reopen budget item');
  });
}
function workCalendar(host=content) {
  const dayAt=(date,offset)=>new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
  const monday=date=>dayAt(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));
  const anchor=workDays===7?monday(workDate):workDate;
  const dates=Array.from({length:workDays},(_,index)=>dayAt(anchor,index));
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:workZone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const localParts=instant=>{
    const parts=Object.fromEntries(formatter.formatToParts(instant).map(part=>[part.type,part.value]));
    return {date:parts.year+'-'+parts.month+'-'+parts.day,minutes:Number(parts.hour)*60+Number(parts.minute)};
  };
  const lessons=ledger.records.filter(row=>row.entity==='lesson'&&row.data.status!=='CANCELLED');
  const unscheduled=[];
  const visible=lessons.flatMap(row=>{
    try {
      const local=localParts(new Date(lessonInterval(row.data).start));
      return dates.includes(local.date)?[{row,...local}]:[];
    } catch {unscheduled.push(row);return [];}
  });
  const refresh=()=>{
    try {sessionStorage.setItem('workie_calendar_view',JSON.stringify({days:workDays,date:workDate,zone:workZone}));} catch {}
    render();
  };
  const shift=days=>{
    workDate=dayAt(workDate,days);refresh();
  };
  const date=h('input',{type:'date',value:workDate,'aria-label':tr('Calendar date'),onchange:event=>{
    workDate=event.target.value||localParts(new Date()).date;showCurrentHour=false;refresh();
  }});
  const step=(label,symbol,delta)=>{
    const control=button(symbol,()=>shift(delta));control.setAttribute('aria-label',tr(label));return control;
  };
  const nowButton=button(tr('Now'),()=>{
    workDate=localParts(new Date()).date;showCurrentHour=true;workMobileGrid=true;refresh();
    content.querySelector('.ng-calendar-now')?.scrollIntoView({block:'center',inline:'center'});
  });
  const modes=h('div',{class:'ng-calendar-modes',role:'group','aria-label':tr('Days in calendar')},...[1,3,7].map(days=>{
      const item=button(tr(days+' day'),()=>{workDays=days;refresh();});
      item.setAttribute('aria-pressed',String(workDays===days));return item;
  }));
  const calendarTools=h('details',{class:'ng-calendar-tools'},h('summary',{},tr('Calendar tools')),
    h('div',{class:'ng-actions'},date,modes,nowButton,button(tr('Export calendar (.ics)'),()=>{
      const entries=visible.map(({row})=>({id:row.id,date:row.data.date,startTime:row.data.start_time,duration:row.data.duration,timeZone:row.data.time_zone??'Asia/Hong_Kong',
          ...(row.data.start_at?{occurrenceAt:Date.parse(row.data.start_at)}:{})}));
      const exported=window.WorkieCalendar.buildCalendar(entries,{resolve:possibleLessonTimes,now:Date.now(),defaultZone:'Asia/Hong_Kong'});
      if(!exported.count){say('No lessons with verified times in this range.');return;}
      download(exported.ics,'workie-lessons-'+workDate+'.ics','text/calendar;charset=utf-8');
      say(exported.count+' lessons exported. '+exported.skipped+' uncertain times skipped.');
    }),button(tr('Generate next six weeks'),()=>run(async()=>{
      const proposed=generateSeries(ledger,workDate);
      if(!proposed.added.length){say(proposed.conflicts.length?proposed.conflicts.map(row=>row.date+' '+row.message).join(' · '):'All eligible lessons already exist.');return;}
      const message='Add '+proposed.added.length+' lessons?'+(proposed.conflicts.length?'\nConflicting dates will be skipped\n'+proposed.conflicts.map(row=>row.date+' '+row.description).join('\n'):'');
      if(window.confirm(message))await save(proposed.next,'Generate recurring lessons');
    }))));
  const workDisplay=button(tr(workMobileGrid?'Show agenda':'Show time grid'),()=>{
    workMobileGrid=!workMobileGrid;refresh();content.querySelector('.folio-work-display')?.focus();
  });
  workDisplay.classList.add('folio-work-display');
  const toolbar=h('div',{class:'folio-calendar-toolbar'},
    h('div',{class:'folio-calendar-range'},
      h('p',{class:'folio-label'},tr('Hong Kong time')),
      h('p',{class:'folio-range-title'},workDays===1?compactDate(anchor):compactDate(anchor)+' – '+compactDate(dates.at(-1)))),
    h('div',{class:'folio-calendar-controls'},step('Previous','‹',-workDays),
      button(tr('Today'),()=>{workDate=localParts(new Date()).date;refresh();}),step('Next','›',workDays),calendarTools),
    button(tr('Add lesson'),()=>edit('lesson',null,{date:workDate,time_zone:workZone}),'primary'));
  const grid=h('div',{class:'ng-calendar',style:'--days:'+workDays});
  const now=localParts(new Date());
  const offHours=(start,end)=>start<480||end>1320;
  const showFullDay=visible.some(entry=>offHours(entry.minutes,entry.minutes+entry.row.data.duration*60))||
    showCurrentHour&&dates.includes(now.date)&&offHours(now.minutes,now.minutes);
  const startMinute=showFullDay?0:480;
  const endMinute=startMinute===0?1440:1320;
  const rail=h('div',{class:'folio-hour-rail','aria-hidden':'true'});
  const hourMarkers=()=>Array.from({length:(endMinute-startMinute)/60+1},(_,index)=>{
    const minute=startMinute+index*60;
    return h('span',{class:'ng-hour','aria-hidden':'true',style:'top:'+(index*60/(endMinute-startMinute)*100)+'%'},clockTime(minute));
  });
  rail.append(...hourMarkers());
  for(const date of dates) {
    const events=h('div',{class:'ng-day-events','data-calendar-date':date});
    if(now.date===date&&now.minutes>=startMinute&&now.minutes<=endMinute)events.append(h('span',{class:'ng-calendar-now',
      style:'top:'+((now.minutes-startMinute)/(endMinute-startMinute)*100)+'%'},h('time',{datetime:clockTime(now.minutes)},clockTime(now.minutes))));
    events.append(...hourMarkers());
    for(const entry of visible.filter(entry=>entry.date===date)) {
      const row=entry.row;
      const card=h('article',{class:'ng-lesson','data-lesson-id':row.id,'data-lesson-state':row.data.status,
        style:'top:'+((entry.minutes-startMinute)/(endMinute-startMinute)*100)+'%;--folio-duration:'+(row.data.duration*60/(endMinute-startMinute)*100)+'%'},
        h('button',{type:'button',class:'ng-record-open',onclick:()=>edit('lesson',row)},
          h('span',{},h('small',{},clockTime(entry.minutes)+'–'+clockTime(entry.minutes+row.data.duration*60)),
            h('strong',{},row.data.description))),
        row.data.status==='PLANNED'?h('button',{type:'button',class:'ng-button folio-lesson-confirm',
          'aria-label':tr('Confirm lesson'),title:tr('Confirm lesson'),onclick:()=>confirmLesson(row)},'✓'):null);
      const move=button('↕',event=>{if(event.detail===0)edit('lesson',row);});
      move.title='Move lesson';
      move.classList.add('ng-drag-handle');move.setAttribute('aria-label','Move '+row.data.description+' or use Edit to change time');
      bindLessonDrag(move,card,row,grid,startMinute,endMinute);
      card.append(move);events.append(card);
    }
    let hold=null,holdOrigin=null;
    const cancel=()=>{clearTimeout(hold);hold=null;};
    events.addEventListener('pointerdown',event=>{
      if(event.target.closest('.ng-lesson'))return;
      cancel();
      holdOrigin={x:event.clientX,y:event.clientY};
      const minutes=Math.round((startMinute+(event.clientY-events.getBoundingClientRect().top)/events.getBoundingClientRect().height*(endMinute-startMinute))/15)*15;
      if(minutes>=0&&minutes<1440)hold=setTimeout(()=>edit('lesson',null,{date,start_time:clockTime(minutes),time_zone:workZone}),450);
    });
    for(const name of ['pointerup','pointercancel'])events.addEventListener(name,cancel);
    events.addEventListener('pointermove',event=>{
      if(holdOrigin && Math.hypot(event.clientX-holdOrigin.x,event.clientY-holdOrigin.y)>8)cancel();
    });
    grid.append(h('section',{class:'ng-day','data-today':String(date===now.date)},h('h3',{},
      h('span',{},compactDate(date,{weekday:'short'})),h('b',{},compactDate(date,{day:'numeric'}))),
      events,button(tr('Add lesson'),()=>edit('lesson',null,{date,time_zone:workZone}))));
  }
  const agenda=h('div',{class:'folio-agenda'});
  const dayStrip=h('nav',{class:'folio-day-strip','aria-label':tr('Days in this calendar range')});
  const activeDay=h('div',{class:'folio-agenda-day'});
  const nextDays=h('section',{class:'folio-agenda-next'});
  const selectDay=date=>{
    workDate=date;
    toolbar.querySelector('input[type="date"]').value=workDate;
    try {sessionStorage.setItem('workie_calendar_view',JSON.stringify({days:workDays,date:workDate,zone:workZone}));} catch {}
    renderDay();
  };
  const renderDay=()=>{
    const entries=visible.filter(entry=>entry.date===workDate).sort((a,b)=>a.minutes-b.minutes);
    for(const control of dayStrip.children)control.setAttribute('aria-pressed',String(control.dataset.date===workDate));
    activeDay.replaceChildren(h('div',{class:'folio-agenda-heading'},
      h('h2',{},compactDate(workDate,{weekday:'long',day:'numeric',month:'short'})),
      h('span',{class:'folio-label'},entries.length+' '+tr(entries.length===1?'lesson':'lessons'))),
      ...(entries.length?entries.map(({row,minutes})=>h('article',{class:'folio-agenda-entry','data-agenda-lesson':row.id},
        h('time',{datetime:clockTime(minutes)},clockTime(minutes)),
        h('button',{type:'button',class:'folio-agenda-open',onclick:()=>edit('lesson',row)},
          h('strong',{},row.data.description),h('small',{},clockTime(minutes+row.data.duration*60)+' · '+tr(row.data.status==='CONFIRMED'?'Confirmed':'Planned'))),
        row.data.status==='PLANNED'?h('button',{type:'button',class:'ng-button folio-agenda-confirm',
          'aria-label':tr('Confirm lesson'),onclick:()=>confirmLesson(row)},'✓'):null)):
        [h('p',{class:'folio-agenda-empty'},tr('No lessons scheduled for this day.'))]));
    const next=visible.filter(entry=>entry.date>workDate)
      .sort((a,b)=>a.date.localeCompare(b.date)||a.minutes-b.minutes).slice(0,3);
    nextDays.hidden=!next.length;
    nextDays.replaceChildren(h('h2',{},tr('Coming up')),
      ...next.map(({row,date,minutes})=>h('button',{type:'button',class:'folio-agenda-preview',
        onclick:()=>{selectDay(date);dayStrip.querySelector('[aria-pressed=true]')?.focus();}},
        h('time',{datetime:date},compactDate(date,{weekday:'short',day:'numeric'})),
        h('strong',{},row.data.description),h('span',{},clockTime(minutes)))));
  };
  for(const date of dates) {
    const day=button('',()=>selectDay(date));
    day.dataset.date=date;
    day.dataset.hasEvents=String(visible.some(entry=>entry.date===date));
    day.append(h('span',{},compactDate(date,{weekday:'short'})),h('strong',{},compactDate(date,{day:'numeric'})));
    dayStrip.append(day);
  }
  renderDay();
  agenda.append(dayStrip,activeDay,nextDays);
  host.prepend(h('section',{class:'ng-work-calendar folio-calendar','aria-label':tr('Work calendar'),'data-mobile-grid':String(workMobileGrid)},toolbar,
    h('div',{class:'folio-calendar-canvas'},rail,grid),agenda,workDisplay,
    unscheduled.length?h('section',{},h('h3',{},'Lessons needing a time'),...unscheduled.map(recordRow)):null,
    h('details',{class:'folio-work-records'},h('summary',{},tr('Recorded earnings')),
      h('p',{class:'ng-caption'},'A monthly summary replaces individual recorded lessons in that month and currency.'),
      h('table',{class:'ng-table'},h('caption',{},tr('Recorded earnings')),
      h('tbody',{},...workIncome(ledger).flatMap(month=>month.byCurrency.map(value=>
        h('tr',{},h('th',{scope:'row'},month.month),h('td',{},amount(value.total,value.currency)),
          h('td',{},value.source==='MONTHLY_SUMMARY'?'Monthly summary':'Recorded lessons')))))))));
}
function workDataTools(host=content) {
  const file=h('input',{type:'file',accept:'.json,application/json','aria-label':tr('Import Work data')});
  file.onchange=()=>run(async()=>{
    const selected=file.files[0];
    if(!selected)return;
    try {reviewBackup(await inspectWorkData(await selected.text()));}
    finally {file.value='';}
  });
  host.append(h('details',{class:'ng-surface ng-plan-tools'},h('summary',{},tr('Work data')),
    h('p',{class:'ng-caption'},tr('Move students, lessons, recurring patterns and earnings between devices. Import reviews conflicts before merging.')),
    button(tr('Export Work data'),()=>run(async()=>download(await exportWorkData(ledger),'workie-work-'+today()+'.json'))),
    h('label',{class:'ng-field'},h('span',{},tr('Import Work data')),file)));
}
function clockTime(minutes) {
  minutes=Math.round(minutes);
  return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
}
function bindLessonDrag(handle,card,row,grid,startMinute,endMinute) {
  let gesture=null;
  handle.addEventListener('pointerdown',event=>{
    event.preventDefault();event.stopPropagation();
    handle.focus({preventScroll:true});
    handle.setPointerCapture(event.pointerId);
    gesture={x:event.clientX,y:event.clientY,date:null,time:null};
    card.classList.add('ng-moving');
  });
  handle.addEventListener('pointermove',event=>{
    if(!gesture)return;
    card.style.transform='translate('+(event.clientX-gesture.x)+'px,'+(event.clientY-gesture.y)+'px)';
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-calendar-date]');
    for(const day of grid.querySelectorAll('.ng-day-events'))day.classList.toggle('ng-drop-target',day===target);
    if(!target){gesture.date=null;return;}
    const bounds=target.getBoundingClientRect();
    const minutes=Math.round((startMinute+(event.clientY-bounds.top)/bounds.height*(endMinute-startMinute))/15)*15;
    if(minutes<0||minutes+row.data.duration*60>1440){gesture.date=null;return;}
    gesture.date=target.dataset.calendarDate;gesture.time=clockTime(minutes);
  });
  const finish=event=>{
    if(!gesture)return;
    const drop=gesture;gesture=null;card.classList.remove('ng-moving');card.style.transform='';
    for(const day of grid.querySelectorAll('.ng-day-events'))day.classList.remove('ng-drop-target');
    if(event.type==='pointercancel'||!drop.date)return;
    run(async()=>{
      const prepared=await prepareBatch(ledger,JSON.stringify({protocol:'workie-transfer',version:1,batch_id:crypto.randomUUID(),
        operations:lessonOperations(ledger,row,{...row.data,date:drop.date,start_time:drop.time,start_at:null,time_zone:workZone})}));
      const earlier=ledger.revision;
      await save(prepared.next,'Move lesson with conflict check');
      showUndo(earlier,tr('Lesson moved.'));
    });
  };
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
}
function timerElapsed(timer) {
  return Math.max(0,timer.elapsed+(timer.running?Date.now()-timer.lastStart:0));
}
function timerPanel() {
  const current=ledger.settings.timer;
  if(current) {
    const student=ledger.records.find(row=>row.id===current.student_id);
    const text=h('output',{id:'ng-timer-clock','aria-label':'Elapsed lesson time'},timerReadout(current));
    const earnings=h('output',{id:'ng-timer-earnings','aria-label':tr('Estimated earnings')},timerEarnings(current));
    const pause=button(tr(current.running?'Pause':'Resume'),()=>run(async()=>{
      const next=clone(ledger),timer=next.settings.timer;
      if(timer.running) timer.elapsed=timerElapsed(timer);
      timer.running=!timer.running;timer.lastStart=timer.running?Date.now():null;
      await save(next,timer.running?'Resume lesson timer':'Pause lesson timer');
      content.querySelector('[data-ng-timer-toggle]')?.focus({preventScroll:true});
    }));
    pause.dataset.ngTimerToggle='';
    const finish=button(tr('Review lesson'),()=>run(async()=>{
      const elapsed=timerElapsed(current),seconds=Math.max(1,Math.floor(elapsed/1000));
      if(seconds>86400)throw Error('Review this timer manually. Split sessions longer than 24 hours before saving.');
      const next=clone(ledger);
      next.settings.timer={...current,running:false,lastStart:null,elapsed};
      await save(next,'Pause timer for lesson review');
      const start=wallTime(current.startedAt,current.time_zone);
      edit('lesson',null,{description:'Lesson · '+student.data.description,student_id:student.id,
        date:start.date,start_time:start.time,start_at:new Date(current.startedAt).toISOString(),
        time_zone:current.time_zone,duration:seconds/3600,status:'CONFIRMED',
        income:Math.round(current.rate*seconds/36)/100,currency:current.currency});
      if(editing)editing.timerId=current.id;
    }),'primary');
    return h('section',{class:'ng-surface ng-timer'},h('h2',{},student?.data.description??'Lesson timer'),
      h('div',{class:'ng-timer-instrument'},text,h('div',{},h('small',{},tr('Estimated earnings')),earnings)),
      h('p',{class:'ng-caption'},tr('Started')+' '+wallTime(current.startedAt,current.time_zone).time+' · '+
        (current.time_zone===workZone?tr('Hong Kong time'):current.time_zone)+' · '+amount(Math.round(current.rate*100),current.currency)+' / '+tr('hour')),
      current.requiresReview?h('p',{class:'ng-warning'},'Restored timer is paused. Review its elapsed duration before saving the lesson.'):null,
      h('div',{class:'ng-actions'},pause,finish,button(tr('Discard timer'),()=>run(async()=>{
        if(!window.confirm('Discard this timer? A restore point will be saved.'))return;
        const next=clone(ledger);next.settings.timer=null;await save(next,'Discard lesson timer');
      }),'danger')));
  }
  const students=ledger.records.filter(row=>row.entity==='student');
  const select=h('select',{'aria-label':tr('Timer student')},...students.map(row=>h('option',{value:row.id},row.data.description)));
  const date=h('input',{type:'date',value:today(),max:today(),required:true,'aria-label':tr('Actual lesson date')});
  const time=h('input',{type:'time',value:wallTime(Date.now()).time,required:true,'aria-label':tr('Actual start time')});
  const rate=h('output',{class:'ng-timer-rate'});
  const error=h('p',{class:'ng-entry-error',role:'alert'});
  for(const field of [date,time])field.addEventListener('input',()=>{
    error.textContent='';
    time.removeAttribute('aria-invalid');
  });
  const refresh=()=>{
    const student=students.find(row=>row.id===select.value);
    rate.textContent=typeof student?.data.rate==='number'?amount(Math.round(student.data.rate*100),student.data.currency)+' / '+tr('hour'):tr('Hourly rate required');
  };
  select.addEventListener('change',refresh);refresh();
  const start=now=>run(async()=>{
    const student=students.find(row=>row.id===select.value);
    if(!student)throw Error('Add a student before timing a lesson.');
    if(typeof student.data.rate!=='number' || !Number.isFinite(student.data.rate))throw Error('Set the student hourly rate before starting the timer.');
    error.textContent='';
    const instant=Date.now();
    let startedAt;
    try {startedAt=now?instant:manualTimerStart(date.value,time.value,instant);}
    catch(problem){error.textContent=tr(problem.message);time.setAttribute('aria-invalid','true');time.focus();return;}
    const next=clone(ledger);
    next.settings.timer={id:crypto.randomUUID(),student_id:student.id,startedAt,
      lastStart:instant,elapsed:instant-startedAt,running:true,time_zone:workZone,rate:student.data.rate,currency:student.data.currency};
    await save(next,'Start lesson timer');
    content.querySelector('[data-ng-timer-toggle]')?.focus({preventScroll:true});
  });
  const timingLabel=h('small',{},tr('Now'));
  const timing=h('details',{class:'ng-timer-start ng-week-bridge'},
    h('summary',{},h('span',{},icon('Clock3'),tr('Start time')),timingLabel),
    h('div',{class:'ng-timer-fields'},
      h('label',{class:'ng-field'},h('span',{},tr('Actual lesson date')),date),
      h('label',{class:'ng-field'},h('span',{},tr('Actual start time')),time)));
  const action=h('span',{},tr('Start now'));
  const submit=h('button',{type:'button',class:'ng-button primary ng-action-control',onclick:()=>start(!timing.open)},icon('Timer'),action);
  timing.addEventListener('toggle',()=>{
    action.textContent=tr(timing.open?'Start from entered time':'Start now');
    timingLabel.textContent=tr(timing.open?'Hong Kong time':'Now');
    if(!timing.open){error.textContent='';time.removeAttribute('aria-invalid');}
  });
  return h('section',{class:'ng-surface ng-timer-setup'},h('h2',{},tr('Lesson timer')),
    students.length?h('div',{},h('div',{class:'ng-timer-fields'},
      h('label',{class:'ng-field'},h('span',{},tr('Student')),select),rate),timing,error,submit):
      h('p',{class:'ng-caption'},tr('Add a student to start timing lessons.')));
}
function timerReadout(timer) {
  const seconds=Math.floor(timerElapsed(timer)/1000);
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value=>String(value).padStart(2,'0')).join(':');
}
function timerEarnings(timer) {
  return amount(Math.round(timer.rate*timerElapsed(timer)/36000),timer.currency);
}
async function confirmLesson(row) {
  await run(async()=>{
    const student=ledger.records.find(record=>record.id===row.data.student_id);
    if(!student)throw Error('Choose an existing student before confirming this lesson.');
    if(row.data.income==null&&(!Number.isFinite(student.data.rate)||!Number.isFinite(row.data.duration))) {
      throw Error('Enter the stored lesson income or confirm both the hourly rate and actual duration.');
    }
    const earned=row.data.income??Math.round(student.data.rate*row.data.duration*100)/100;
    const data={...row.data,status:'CONFIRMED',income:earned,currency:row.data.income==null?student.data.currency:row.data.currency};
    const operations=lessonOperations(ledger,row,data);
    const prepared=await prepareBatch(ledger,JSON.stringify({protocol:'workie-transfer',version:1,batch_id:crypto.randomUUID(),operations}));
    linkConfirmedIncome(prepared.next,row.id);
    await save(prepared.next,'Confirm lesson and stored earnings');
  });
}
function attachDocument(existing=null,ownerId=null) {
  const input=h('input',{type:'file'});
  input.onchange=()=>run(async()=>{
    const file=input.files[0];if(!file)return;
    if(file.size>2*1024*1024) throw Error('Choose a document up to 2 MB.');
    const data=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);
    });
    const next=clone(ledger),id=existing?.id??crypto.randomUUID();
    if(existing) {
      const row=next.records.find(row=>row.id===id);
      row.data={...row.data,file_name:file.name,media_type:file.type||'application/octet-stream'};
      row.revision++;
    } else next.records.push({id,revision:1,entity:'document',data:{description:file.name,file_name:file.name,
      media_type:file.type||'application/octet-stream',owner_id:ownerId}});
    next.attachments??={};next.attachments[id]=data;
    await save(next,'Attach local document');
  });
  input.click();
}
function bills(host=content) {
  const since=new Date(Date.parse(today()+'T00:00:00Z')-30*86400000).toISOString().slice(0,10);
  const rows=billOccurrences(ledger,since,90);
  host.append(h('section',{class:'ng-surface ng-bills-panel'},
    h('h2',{},'Bills due & paid'),
    rows.length?rows.map(row=>h('div',{class:'ng-record'},
      h('span',{},row.date+' · '+row.data.description+' · '+amount(Math.round(row.data.amount*100),row.data.currency)),
      row.paid?h('strong',{},'Paid '+row.paid.data.date):
        button(tr('Record payment'),()=>edit('bill_payment',null,{description:row.data.description,
          amount:row.data.amount,currency:row.data.currency,rule_id:row.id,period_date:row.date})))) :
      h('p',{class:'ng-caption'},'Create a fixed bill rule to see upcoming payments.')));
}
function spending(host=content) {
  const months=new Map();
  const included=includedExpenseDetails(ledger);
  const outflows=ledger.records.filter(row=>['expense','bill_payment'].includes(row.entity)&&!row.data.voided&&!included.has(row.id));
  for(const row of outflows) {
    const month=row.data.date?.slice(0,7);
    if(!month) continue;
    const total=months.get(month)??{actual:0,flexible:0,unknown:false,direct:0,settlement:null,settlementUnknown:false};
    const value=convert(ledger,row.data.amount,row.data.currency,row.data.date);
    const derived=isSnapshotSettlement(row);
    if(derived) {
      if(value===null)total.settlementUnknown=true;
      else total.settlement=(total.settlement??0)+value;
      months.set(month,total);continue;
    }
    total.direct++;
    if(value===null) total.unknown=true;
    else {
      total.actual+=value;
      if(row.entity==='expense' && row.data.type==='GENERAL' && row.data.fixed===false) total.flexible+=value;
    }
    months.set(month,total);
  }
  const table=h('table',{class:'ng-table'},
    h('caption',{},'Recorded monthly outflow in HKD'),
    h('thead',{},h('tr',{},h('th',{},'Month'),h('th',{},'Direct outflow'),h('th',{},'Controllable'),h('th',{},'Snapshot settlements'))),
    h('tbody',{},...[...months].sort(([a],[b])=>b.localeCompare(a)).map(([month,total])=>
      h('tr',{},h('th',{scope:'row'},month),h('td',{},amount(total.unknown||!total.direct?null:total.actual,'HKD')),
        h('td',{},amount(total.unknown||!total.direct?null:total.flexible,'HKD')),
        h('td',{},amount(total.settlementUnknown?null:total.settlement,'HKD'))))));
  host.append(h('section',{class:'ng-surface ng-monthly-outflow'},table,
    h('p',{class:'ng-caption'},'Missing months have no recorded total. Historical unclassified expenses stay outside the controllable metric.')));
  const observations=outflows.map(row=>{
    const value=convert(ledger,row.data.amount,row.data.currency,row.data.date);
    return {id:row.id,purpose:row.data.description,date:row.data.date,amount:value===null?null:value/100,
      ...(isSnapshotSettlement(row)?{provenance:'snapshot'}:{}),
      currency:'HKD',type:row.entity==='bill_payment'?'GENERAL':row.data.type,
      fixed:row.entity==='bill_payment'?true:row.data.fixed};
  });
  const summary=window.WorkieExpense.summarize(observations,today());
  const peak=Math.max(1,summary.projectedCents??0,...summary.weeks.flatMap(row=>[Math.abs(row.actual??0),Math.abs(row.controllable??0)]));
  const selected=h('output',{class:'ng-week-readout',role:'status'});
  const chart=h('div',{class:'ng-week-chart','aria-label':'Weekly direct and controllable spending'});
  let initial=null;
  for(const row of summary.weeks) {
    const label='Week '+row.start+' · direct '+amount(row.actual,'HKD')+' · controllable '+amount(row.controllable,'HKD');
    const choose=()=>{selectedWeek=row.start;selected.textContent=label;for(const item of chart.children)item.setAttribute('aria-pressed',String(item===point));};
    const point=h('button',{type:'button',class:'ng-week-point','aria-label':label,'aria-pressed':'false',onclick:choose,onfocus:choose,
      onpointerenter:event=>{if(event.pointerType==='mouse')choose();}},
      h('span',{class:'ng-week-bars','aria-hidden':'true'},
        row.actual===null&&row.controllable===null?h('b',{},'?'):null,
        h('span',{class:'ng-week-actual','data-negative':String(row.actual<0),style:row.actual===null?'display:none':'height:'+(Math.abs(row.actual)/peak*100)+'%'}),
        h('span',{class:'ng-week-controllable',style:row.controllable===null?'display:none':'height:'+(row.controllable/peak*100)+'%'})),
      h('span',{},row.start.slice(5)));
    if(row.start===selectedWeek||(!selectedWeek&&row===summary.weeks.at(-1)))initial=choose;
    chart.append(point);
  }
  if(initial)initial();
  const weeklyTable=h('details',{class:'ng-chart-data'},h('summary',{},tr('Weekly spending data')),
    h('table',{class:'ng-table'},h('thead',{},h('tr',{},...['Week of','Direct outflow','Controllable','Snapshot settlements'].map(label=>h('th',{scope:'col'},tr(label))))),
      h('tbody',{},...summary.weeks.map(row=>h('tr',{},h('th',{scope:'row'},row.start),...[row.actual,row.controllable,row.settlement]
        .map(value=>h('td',{},amount(value,'HKD'))))))));
  host.append(h('section',{class:'ng-surface ng-spending-instrument'},h('h2',{},tr('Recent spending & forecast')),chart,selected,
    h('p',{class:'ng-chart-legend'},h('span',{},h('i',{class:'ng-legend-swatch cash','aria-hidden':'true'}),tr('Direct outflow')),
      h('span',{},h('i',{class:'ng-legend-swatch expected','aria-hidden':'true'}),tr('Controllable')),
      h('span',{},tr('? No recorded value'))),
    h('div',{class:'ng-forecast-readout'},h('strong',{},tr('Projected controllable week')),
      h('b',{},amount(summary.projectedCents,'HKD')),
      summary.projectedCents===null?null:h('span',{class:'ng-projection-track','aria-hidden':'true'},
        h('span',{style:'width:'+summary.projectedCents/peak*100+'%'})),
      h('p',{class:'ng-caption'},summary.projectedCents===null?tr('More observations are needed for a weekly projection.'):
        summary.days+' '+tr('observed days in the latest 28 days.'))),
    weeklyTable));
}
function openLegacy(destination) {
  document.body.classList.remove('ng-active');document.body.classList.add('ng-legacy-open');root.hidden=true;
  document.querySelector('#ng-return').hidden=false;
  destination?.();
}
function legacyEntries(beforeOpen=()=>{}) {
  const settings=()=>window.switchTab('settings');
  const entries=[
    ['Weekly targets and journal',()=>{window.switchTab('dashboard');document.querySelector('[data-work-journal]').click();},'#budget-journal-form'],
    ['Historical savings estimate',()=>{settings();document.querySelector('.advanced-settings').open=true;},'#dash-current-total'],
    ['Budget scenarios and archives',()=>window.switchExchangeView('budget'),'#budget-summary-content'],
    ['Backup exports and reminders',settings,'#settings-backup-group'],
    ['Opening balance and included grants',()=>{window.switchTab('dashboard');window.openPreparationEditor();},'#budget-preparation-form'],
    ['Octopus and E-wallet history',()=>window.switchExchangeView('expenses'),'#smart-expense-module'],
    ['Student location notes',()=>window.switchWorkView('students'),'#student-search'],
    ['Schedule and current-time tools',()=>window.switchWorkView('schedule'),'#week-view-options'],
  ];
  return h('ul',{},...entries.map(([label,go,selector])=>h('li',{},button(tr(label),()=>{
    beforeOpen();
    openLegacy(()=>{
      go();
      requestAnimationFrame(()=>{
        const target=document.querySelector(selector);
        if(!target)return;
        target.scrollIntoView({block:'start'});
        if(!window.budgetSheetVisible()) {
          if(!target.matches('button,input,select,textarea,a[href]'))target.tabIndex=-1;
          target.focus({preventScroll:true});
        }
      });
    });
  }))));
}
function walletHistory(host=content) {
  const snapshots=ledger.legacy?JSON.parse(ledger.legacy.raw).smartExpenses??[]:[];
  const columns=[['octSpent','Octopus spent'],['octReload','Octopus reloads'],['ewSpent','E-wallet spent'],['ewTransfer','E-wallet transfers']];
  const sampleValue=(row,key)=>row[key]===null||row[key]===undefined||row[key]===''?null:Math.round(Number(row[key])*100);
  host.append(h('section',{class:'ng-surface'},h('h2',{},'Cumulative wallet snapshots'),
    h('p',{class:'ng-caption'},'Original HKD readings. The legacy wallet workspace retains interval comparisons, monthly settlement and snapshot editing.'),
    snapshots.length?h('details',{class:'ng-wallet-snapshots'},h('summary',{},snapshots.length+' original readings'),
      ...snapshots.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(row=>
        h('div',{class:'ng-wallet-reading'},h('time',{datetime:row.date},row.date),
          h('dl',{class:'ng-counts'},...columns.flatMap(([key,label])=>[h('dt',{},label),h('dd',{},amount(sampleValue(row,key),'HKD'))]))))):
      h('p',{class:'ng-caption'},'Your original source has no wallet readings.'),
    button('Open wallet workspace',()=>openLegacy(()=>{
      window.switchExchangeView?.('expenses');
      requestAnimationFrame(()=>document.querySelector('#smart-expense-module')?.scrollIntoView({block:'start'}));
    }))));
}
function inputFor(key,rule,value) {
  let control;
  if(rule.type==='shares') {
    const hidden=h('input',{type:'hidden',name:key,value:JSON.stringify(value??[])});
    const entries=h('div',{class:'ng-participants'});
    function sync() {
      hidden.value=JSON.stringify([...entries.children].map(line=>({
        name:line.querySelector('[data-person]').value,
        share:Number(line.querySelector('[data-share]').value)/100,
        self:line.querySelector('[data-self]').checked,
      })));
      const share=form.elements.namedItem('share');
      if(share)share.closest('label').hidden=entries.children.length>0;
      form.dataset.dirty='true';
    }
    function add(participant={name:'',share:0,self:false}) {
      const name=h('input',{'data-person':'','aria-label':tr('Participant name'),placeholder:tr('Name'),value:participant.name});
      const share=h('input',{type:'number','data-share':'','aria-label':tr('Percentage share'),min:0,max:100,step:'any',value:participant.share*100});
      const self=h('input',{type:'checkbox','data-self':'','aria-label':tr('This participant is you')});
      self.checked=participant.self;
      const line=h('div',{class:'ng-participant'},name,share,
        h('label',{},self,' You'),button(tr('Remove'),()=>{line.remove();sync();}));
      line.oninput=sync;entries.append(line);
    }
    for(const participant of value??[])add(participant);
    return h('fieldset',{class:'ng-shares'},h('legend',{},tr('Shared cost participants')),hidden,entries,
      button(tr('Add participant'),()=>{add();sync();}),
      h('p',{class:'ng-caption'},'Set percentage shares totaling 100% and mark your own entry. Your percentage determines the exchange budget allocation.'));
  }
  const links={trip_id:['trip'],student_id:['student'],budget_item_id:['budget_item','trip_budget_item'],
    rule_id:['fixed_bill_rule'],account_id:['account'],from_account_id:['account'],to_account_id:['account'],
    balance_id:['balance'],series_id:['lesson_series'],owner_id:Object.keys(schema),source_id:['student','lesson'],included_in_general_id:['expense'],
    related_id:['grant','loan','expense','cash_event','budget_item','trip_budget_item']};
  if(rule.enum || links[key]) {
    const choices=rule.enum??ledger.records.filter(row=>links[key].includes(row.entity)&&row.id!==editing?.row?.id&&
      (key!=='included_in_general_id'||row.data.type==='GENERAL'&&row.data.entry_week)).map(row=>row.id);
    control=h('select',{},h('option',{value:''},tr(rule.optional?'Optional':'Choose…')),
      ...choices.map(choice=>h('option',{value:choice},rule.enum?tr(optionLabels[choice]??choice):ledger.records.find(row=>row.id===choice)?.data.description??choice)));
    control.value=value??'';
  } else if(rule.type==='boolean') {
    control=h('input',{type:'checkbox'});
    control.checked=!!value;
  } else if(key==='note' || key==='source' || key==='address') {
    control=h('textarea',{rows:3,maxlength:rule.maxLength??2000});
    control.value=value??'';
  } else {
    const type=rule.type==='date'?'date':rule.type==='time'?'time':rule.type==='month'?'month':['money','number'].includes(rule.type)?'number':'text';
    control=h('input',{type,value:value??'',step:rule.type==='money'?'0.01':'any',
      ...(type==='number'?{min:rule.minimum??0,max:rule.maximum??null,inputmode:'decimal'}:{}),
      ...(rule.maxLength?{maxlength:rule.maxLength}:{}),
      ...(rule.type==='currency'?{maxlength:3,pattern:'[A-Z]{3}'}:{})});
  }
  control.name=key;
  if(!rule.optional && !rule.nullable && rule.type!=='boolean') control.required=true;
  return h('label',{class:rule.type==='boolean'?'ng-check':'ng-field'},
    h('span',{},tr(fieldLabel(key))),control);
}
function edit(entity,row=null,defaults={}) {
  if(document.querySelector('dialog[open]'))return;
  const quick=entity==='expense'&&!row&&defaults.quick===true;
  const paymentFor=defaults.paymentFor, weeklyIncomeWeek=defaults.weeklyIncomeWeek;
  const expenseWeek=entity==='expense'&&!row&&!defaults.budget_item_id&&!defaults.trip_id&&!defaults.rule_id?
    settlementWeek:null;
  if(!row&&(quick||paymentFor))defaults=cashEntryDefaults({date:today(),...defaults});
  const quickBalance=!row&&(quick||paymentFor)?defaults.balance_id??null:null;
  editing={entity,row,quick,quickBalance,paymentFor,weeklyIncomeWeek,expenseWeek,
    originalDate:row?.data.date??defaults.date,originalTime:row?.data.start_time??defaults.start_time};
  dialog.dataset.folio=String(view in folioTitles);
  dialog.dataset.v3='true';
  form.dataset.dirty='false';
  dialogOpener=document.activeElement;
  const close=actionButton('Close','X',closeEditor,{only:true});
  close.classList.add('v3-inspector-close','ng-action-close');
  form.replaceChildren(h('div',{class:'ng-dialog-title'},h('div',{},
    view in folioTitles?h('p',{class:'folio-label'},folioSections[view]):null,
    h('h2',{id:'ng-editor-title'},tr(weeklyIncomeWeek?(row?'Edit income':'Record income'):
      paymentFor?(row?'Edit linked transaction':defaults.kind==='REFUND'?'Record refund':'Record payment'):
      quick?'Quick expense':(row?'Edit ':'Add ')+(entity==='grant'?'subsidy':names[entity])))),close));
  if(paymentFor)form.append(h('p',{class:'ng-payment-context'},paymentFor));
  else if(weeklyIncomeWeek)form.append(h('p',{class:'ng-caption'},tr('A blank received date uses Sunday')+' · '+
    compactDate(calendarDay(weeklyIncomeWeek,6),{day:'numeric',month:'long',year:'numeric'})));
  else if(!quick&&descriptions[entity]) form.append(h('p',{class:'ng-caption'},ledger.settings.language==='zh-Hant'?descriptions[entity]:editorDescriptions[entity]));
  if(quickBalance)form.append(h('p',{class:'ng-caption'},tr('Today’s expenses are recorded after the confirmed opening balance.')));
  if(row&&paymentFor&&renderedModel?.base?.reconciliation?.some(entry=>entry.id===row.id))
    form.append(h('p',{class:'ng-warning'},tr('This payment is included in the opening balance. After changing it, review the balance reconciliation.')));
  const grid=h('div',{class:'ng-form-grid'});
  const principal={
    budget_item:['description','amount','currency','category','due_date','priority'],
    lesson:['description','student_id','date','start_time','duration','status'],
    grant:['description','amount','currency','status','expected_date'],
    savings_deposit:['description','amount','currency','date','direction'],
  };
  if(quick)principal.expense=['amount','description'];
  if(paymentFor)principal[entity]=['amount','currency','date','description'];
  if(weeklyIncomeWeek)principal.cash_event=['amount','currency','description','date','student_id'];
  const core=view in folioTitles?principal[entity]:null;
  const mainFields=core?h('div',{class:'ng-form-grid folio-editor-fields'}):null;
  const fields=new Map();
  const context=h('fieldset',{class:'ng-form-context ng-form-grid'},h('legend',{},tr('Details and references')));
  const contextual=new Set(['source','source_date','confidence','note','related_id','budget_item_id','trip_id','rule_id','completed_on',
    'balance_id','account_id','owner_id','after_balance','voided']);
  if(entity==='expense')for(const key of ['payee','category'])contextual.add(key);
    if(['balance','account_transfer','cash_event','trip_budget_item','bill_payment'].includes(entity)) {
    for(const key of ['account_id','related_id','trip_id','rule_id'])contextual.delete(key);
  }
  if(entity==='trip_budget_item')principal.trip_budget_item=principal.budget_item;
  if(entity==='trip')principal.trip=['description','destination','start_date','end_date','currency','status'];
  for(const [key,rule] of Object.entries(schema[entity])) {
    const fallback={currency:'HKD',time_zone:'Asia/Hong_Kong',scenario:entity==='budget_item'?ledger.settings.scenario:'Base',
      ...(entity==='expense'?{type:'GENERAL'}:{}),
      date:today(),active:entity==='fixed_bill_rule'};
    const value=weeklyIncomeWeek&&key==='date'&&row?.data.receipt_week===weeklyIncomeWeek?'':row?.data[key]??defaults[key]??fallback[key];
    const linkedFields=entity==='expense'?['budget_item_id','trip_id','category']:['related_id','kind'];
    const tutoringField=['student_id','lesson_date','start_time','end_time','duration'].includes(key);
    if(['entry_week','entry_created_at'].includes(key)||row?.data.entry_week&&['date','type'].includes(key)||
      key==='scenario'||key==='trip_id'&&['budget_item','trip_budget_item'].includes(entity)||paymentFor&&linkedFields.includes(key)||
      ['lesson','lesson_series'].includes(entity)&&['time_zone','start_at'].includes(key)||
      entity==='cash_event'&&(['work_income_id','receipt_week','included_work_ids'].includes(key)||!weeklyIncomeWeek&&tutoringField||
        weeklyIncomeWeek&&['kind','related_id','balance_id','after_balance','voided','account_id'].includes(key))) {
      form.append(h('input',{type:'hidden',name:key,value:rule.type==='references'?JSON.stringify(value??[]):value??''}));
      continue;
    }
    const field=inputFor(key,rule,value);
    if(weeklyIncomeWeek&&['date','description','amount'].includes(key)) {
      field.querySelector('span').textContent=tr(key==='date'?'Received date (optional)':key==='amount'?'Amount':'Description (optional)');
      if(key!=='amount')field.querySelector('input').required=false;
    }
    if(quick&&key==='description') {
      field.querySelector('span').textContent=tr('Description (optional)');
      field.querySelector('input').required=false;
    }
    fields.set(key,field);
    if(!core?.includes(key))(contextual.has(key)?context:grid).append(field);
  }
  if(core) {
    for(const key of core)mainFields.append(fields.get(key));
    form.append(mainFields);
    if(grid.hasChildNodes()||context.children.length>1) {
      const details=h('details',{class:'folio-work-records'},h('summary',{},tr('More details')));
      if(grid.hasChildNodes())details.append(grid);
      if(context.children.length>1)details.append(context);
      form.append(details);
    }
  } else {
    form.append(grid);
    if(context.children.length>1)form.append(context);
  }
  if(expenseWeek) {
    const dateField=fields.get('date');
    const period=h('p',{class:'ng-caption'},weekEnding(calendarDay(expenseWeek,6)));
    const control=key=>form.elements.namedItem(key);
    const updatePeriod=()=>{
      const isWeekly=control('type').value==='GENERAL'&&
        !['budget_item_id','trip_id','rule_id'].some(key=>control(key)?.value);
      dateField.hidden=isWeekly;
      control('date').disabled=isWeekly;
      period.hidden=!isWeekly;
    };
    for(const key of ['type','budget_item_id','trip_id','rule_id'])control(key)?.addEventListener('change',updatePeriod);
    dateField.after(period);
    updatePeriod();
  }
  form.append(h('p',{id:'ng-form-error',role:'alert'}));
  form.addEventListener('invalid',showInvalidField,true);
  if(row?.data.participants?.length)form.elements.namedItem('share').closest('label').hidden=true;
  if(entity==='balance') form.append(h('label',{class:'ng-check'},
    h('input',{type:'checkbox',name:'reconcile',required:true}),
    h('span',{},'I have checked that this balance includes all listed payments through the balance date. 核對範圍及原有收支後才確認。')));
  form.append(h('div',{class:'ng-form-actions'},button(tr('Cancel'),closeEditor),
    h('button',{type:'submit',class:'ng-button primary'},tr(weeklyIncomeWeek?'Save income':
      paymentFor?defaults.kind==='REFUND'||row?.data.kind==='REFUND'?'Save refund':'Save payment':'Save '+names[entity].toLowerCase()))));
  openDialog(dialog);
}
function closeEditor() {
  if(dialog.dataset.closing)return;
  if(form.querySelector('[type="submit"]')?.disabled)return;
  if(form.dataset.dirty==='true' && !window.confirm('Discard unsaved changes?')) return;
  form.dataset.dirty='false';void dismissEditor(dialogOpener);
}
function showInvalidField(event) {
  const disclosure=event.target.closest('details');
  if(disclosure)disclosure.open=true;
  event.target.setAttribute('aria-invalid','true');
  event.target.setAttribute('aria-errormessage','ng-form-error');
  if(!form.querySelector('#ng-form-error').textContent) {
    form.querySelector('#ng-form-error').textContent=tr('Review the highlighted fields before saving.');
  }
}
async function submitEditor(event) {
  event.preventDefault();
  const submit=form.querySelector('[type="submit"]');
  if(submit.disabled)return;
  const label=submit.textContent;
  submit.disabled=true;submit.textContent=tr('Saving on this device…');
  const {entity,row,quick,quickBalance,paymentFor,weeklyIncomeWeek,expenseWeek}=editing,data={};
  try {
    const revision=ledger.revision;
    for(const [key,rule] of Object.entries(schema[entity])) {
      const control=form.elements.namedItem(key);
      if(rule.type==='boolean') data[key]=control.type==='hidden'?control.value==='true':control.checked;
      else if(control.value==='') {
        if(rule.nullable) data[key]=null;
        else if(rule.allowEmpty) data[key]='';
        else if(!rule.optional) data[key]='';
      } else data[key]=['shares','references'].includes(rule.type)?JSON.parse(control.value):['money','number'].includes(rule.type)?Number(control.value):
        rule.type==='currency'?control.value.toUpperCase():control.value;
    }
    if(quick&&!data.description?.trim())data.description='日常支出';
    if(expenseWeek&&data.type==='GENERAL'&&!data.budget_item_id&&!data.trip_id&&!data.rule_id) {
      data.date=calendarDay(expenseWeek,6);
      data.entry_week=expenseWeek;
      data.entry_created_at=new Date().toISOString();
    }
    if(weeklyIncomeWeek) {
      if(!data.description?.trim())data.description=tr(data.student_id||data.work_income_id?'Tutoring income':'Income');
      data.receipt_week=data.date?null:weeklyIncomeWeek;
      if(!data.date)data.date=calendarDay(weeklyIncomeWeek,6);
      if(!row)Object.assign(data,cashEntryDefaults(data));
      else if(data.date!==row.data.date){data.balance_id=null;data.after_balance=false;}
    }
    if(entity==='lesson'&&data.start_at&&(data.date!==editing.originalDate||data.start_time!==editing.originalTime))data.start_at=null;
    if(quickBalance&&data.balance_id===quickBalance&&data.date!==today()) {
      data.after_balance=false;data.balance_id=null;
    }
    if(data.participants?.length)data.share=data.participants.find(participant=>participant.self)?.share;
    const operation=row?{op:'UPDATE',entity,record_id:row.id,expected_revision:row.revision,changes:data}:
      {op:'ADD',entity,data};
    const operations=entity==='lesson'&&row?lessonOperations(ledger,row,data):[operation];
    const batch={protocol:'workie-transfer',version:1,batch_id:crypto.randomUUID(),operations};
    const prepared=await prepareBatch(ledger,JSON.stringify(batch));
    if(entity==='balance') {
      const balance=prepared.next.records.find(record=>record.entity==='balance' &&
        (row?record.id===row.id:!ledger.records.some(old=>old.id===record.id)));
      reconcileBalance(prepared.next,balance.id);
    }
    const timedLesson=Boolean(editing.timerId);
    if(timedLesson) {
      if(ledger.settings.timer?.id!==editing.timerId) throw Error('The timer changed. Review it again before saving.');
      prepared.next.settings.timer=null;
    }
    const focusId=row?.id??prepared.next.records.find(record=>!ledger.records.some(old=>old.id===record.id))?.id;
    if(entity==='lesson'&&focusId)linkConfirmedIncome(prepared.next,focusId);
    await save(prepared.next,'Save '+names[entity]);
    form.dataset.dirty='false';
    const id=focusId?CSS.escape(focusId):null;
    const candidates=id?content.querySelectorAll('[data-agenda-lesson="'+id+'"] button, [data-lesson-id="'+id+'"] button, [data-record-id="'+id+'"] button'):[];
    const focusTarget=[...candidates].find(control=>control.getClientRects().length);
    const anchor=dialogOpener?.dataset.editorAnchor;
    const replacement=anchor?content.querySelector('[data-editor-anchor="'+CSS.escape(anchor)+'"]'):null;
    await dismissEditor(focusTarget??replacement??dialogOpener);
    if(paymentFor)showUndo(revision,row?'Transaction updated.':'Transaction saved.');
    if(timedLesson||weeklyIncomeWeek||entity==='cash_event'&&data.kind==='INCOME'&&!row)showUndo(revision,'Income saved.',focusId);
    if(entity==='savings_deposit'&&row) {
      showUndo(prepared.next.revision,tr('Savings deposit corrected.'),row.id);
      return;
    }
  } catch(error) {
    const location=error.message.match(/^\$\.operations\[\d+\]\.(?:(?:data|changes)\.)?([^:]+):\s*(.*)$/);
    const control=location&&form.elements.namedItem(location[1]);
    form.querySelector('#ng-form-error').textContent=tr(location?.[2]??error.message);
    if(control?.focus) {
      const disclosure=control.closest('details');
      if(disclosure)disclosure.open=true;
      control.setAttribute('aria-invalid','true');control.setAttribute('aria-errormessage','ng-form-error');control.focus();
    }
  }
  finally {submit.disabled=false;submit.textContent=label;}
}
async function remove(row) {
  if(!window.confirm('Delete '+row.data.description+'? A restore point will be saved.')) return;
  await run(async()=>{
    const previousRevision=ledger.revision;
    const siblings=reduceMotion()?new Map():new Map([...content.querySelectorAll('[data-record-id]')]
      .filter(node=>node.dataset.recordId!==row.id).map(node=>[node.dataset.recordId,node.getBoundingClientRect().top+scrollY]));
    const prepared=await prepareBatch(ledger,JSON.stringify({protocol:'workie-transfer',version:1,
      batch_id:crypto.randomUUID(),operations:row.entity==='lesson'?lessonOperations(ledger,row):
        [{op:'DELETE',entity:row.entity,record_id:row.id,expected_revision:row.revision}]}));
    await save(prepared.next,'Delete '+names[row.entity]);
    for(const node of content.querySelectorAll('[data-record-id]')) {
      const before=siblings.get(node.dataset.recordId);
      if(before===undefined)continue;
      const offset=before-node.getBoundingClientRect().top-scrollY;
      if(Math.abs(offset)>1)node.animate([{transform:'translateY('+offset+'px)'},{transform:'none'}],
        {duration:180,easing:'cubic-bezier(.2,.7,.3,1)'});
    }
    showUndo(previousRevision,'Deleted '+row.data.description+'.',row.id);
  });
}
async function clipboard(text,textarea) {
  textarea.hidden=false;textarea.value=text;
  try {await navigator.clipboard.writeText(text);say('Copied.');}
  catch {textarea.focus();textarea.select();say('Select and copy the prepared text.');}
}
function transferDialog(title,body,{quick=false,onDismiss}={}) {
  if(document.querySelector('dialog[open]'))return;
  const opener=document.activeElement;
  const modal=h('dialog',{class:'ng-search-dialog ng-budget-transfer-dialog'+(quick?' ng-quick-sheet':'')});
  const close=async(focus=opener,{returnToSetup=true}={})=>{
    if(modal.dataset.applying==='true')return;
    pending=null;await dismissSheet(modal,focus);pending=null;
    if(returnToSetup)onDismiss?.();
  };
  modal.append(h('header',{},h('h2',{},title),actionButton('Close','X',()=>void close(),{only:true})));
  modal.addEventListener('cancel',event=>{event.preventDefault();void close();});
  body(modal,close);
  const footer=modal.querySelector('.ng-scoped-apply');
  footer?.remove();
  const scroller=h('div',{class:'ng-sheet-body'},...[...modal.children].slice(1));
  modal.append(scroller);
  if(footer)modal.append(footer);
  document.body.append(modal);openDialog(modal);
}
function exportBudgetToAI(scope,label,onDismiss) {
  transferDialog(tr('Export to AI')+' · '+label,modal=>{
    const subsidy=scope===subsidyScope;
    const description=subsidy?'Subsidy context and instructions':'Budget context and instructions';
    const output=h('textarea',{readonly:true,rows:7,'aria-label':tr(description)});
    output.value=subsidy?subsidyTransferContext(ledger):budgetTransferContext(ledger,scope,label);
    const instructions=h('details',{},h('summary',{},tr('View instructions')),output);
    const status=h('p',{class:'ng-transfer-state',role:'status'});
    modal.append(h('p',{class:'ng-caption'},tr('Paste the instructions into your AI chat. When you are ready, ask for “Export Workie Changes” and paste the final JSON back here.')),
      actionButton(subsidy?'Copy subsidy and instructions':'Copy budget and instructions','Copy',async()=>{
        try {await navigator.clipboard.writeText(output.value);status.textContent=tr('Instructions copied.');}
        catch {instructions.open=true;output.focus();output.select();status.textContent=tr('Select and copy the prepared text.');}
      },{kind:'primary'}),status,instructions);
  },{quick:true,onDismiss});
}
function importBudgetFromAI(scope,label,onDismiss) {
  transferDialog(tr('Import from AI')+' · '+tr(label),(modal,close)=>transfer(modal,{scope,close}),{quick:true,onDismiss});
}
function transfer(host=content,{scope,close}={}) {
  const scoped=scope!==undefined;
  const prepare=(record,text)=>scope===subsidyScope?prepareScopedSubsidyBatch(record,text):
    scoped?prepareScopedBudgetBatch(record,text,scope):prepareBatch(record,text,{weeklyTransfer:true});
  const setDraft=text=>{if(scoped)budgetDrafts.set(scope,text);else transferDraft=text;};
  const output=h('textarea',{rows:5,readonly:true,hidden:true,'aria-label':'Prepared text'}),
    source=h('textarea',{id:'ng-transfer-input',rows:scoped?5:8,spellcheck:false,'aria-label':'Paste Workie changes'}),
    preview=h('div',{id:'ng-transfer-preview',tabindex:'-1'}),
    choices=h('div',{class:'ng-copy-list'}),
    diagnostic=h('p',{id:'ng-transfer-diagnostic',class:'ng-transfer-diagnostic',role:'alert'}),
    remedies=h('div',{class:'ng-transfer-remedies ng-actions'}),
    state=h('p',{class:'ng-transfer-state',role:'status'},scoped?'':tr('Paste a proposal to begin.')),
    apply=button(tr('Confirm and apply'),async()=>{
      if(!pending) return;
      const review=pending,text=source.value,current=ledger;
      if(scoped)host.dataset.applying='true';
      apply.disabled=true;
      apply.textContent=tr('Applying changes…');
      diagnostic.textContent='';remedies.replaceChildren();
      try {
        const prepared=await prepare(current,text);
        if(review!==pending||text!==source.value||prepared.hash!==review.hash||ledger.revision!==review.revision)
          throw Error('Records or proposal changed. Preview again.');
        prepared.next.batches.push({id:prepared.batch.batch_id,hash:prepared.hash,at:new Date().toISOString()});
        await save(prepared.next,'Apply Workie Transfer '+prepared.batch.batch_id);
        setDraft('');
        if(scoped) {
          delete host.dataset.applying;
          await close();
          showUndo(current.revision,tr('Changes saved on this device.'));
          return;
        }
        const currentSource=content.querySelector('#ng-transfer-input');
        if(currentSource)currentSource.value='';
        const receipt=content.querySelector('.ng-transfer-state');
        if(receipt) {
          receipt.textContent=tr('Changes saved on this device.');
          showUndo(current.revision,tr('Changes saved on this device.'));
        }
        say('Saved on this device.');
      } catch(error) {showDiagnostic(error);}
      finally {delete host.dataset.applying;apply.textContent=tr('Confirm and apply');apply.disabled=!pending;}
    },'primary');
  source.value=scoped?budgetDrafts.get(scope)??'':transferDraft;
  source.setAttribute('aria-describedby','ng-transfer-diagnostic');
  apply.disabled=true;
  apply.hidden=scoped;
  async function copyForReview(text,status) {
    try {
      await navigator.clipboard.writeText(text);
      state.textContent=tr(status);
    } catch {
      source.focus();source.select();
      state.textContent=tr('Draft selected. Use your device’s copy command.');
    }
  }
  function showDiagnostic(error) {
    pending=null;apply.disabled=true;remedies.replaceChildren();
    if(scoped){apply.hidden=true;validate.hidden=false;}
    const match=error.message.match(/^\$\.operations\[(\d+)](?:\.(.*?))?:\s*(.*)$/);
    if(error instanceof TransferSyntaxError) {
      const location=error.line===null?'':tr('Line')+' '+error.line+' · '+tr('Column')+' '+error.column+' — ';
      diagnostic.textContent=tr('Invalid JSON')+' · '+location+tr(error.extra==='multiple'?
        'More than one JSON proposal. Copy one complete object, from its opening { to its closing }.':
        error.extra?'Extra text surrounds the proposal. Copy only the JSON object, from its opening { to its closing }.':error.escapedArray?
        'Remove the backslash before the opening square bracket.':
        'Check the quotes, commas and brackets near this point.');
      if(error.suggestion)remedies.append(button(tr('Remove the stray backslash'),()=>{
        source.value=error.suggestion;source.oninput();
        source.focus();source.setSelectionRange(error.index,error.index);
      }));
      else if(error.index!==null&&!error.extra)remedies.append(button(tr('Go to the error'),()=>{
        source.focus();source.setSelectionRange(error.index,Math.min(source.value.length,error.index+1));
      }));
    } else if(error instanceof TransferContextError) {
      diagnostic.textContent=tr(error.message);
      remedies.append(button(tr('Copy draft'),()=>copyForReview(source.value,'Draft copied.')));
      if(error.destination&&scoped)remedies.append(button(tr(error.destination==='vienna'?'Open Vienna Budget import':'Open Subsidy import'),async()=>{
        const destination=error.destination==='vienna'?null:subsidyScope;
        if(!budgetDrafts.get(destination)?.trim())budgetDrafts.set(destination,source.value);
        else await copyForReview(source.value,'Draft copied.');
        await close(undefined,{returnToSetup:false});
        if(destination===null)navigate('Budget');
        else showSection('Pre-departure','subsidy');
        importBudgetFromAI(destination,destination===null?'Vienna Budget':'Subsidy');
      }));
    } else if(error instanceof BatchIdentifierError) {
      diagnostic.textContent=tr(error.missing?'Missing batch identifier. Give this unapplied proposal a new ID.':
        'Invalid batch identifier. Give this unapplied proposal a new ID.');
      const original=source.value;
      remedies.append(button(tr('Prepare fresh draft'),async()=>{
        try {
          const text=error.freshDraft(),batch=parseWtp(text);
          for(const entry of ledger.batches) {
            if(await batchHash({...batch,batch_id:entry.id})===entry.hash) {
              throw Error('These changes were already applied. A new ID cannot be issued for this draft.');
            }
          }
          if(!source.isConnected||source.value!==original)return;
          source.value=text;source.oninput();
          state.textContent=tr('New batch ID ready. Preview the draft before applying.');
        } catch(problem) {
          if(source.isConnected&&source.value===original)showDiagnostic(problem);
        }
      }));
    } else {
      diagnostic.textContent=match?tr('Change')+' '+(Number(match[1])+1)+(match[2]?' · '+match[2]:'')+' — '+tr(match[3]):
        tr('Proposal validation')+' · '+tr(error.message);
    }
    state.textContent='';
    source.setAttribute('aria-invalid','true');
  }
  source.oninput=()=>{
    setDraft(source.value);pending=null;preview.replaceChildren();apply.disabled=true;
    if(scoped){apply.hidden=true;validate.hidden=false;}
    diagnostic.textContent='';remedies.replaceChildren();source.removeAttribute('aria-invalid');
    state.textContent=scoped?'':tr('Preview the current proposal to apply it.');
    validate.disabled=!source.value.trim()||preview.getAttribute('aria-busy')==='true';
  };
  for(const row of scoped?[]:ledger.records) {
    choices.append(h('label',{class:'ng-check'},
      h('input',{type:'checkbox',value:row.id}),h('span',{},names[row.entity]+' · '+row.data.description)));
  }
  const selection=h('details',{class:'ng-chart-data'},h('summary',{},tr('Copy selected records')),
    h('p',{class:'ng-caption'},tr('Share only the records you select. Student contact, address and location stay on this device.')),
    choices,button(tr('Copy selected'),()=>{
      const ids=new Set([...choices.querySelectorAll('input:checked')].map(input=>input.value));
      const records=ledger.records.filter(row=>ids.has(row.id)).map(row=>{
        const {contact,address,location,...data}=row.data;
        return {entity:row.entity,record_id:row.id,expected_revision:row.revision,data};
      });
      if(!records.length) {say('Select at least one record.');return;}
      clipboard(JSON.stringify({as_of:today(),records},null,2),output);
    }));
  const refreshPreview=async()=>{
    const text=source.value;
    const current=ledger;
    pending=null;apply.disabled=true;preview.replaceChildren();
    setDraft(text);diagnostic.textContent='';remedies.replaceChildren();source.removeAttribute('aria-invalid');
    validate.disabled=true;preview.setAttribute('aria-busy','true');state.textContent=tr('Checking proposal…');
    try {
      const prepared=await prepare(current,text);
      if(text!==source.value||!preview.isConnected||host.dataset.closing)return;
      if(current.revision!==ledger.revision)throw Error('Records changed while building the preview. Preview again.');
    pending={hash:prepared.hash,revision:current.revision};
    const impact=[['Available resources','available'],['Expected coverage','expected']];
    if(scope!==subsidyScope)impact.push(['Remaining plan','total']);
    preview.replaceChildren(h('h3',{},tr('Review changes')),
      ...prepared.warnings.map(message=>h('p',{class:'ng-warning'},message)),
      h('dl',{class:'ng-transfer-impact'},...impact
        .map(([label,key])=>h('div',{},h('dt',{},tr(label)),h('dd',{},amount(prepared.before[key])+' → '+amount(prepared.after[key]))))),
      ...prepared.diff.map((change,index)=>h('article',{class:'ng-diff'},
        h('h4',{},h('span',{class:'ng-change-badge','data-operation':change.op},tr(change.op)),tr(names[change.entity])),
        transferDifference(change),
        change.op!=='DELETE'?transferFields(prepared.batch,index,source,apply,refreshPreview):null)));
      state.textContent=tr('Review the proposed changes before applying.');
      apply.disabled=false;apply.hidden=false;
      if(scoped)validate.hidden=true;
      preview.focus();
    } catch(error) {
      if(text===source.value&&preview.isConnected)showDiagnostic(error);
    } finally {
      preview.removeAttribute('aria-busy');
      validate.disabled=!source.value.trim();
    }
  };
  const validate=button(tr('Preview changes'),refreshPreview);
  validate.disabled=!source.value.trim();
  const example=h('textarea',{readOnly:true,rows:6,'aria-label':tr('Valid JSON example')});
  example.value=transferExample(scope);
  const help=h('details',{class:'ng-transfer-example'},h('summary',{},tr('Valid JSON example')),example,
    button(tr('Copy example'),async()=>{
      const text=example.value=transferExample(scope);
      try {await navigator.clipboard.writeText(text);state.textContent=tr('Example copied. Edit its values before previewing.');}
      catch {example.focus();example.select();state.textContent=tr('Example selected. Use your device’s copy command.');}
    }));
  host.append(h('div',{class:scoped?'ng-scoped-transfer':'ng-transfer-layout'},
    !scoped?h('section',{class:'ng-surface ng-transfer ng-transfer-copy'},h('h2',{},tr('Prepare a conversation')),
      h('p',{class:'ng-caption'},tr('Copy the instructions into a chatbot of your choice. Workie processes the reply on this device.')),
      button(tr('Copy Chatbot Instructions'),()=>clipboard(prompt+'\n\n'+weeklyTransferGuidance+'\n\n'+schemaForPrompt(),output),'primary'),selection,output):null,
    h('section',{class:scoped?'ng-transfer-review':'ng-surface ng-transfer ng-transfer-review'},!scoped?h('h2',{},tr('Review a proposal')):null,
      h('label',{for:'ng-transfer-input'},tr('Paste changes')),
      scoped?null:h('p',{class:'ng-caption'},tr('General totals use the week-ending Sunday. Use Special for individually dated spending.')),
       source,diagnostic,remedies,state,help,scoped?null:validate,preview,
       scoped?h('footer',{class:'ng-scoped-apply'},validate,apply):apply)));
}
function transferDifference(change) {
  const before=change.before??{},after=change.after??{};
  const keys=[...new Set([...Object.keys(before),...Object.keys(after)])]
    .filter(key=>key!=='entry_created_at'&&JSON.stringify(before[key])!==JSON.stringify(after[key]));
  const value=(record,key)=>{
    const field=record[key];
    if(field===null||field===undefined)return '—';
    if(key==='amount'&&record.currency) {
      const money=amount(Math.round(field*100),record.currency);
      const split=money.indexOf('\u00a0');
      if(split<0)return money;
      return h('span',{class:'ng-diff-money'},money.slice(0,split),' ',
        h('span',{class:'ng-diff-number'},money.slice(split+1)));
    }
    if(typeof field==='boolean')return tr(field?'Yes':'No');
    return typeof field==='object'?JSON.stringify(field):tr(optionLabels[field]??String(field));
  };
  return h('div',{class:'ng-diff-table-wrap',tabindex:'0',role:'region','aria-label':tr('Proposed fields')},
    h('table',{class:'ng-table ng-difference'},
    h('thead',{},h('tr',{},...['Field','Previous','Proposed'].map(label=>h('th',{scope:'col'},tr(label))))),
    h('tbody',{},...keys.map(key=>h('tr',{},h('th',{scope:'row'},tr(fieldLabel(key))),
      h('td',{},value(before,key)),h('td',{},value(after,key)))))));
}
function transferFields(batch,index,source,apply,refreshPreview) {
  const operation=batch.operations[index];
  const proposed=operation.data??operation.changes;
  const controls=new Map();
  const fields=h('div',{class:'ng-form-grid'},...Object.entries(proposed).map(([key,value])=>{
    const rule=schema[operation.entity][key];
    let control;
    if(rule.enum) {
      control=h('select',{},...rule.enum.map(name=>h('option',{value:name},tr(optionLabels[name]??name))));
      control.value=value;
    }else if(rule.type==='boolean') {
      control=h('input',{type:'checkbox'});control.checked=value;
    }else if(rule.type==='shares') {
      control=h('textarea',{rows:3});control.value=JSON.stringify(value,null,2);
    }else {
      const type=['number','money'].includes(rule.type)?'number':(['date','time','month'].includes(rule.type)?rule.type:'text');
      control=h('input',{type,value:value??'',step:rule.type==='money'?'.01':'any'});
    }
    controls.set(key,control);
    return h('label',{class:rule.type==='boolean'?'ng-check':'ng-field'},h('span',{},tr(fieldLabel(key))),control);
  }));
  fields.addEventListener('input',()=>{pending=null;apply.disabled=true;});
  const error=h('p',{role:'alert'});
  const revise=button('Preview corrected fields',()=>{
    const next=clone(batch),change=next.operations[index].data??next.operations[index].changes;
    try {
      for(const [key,control] of controls) {
        const rule=schema[operation.entity][key],value=control.value;
        change[key]=rule.type==='boolean'?control.checked:!value&&rule.nullable?null:
          rule.type==='shares'?JSON.parse(value):['number','money'].includes(rule.type)?(value===''?'':Number(value)):value;
      }
      source.value=JSON.stringify(next,null,2);refreshPreview();
    } catch(caught){error.textContent=caught.message;}
  });
  return h('details',{class:'ng-transfer-fields'},h('summary',{},'Correct proposed fields'),fields,error,revise);
}
function settings() {
  const language=h('select',{'aria-label':tr('Language'),onchange:event=>run(async()=>{
    const next=clone(ledger);next.settings.language=event.target.value;await save(next,'Change interface language');
    content.querySelector('[data-language]')?.focus();
  }),'data-language':''},h('option',{value:'en',lang:'en'},'English'),h('option',{value:'zh-Hant',lang:'zh-Hant'},'繁體中文'));
  language.value=ledger.settings.language??'en';
  const theme=document.documentElement.classList.contains('dark')?'dark':'light';
  const themes=segments('appearance','Theme',[['light','Light'],['dark','Dark']],theme,value=>run(async()=>{
    await changeTheme(value);
    content.querySelector('[name="appearance"]:checked')?.focus({preventScroll:true});
  }));
  const importFeedback=h('p',{id:'ng-backup-feedback',class:'ng-caption',role:'status'});
  const file=h('input',{type:'file',accept:'.json','aria-label':tr('Import backup'),'aria-describedby':'ng-backup-feedback',
    onchange:async event=>{
      const selected=event.target.files[0];if(!selected)return;
      file.disabled=true;importFeedback.setAttribute('role','status');
      importFeedback.textContent=tr('Checking backup…');file.removeAttribute('aria-invalid');
      try {
        const next=await inspectBackup(await selected.text());
        if(file.isConnected)reviewBackup(next.scope==='work'?requireWorkScope(next):next);
        importFeedback.textContent='';
      } catch(error) {
        importFeedback.setAttribute('role','alert');importFeedback.textContent=tr(error.message);
        file.setAttribute('aria-invalid','true');
      } finally {file.disabled=false;file.value='';}
    }});
  const recoveries=h('div',{class:'ng-restore-list'});
  recoveries.append(h('p',{class:'ng-caption',role:'status'},tr('Loading restore points…')));
  restorePoints().then(points=>{
    recoveries.replaceChildren(...(points.length?points.slice(0,20).map(point=>button(point.at+' · '+point.reason,()=>run(async()=>{
      if(!window.confirm('Restore this point? Current records will also be saved before restoring.'))return;
      ledger=await restoreLedger(point.id,ledger.revision);channel?.postMessage(ledger.revision);render();say('Restore completed.');
    }))):[h('p',{class:'ng-caption'},tr('Restore points appear after the first saved change.'))]));
  }).catch(error=>recoveries.replaceChildren(h('p',{role:'alert'},tr(error.message))));
  const currencies=[...new Set(ledger.records.map(row=>row.data.currency).filter(Boolean))];
  const panels=h('div',{},
    h('section',{class:'ng-surface'},h('h2',{},tr('Appearance')),themes,
      h('label',{class:'ng-field'},h('span',{},tr('Language')),language),
      h('h3',{},tr('Display currency')),
      h('div',{class:'ng-actions ng-segmented'},...['HKD','EUR'].map(currency=>{
        const choice=button(currency,()=>run(async()=>{
        if(!displayQuote(ledger,currency))throw Error('Add a dated '+currency+' exchange rate before switching.');
        const next=clone(ledger);next.settings.currency=currency;await save(next,'Change display currency');
        }));
        choice.setAttribute('aria-pressed',String(currency===(ledger.settings.currency??'HKD')));
        if(!displayQuote(ledger,currency)) {
          choice.disabled=true;
          choice.setAttribute('aria-describedby','ng-rate-choice-hint');
        }
        return choice;
      })),
      displayQuote(ledger,'EUR')?null:h('p',{id:'ng-rate-choice-hint',class:'ng-caption'},tr('Add a dated EUR rate to enable euro display.')),
      h('h3',{},tr('Offline storage')),h('p',{class:'ng-caption'},navigator.onLine?'Local records ready.':'Offline · local records ready.'),
      h('p',{class:'ng-caption'},ledger.records.length+' records · revision '+ledger.revision),
      h('label',{class:'ng-field'},h('span',{},tr('Default expense currency')),
        h('select',{onchange:event=>run(async()=>{
          const next=clone(ledger);next.settings.expense_currency=event.target.value;
          await save(next,'Change default expense currency');
        })},...expenseCurrencies().map(code=>{
          const option=currencyOption(code);
          option.selected=code===(ledger.settings.expense_currency??'HKD');
          return option;
        }))),
      h('h3',{'data-settings-dates':''},tr('Exchange dates')),
      ...[['departure_date','Departure date'],['return_date','Return date']].map(([key,label])=>
        h('label',{class:'ng-field'},h('span',{},tr(label)),h('input',{type:'date',value:ledger.settings[key]??'',
          onchange:event=>run(async()=>{
            const next=clone(ledger);next.settings[key]=event.target.value||null;
            try {await save(next,'Change '+label.toLowerCase());}
            catch(error) {event.target.value=ledger.settings[key]??'';throw error;}
          })})))),
    h('section',{class:'ng-surface'},h('h2',{},tr('Backups & handoff')),
      h('div',{class:'ng-settings-actions'},
        actionButton('Export complete backup','Download',()=>run(async()=>download(await exportLedger(ledger),'workie-nextgen-'+today()+'.json')),{display:'Export backup'}),
        actionButton('Export records as CSV','Table2',()=>download(exportRecordsCsv(ledger.records),'workie-records-'+today()+'.csv','text/csv;charset=utf-8'),{display:'Export CSV'})),
      h('label',{class:'ng-field'},h('span',{},tr('Import verified backup')),file),
      importFeedback,
      actionButton('Restore Gen 1 data','import',chooseLegacyBackup),
      ledger.legacy?button(tr('Export original legacy source'),()=>download(ledger.legacy.original?.raw??ledger.legacy.raw,'workie-original-'+today()+'.json')):null,
      h('h3',{},tr('Restore points')),h('p',{class:'ng-caption'},'The latest 20 changes are available for restore. The initial legacy source stays in complete exports.'),recoveries),
    h('section',{class:'ng-surface'},h('h2',{},tr('Exchange rates')),automaticRateSettings(),
      h('p',{class:'ng-caption'},'Dated offline quotes in HKD per unit of original currency.'),
      ...currencies.map(currency=>{
        const rate=quote(ledger,currency);
        const age=rate?Math.round((Date.parse(today())-Date.parse(rate.date))/86400000):null;
        const provenance=currency==='HKD'?'Base currency':rate?
          'Recorded quote · '+rate.rate+' · '+rate.date+' · '+rate.source+' · '+age+' days old':'Rate needed';
        return h('p',{},currency+' · '+provenance);
      }),
      button('Add manual rate',()=>edit('fx_quote',null,{currency:'EUR',date:today()}))),
    syncSettings(),
    h('section',{class:'ng-surface'},h('h2',{},tr('Migration records')),
      h('p',{class:'ng-caption'},ledger.legacy?'Original source checksum '+ledger.legacy.sourceHash:'Started with an empty local ledger.'),
      ...(ledger.legacy?.warnings??[]).map(message=>h('p',{class:'ng-warning'},message)),
      ledger.legacy?button(tr('Review legacy changes'),()=>run(async()=>{
        const raw=localStorage.getItem('tutoring_data')??ledger.legacy.raw;
        const hash=await digest(raw);
        if(hash===ledger.legacy.sourceHash&&ledger.legacy.migrationVersion===legacyMigrationVersion){say('Legacy source matches the last migration.');return;}
        const preview=mergeLegacy(ledger,raw,hash);
        reviewLegacyMerge(preview,hash);
      })):null,
      h('details',{class:'ng-legacy-directory'},h('summary',{},tr('Find preserved workflows')),legacyEntries()),
      button(tr('Open legacy workspace'),()=>openLegacy())));
  const audit=h('div',{class:'ng-audit'},
    ...ledger.audit.slice().reverse().slice(0,30).map(entry=>h('details',{},
      h('summary',{},entry.at+' · '+entry.reason+' · '+(entry.changes?.length??0)+' records'),
      h('pre',{},JSON.stringify({records:entry.changes??[],...(entry.settings_before!==undefined?
        {settings_before:entry.settings_before,settings_after:entry.settings_after}:{})},null,2)))));
  const [appearance,backup,rates,sync,migrationRecords]=panels.children;
  const dates=h('div',{class:'ng-setting-fields'});
  const origin=appearance.querySelector('[data-settings-dates]');
  while(origin.nextSibling)dates.append(origin.nextSibling);
  origin.remove();
  const group=(id,label,node,symbol,value)=>sectionDisclosure(id,label,host=>{
    node.classList.remove('ng-surface');
    node.querySelector(':scope > h2')?.remove();
    host.append(node);
  },symbol,value);
  const settingsGroup=(label,...rows)=>h('section',{class:'ng-settings-group','aria-label':tr(label)},
    h('h2',{},tr(label)),h('div',{class:'ng-settings-list'},...rows));
  content.append(h('div',{class:'ng-settings-hub'},
    settingsGroup('Preferences',
      actionButton('Welcome and setup','Sparkles',()=>onboarding()),
      group('appearance','Appearance',appearance,'appearance',tr(theme==='dark'?'Dark':'Light')+' · '+(language.value==='en'?'English':'繁體中文')),
      group('exchange-dates','Exchange dates',dates,'dates',ledger.settings.departure_date?compactDate(ledger.settings.departure_date):tr('Set dates')),
      group('exchange-rates','Exchange rates',rates,'rates',ledger.settings.currency??'HKD')),
    settingsGroup('Data and recovery',
      group('backups','Backups & handoff',backup,'backup'),group('sync','Sync and handoff',sync,'sync',tr('Local only')),
      sectionDisclosure('app-update','Build version',appUpdatePanel,'sync',document.querySelector('meta[name="workie-build"]')?.content),
      sectionDisclosure('transfer','Advanced transfer',transfer,'transfer'),
      group('migration','Migration records',migrationRecords,'migration'),group('audit','Change history',audit,'history')),
    settingsGroup('Exchange administration',
      sectionDisclosure('preparation','Exchange preparation',host=>listView('Administration',host),'calendar'))));
}
function automaticRateSettings() {
  const config=ledger.settings.auto_fx??{enabled:false};
  const ref=config.reference;
  const detail=h('output',{id:'ng-rate-status',class:'ng-caption',role:'status'},
    fxStatus||(!navigator.onLine?tr('Offline · using the last valid rate where available.'):
      ref&&rateIsStale(ref)?tr('Last reference rate is stale.'):config.enabled?tr('Automatic refresh enabled.'):tr('Manual rates selected.')));
  const toggle=h('input',{type:'checkbox',onchange:event=>run(async()=>{
    const next=clone(ledger);
    next.settings.auto_fx={...config,enabled:event.target.checked};
    await save(next,'Change exchange rate refresh preference');
    if(event.target.checked)void refreshReferenceRate();
  })});
  toggle.checked=config.enabled;
  const refresh=actionButton('Refresh EUR/HKD','RefreshCw',refreshReferenceRate);
  refresh.disabled=!config.enabled||!navigator.onLine;
  return h('div',{class:'ng-rate-settings'},
    h('label',{class:'ng-check'},toggle,h('span',{},tr('Refresh EUR/HKD automatically'))),
    ref?h('p',{'data-rate':'EUR/HKD'},'EUR 1 · HKD '+ref.rate+' · '+ref.date+' · '+ref.source+
      ' · '+tr('Updated')+' '+ref.updated_at.slice(0,16).replace('T',' ')+' UTC'):null,
    detail,refresh,
    h('p',{class:'ng-caption'},tr('Automatic rates apply to estimates and display. Disable automatic refresh to use the dated manual rate. Historical cash conversions use their recorded dates.')));
}
async function refreshReferenceRate() {
  if(!navigator.onLine||!ledger?.settings.auto_fx?.enabled||fxLoading)return;
  fxLoading=true;
  const report=message=>{
    fxStatus=tr(message);
    const node=document.querySelector('#ng-rate-status');
    if(node)node.textContent=fxStatus;
  };
  report('Checking EUR/HKD…');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6500);
  try {
    const reference=await fetchReferenceRate({signal:controller.signal});
    if(!ledger.settings.auto_fx?.enabled)return;
    const previous=ledger.settings.auto_fx.reference;
    if(previous&&previous.date>reference.date)throw Error('The provider returned an older rate. Kept the last valid rate.');
    const next=clone(ledger);
    next.settings.auto_fx.reference=reference;
    report(rateIsStale(reference)?'Reference rate updated but is stale.':'Reference rate updated.');
    await save(next,'Refresh EUR/HKD reference rate');
  } catch {
    report('Exchange-rate refresh failed. Kept the last valid rate.');
  } finally {
    clearTimeout(timer);fxLoading=false;
  }
}
function syncSettings() {
  return h('section',{class:'ng-surface'},h('h2',{},tr('Sync and handoff')),
    h('p',{class:'ng-caption'},tr('Local only · cloud sync is off.')),
    h('p',{class:'ng-caption'},tr('Use a verified backup to move the complete Workie ledger between devices.')));
}
function appUpdatePanel(host) {
  const service=navigator.serviceWorker;
  const status=h('p',{class:'ng-caption',role:'status'});
  let registration;
  const check=actionButton('Check for update','sync',async()=>{
    check.disabled=true;install.hidden=true;
    status.textContent=tr('Checking for an update…');
    try {
      registration=await service?.getRegistration();
      if(!registration)throw Error('The offline app is unavailable in this browser.');
      await registration.update();
      const worker=registration.installing;
      if(worker&&['installing','parsed'].includes(worker.state))await new Promise(resolve=>{
        const settled=()=>{
          if(['installed','activated','redundant'].includes(worker.state)) {
            worker.removeEventListener('statechange',settled);resolve();
          }
        };
        worker.addEventListener('statechange',settled);settled();
      });
      if(worker?.state==='redundant')throw Error('The update could not download. Try again while online.');
      install.hidden=!registration.waiting;
      status.textContent=tr(install.hidden?'This build is current.':'An update is ready. Save any open work before installing.');
    } catch(error) {
      status.textContent=tr(navigator.onLine?error.message:'Connect to the internet to check for an update.');
    } finally {check.disabled=false;}
  });
  const install=actionButton('Install update','Check',async()=>{
    const waiting=registration?.waiting;
    if(!waiting) {
      status.textContent=tr('The update is ready after reopening Workie.');
      return;
    }
    check.disabled=install.disabled=true;
    const channel=new MessageChannel();
    const reload=()=>location.reload();
    service.addEventListener('controllerchange',reload,{once:true});
    const response=await new Promise(resolve=>{
      const timer=setTimeout(()=>resolve(null),6000);
      channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data);};
      try {waiting.postMessage('workie-install-update',[channel.port2]);}
      catch {clearTimeout(timer);resolve(null);}
    });
    channel.port1.close();
    if(response==='installing') {
      status.textContent=tr('Installing update…');
      return;
    }
    service.removeEventListener('controllerchange',reload);
    check.disabled=install.disabled=false;
    status.textContent=tr(response==='other-tabs'?'Close other Workie tabs, then install again.':
      'Close all Workie tabs and reopen to install safely.');
  },{kind:'primary'});
  install.hidden=true;
  host.append(h('div',{class:'ng-actions ng-context-actions'},check,install),status);
}
function migrationTotals(old,next) {
  const historical=entity=>next.records.filter(row=>row.entity===entity);
  const income=historical('income_entry').filter(row=>row.origin?.path?.startsWith('records/'));
  const expenses=historical('expense').filter(row=>row.origin?.path?.startsWith('expenses/'));
  const oldExpenses=old.expenses??[];
  const currencies=new Set([...oldExpenses.map(row=>row.currency??'HKD'),...expenses.map(row=>row.data.currency)]);
  const lines=[[tr('Historical income'), 'HKD', (old.records??[]).map(row=>row.income), income.map(row=>row.data.amount)]];
  for(const currency of currencies) {
    lines.push([tr('Recorded expenses'),currency,
      oldExpenses.filter(row=>(row.currency??'HKD')===currency).map(row=>row.amount),
      expenses.filter(row=>row.data.currency===currency).map(row=>row.data.amount)]);
  }
  return h('section',{'aria-label':tr('Migration financial reconciliation')},
    h('h3',{},tr('Migration financial reconciliation')),
    h('dl',{class:'ng-counts'},...lines.flatMap(([label,currency,before,after])=>{
      const beforeTotal=sumKnown(before.map(cents)),afterTotal=sumKnown(after.map(cents));
      const status=beforeTotal===null||afterTotal===null?tr('Review amounts'):
        beforeTotal===afterTotal&&before.length===after.length?tr('Matched'):tr('Review difference');
      return [h('dt',{},label+' · '+currency),h('dd',{},
        h('span',{},tr('Before')+' ',moneyText(beforeTotal,currency)),
        h('span',{},' · '+tr('After')+' ',moneyText(afterTotal,currency)),
        h('span',{},' · '+status))];
    })));
}
function reviewBackup(incoming,{mergeOnly=false}={}) {
  const workOnly=incoming.scope==='work';
  const revision=ledger.revision,changes=backupChanges(ledger,incoming).filter(change=>!workOnly||change.op!=='DELETE'),choices=new Map();
  const modal=h('dialog',{class:'ng-search-dialog'});
  const count=op=>changes.filter(change=>change.op===op).length;
  const error=h('p',{role:'alert'});
  modal.append(h('h2',{},tr(workOnly?'Review Work data':'Review backup restoration')),
    h('p',{},'Add '+count('ADD')+' · Conflicts '+count('CONFLICT')+(workOnly||mergeOnly?'':' · Remove on replacement '+count('DELETE'))),
    h('p',{class:'ng-caption'},workOnly||mergeOnly?tr('Merge uses your choices for conflicts and keeps existing records.'):
      'Merge adds new records and uses your choices for conflicts. Restore replaces the entire current ledger. Either operation saves a restore point.'),
    ...changes.map(change=>{
      const name=change.after?.data.description??change.before?.data.description;
      const chooser=h('select',{'aria-label':'Resolve '+name},h('option',{value:'current'},'Keep current'),h('option',{value:'backup'},'Use backup'));
      if(change.op==='CONFLICT')choices.set(change.id,chooser);
      return h('details',{},h('summary',{},change.op+' · '+name),
        h('pre',{},JSON.stringify(change.before?.data??null,null,2)+'\n↓\n'+JSON.stringify(change.after?.data??null,null,2)),
        change.fileChanged?h('p',{class:'ng-caption'},'Attachment content differs.'):null,change.op==='CONFLICT'?chooser:null);
    }),
    button('Merge into current workspace',async()=>{
      try {
        if(ledger.revision!==revision)throw Error('Current records changed. Preview the backup again.');
        const selected=new Set([...choices].filter(([,control])=>control.value==='backup').map(([id])=>id));
        await save(mergeBackup(ledger,incoming,selected),'Merge verified backup',revision);
        modal.close();modal.remove();
      } catch(caught) {error.textContent=caught.message;}
    }),
    error);
  if(!workOnly&&!mergeOnly)modal.append(button(tr('Confirm restoration'),async()=>{
      try {
        if(ledger.revision!==revision)throw Error('Current records changed. Preview the backup again.');
        const next=clone(incoming);
        next.batches=withTransferHistory(ledger,incoming);
        for(const row of next.records)row.revision=Math.max(row.revision,ledger.revision)+1;
        await save(next,'Import verified backup',revision);
        modal.close();modal.remove();
      } catch(caught) {error.textContent=caught.message;}
    },'primary'));
  modal.append(button(tr('Cancel'),()=>{modal.close();modal.remove();}));
  modal.addEventListener('cancel',()=>modal.remove());
  document.body.append(modal);openDialog(modal);
}
function chooseLegacyBackup() {
  transferDialog(tr('Restore Gen 1 JSON'),(modal,close)=>{
    const source=h('input',{type:'file',accept:'.json,application/json'});
    const output=h('p',{role:'alert',class:'ng-entry-error'});
    const scan=async file=>{
      if((!file&&!migrationRequired)||source.disabled)return;
      source.disabled=true;output.textContent='';
      try{
        const preview=await migrationPreview(localStorage,file?await file.text():null);
        if(!modal.isConnected||modal.dataset.closing)return;
        await close();renderMigrationPreview(preview);
      }catch(problem){output.textContent=tr(problem.message);source.value='';}
      finally{source.disabled=false;}
    };
    source.addEventListener('change',()=>{if(source.files[0])void scan(source.files[0]);});
    const drop=entryField('Choose Gen 1 JSON',source);
    drop.classList.add('ng-welcome-drop');
    drop.append(h('small',{},tr('Or drop one JSON backup here.')));
    drop.addEventListener('dragover',event=>event.preventDefault());
    drop.addEventListener('drop',event=>{
      event.preventDefault();
      if(event.dataTransfer.files.length===1)void scan(event.dataTransfer.files[0]);
      else output.textContent=tr('Choose one JSON backup.');
    });
    modal.append(drop,output);
    if(migrationRequired)modal.append(button(tr('Review existing records'),()=>scan(null)));
  },{quick:true});
}
function renderMigrationPreview(preview) {
  const warning=root.querySelector('#ng-migration-choice');
  warning.hidden=true;
  const old=JSON.parse(preview.next.legacy?.raw??'{}');
  const active=ledger.revision>0;
  const already=ledger.legacy?.sourceHash===preview.sourceHash||
    Object.values(ledger.legacy?.derivationSources??{}).some(row=>row.hash===preview.sourceHash);
  const topFields=['sources','records','scheduled','expenses','tripCategories','budgetPlanning','finance',
    'displayCurrency','isDarkMode','exchangeRate','lastRateUpdate','departureDate','workTools'];
  const rawOnly=Object.keys(old).filter(key=>!topFields.includes(key));
  const counts={student:0,lesson:0,income_entry:0,expense:0,balance:0,...preview.counts};
  content.replaceChildren(h('section',{class:'ng-surface'},
    h('h2',{tabindex:'-1'},tr('Review your migration')),
    h('p',{},tr('Review what Workie can map. The original JSON is kept for recovery.')),
    preview.fromBackup?h('p',{},tr('Reviewing the selected backup. Existing browser records are preserved.')):null,
    h('h3',{},tr('Records to map')),
    h('dl',{class:'ng-counts'},...Object.entries(counts).flatMap(([entity,count])=>[h('dt',{},tr(names[entity]??entity)),h('dd',{},String(count))])),
    migrationTotals(old,preview.next),
    h('h3',{},tr('Preserved with the original JSON')),
    h('p',{class:'ng-caption'},tr('Historical wallet snapshots')+' '+(old.smartExpenses?.length??0)+' · '+tr('Original source is retained. Fields without a Gen 2 equivalent remain in the backup.')),
    rawOnly.length?h('ul',{},...rawOnly.map(key=>h('li',{},key))):null,
    old.INITIAL_AMOUNT===undefined?null:h('p',{class:'ng-caption'},tr('Imported historical starting amount')+' · ',moneyText(cents(old.INITIAL_AMOUNT),'HKD')),
    ...(preview.next.legacy?.warnings??[]).map(message=>h('p',{class:'ng-warning'},message)),
    already?h('p',{role:'status'},tr('This backup has already been imported.')):button(tr(active?'Review merge conflicts':'Confirm migration'),()=>run(async()=>{
      if(active){reviewBackup(preview.next,{mergeOnly:true});return;}
      ledger=await activateMigration(preview,localStorage);migrationRequired=false;markActive();
      localStorage.removeItem(welcomePreference);
      channel?.postMessage(ledger.revision);render();say('Migration saved. Confirm your exchange balance when ready.');
    }),'primary'),
    button(tr('Cancel'),()=>{render();(root.querySelector('#ng-review-migration')?.offsetParent?
      root.querySelector('#ng-review-migration'):pageHeading())?.focus();}),
    button(tr('Open legacy workspace'),()=>openLegacy())));
  content.querySelector('h2').focus();
}
function reviewLegacyMerge(preview,hash) {
  const revision=ledger.revision,modal=h('dialog',{class:'ng-search-dialog'});
  const choices=new Map();
  modal.append(h('h2',{},tr('Review legacy changes')),
    h('p',{},preview.changes.length+' record changes · '+preview.conflicts.length+' conflicts'),
    ...preview.changes.map(change=>h('p',{class:'ng-caption'},change.op+' · '+change.id)));
  for(const conflict of preview.conflictDetails) {
    const select=h('select',{'aria-label':'Resolve '+conflict.id},
      h('option',{value:'current'},'Keep NextGen version'),
      h('option',{value:'legacy'},'Use legacy version'));
    choices.set(conflict.id,select);
    modal.append(h('section',{class:'ng-diff'},h('h3',{},conflict.id),
      h('p',{},'NextGen'),h('pre',{},JSON.stringify(conflict.current?.data??null,null,2)),
      h('p',{},'Legacy'),h('pre',{},JSON.stringify(conflict.source?.data??null,null,2)),select));
  }
  const error=h('p',{role:'alert'});
  modal.append(error,button(tr('Confirm merge'),async()=>{
    try {
      if(await digest(localStorage.getItem('tutoring_data')??ledger.legacy.raw)!==hash)throw Error('Legacy records changed again. Preview again.');
      if(ledger.revision!==revision)throw Error('NextGen records changed. Preview again.');
      const next=clone(preview.next);
      for(const conflict of preview.conflictDetails) {
        if(choices.get(conflict.id).value!=='legacy')continue;
        const index=next.records.findIndex(row=>row.id===conflict.id);
        if(index>=0)next.records.splice(index,1);
        if(conflict.source)next.records.push({...conflict.source,revision:Math.max(conflict.current?.revision??0,revision)+1});
      }
      await save(next,'Merge reviewed legacy changes');
      modal.close();modal.remove();
    } catch(caught) {error.textContent=caught.message;}
  },'primary'),button(tr('Cancel'),()=>{modal.close();modal.remove();}));
  modal.addEventListener('cancel',()=>modal.remove());
  document.body.append(modal);openDialog(modal);
}
function render() {
  if(!ledger) return;
  undoAction.replaceChildren();
  if(ledger.settings.theme)applyTheme(ledger.settings.theme);
  const lang=ledger.settings.language??'en';
  root.lang=lang;dialog.lang=lang;
  for(const item of document.querySelectorAll('[data-ng-label]')) {
    (item.querySelector('.ng-nav-label')??item).textContent=tr(item.dataset.ngLabel);
    item.setAttribute('aria-label',tr(item.dataset.ngLabel));
  }
  renderedModel=displayModel();
  root.querySelector('#ng-legacy-warning').hidden=!legacyChanges().changed;
  const migrationChoice=root.querySelector('#ng-migration-choice');
  const oldCloud=localStorage.getItem('firebase_config')!==null&&!ledger.revision;
  migrationChoice.hidden=!migrationRequired&&!oldCloud;
  migrationChoice.querySelector('#ng-review-migration').hidden=!migrationRequired;
  migrationChoice.querySelector('p').textContent=tr(migrationRequired?
    'Workie found records from an earlier version. Review these records or choose a Gen 1 backup. Synced records from other devices do not load automatically.':
    'This browser has a Gen 1 cloud configuration. Restore a Gen 1 backup to bring your records into this local-only release.');
  content.replaceChildren();
  content.dataset.route=view;
  root.dataset.route=view;
  root.dataset.folio=String(view in folioTitles);
  root.querySelector('#ng-page-title').textContent=tr(folioTitles[view]??view);
  root.querySelector('.ng-compact-title').textContent=tr(view);
  root.querySelector('.folio-section-label').textContent=folioSections[view]??'';
  document.querySelector('#ng-theme')?.setAttribute('aria-label',tr('Switch light and dark appearance'));
  for(const item of document.querySelectorAll('[data-ng-view]')) item.setAttribute('aria-current',item.dataset.ngView===view?'page':'false');
  document.querySelector('#ng-mobile-navigation')?.style.setProperty('--v3-tab-index',tabs.indexOf(view));
  root.querySelector('#ng-currency')?.setAttribute('aria-label',tr('Display currency')+' '+(ledger.settings.currency??'HKD')+'. '+tr('Switch currency'));
  const currency=root.querySelector('#ng-currency');
  currency.title=displayQuote(ledger,'EUR')?tr('Switch currency'):tr('Add a dated EUR rate to enable euro display.');
  if(view==='Home') overview();
  else if(view==='Settings') {
    settings();
    if(!fxStatus&&rateIsStale(ledger.settings.auto_fx?.reference))void refreshReferenceRate();
  }
  else if(view==='Trips') tripWorkspace();
  else if(view==='Pre-departure') preDeparture();
  else budgetWorkspace();
}
function sectionDisclosure(id,label,build,symbol,summaryValue=null) {
  const host=h('div',{class:'ng-secondary-body',id:'ng-section-'+id});
  const panel=h('details',{class:'ng-secondary',open:secondarySections.has(id),
    ontoggle:()=>{
      if(!panel.isConnected)return;
      if(panel.open) {
        secondarySections.add(id);
        if(!host.hasChildNodes())build(host);
      } else {
        secondarySections.delete(id);
      }
    }},h('summary',{},symbol?icon(actionIcons[symbol]??symbol):null,h('span',{},tr(label)),
      summaryValue?h('small',{class:'ng-section-value',title:summaryValue},summaryValue):null,
      icon('ChevronDown')),host);
  if(panel.open)build(host);
  return panel;
}
function editAction(label,symbol,entity,defaults={},options={}) {
  const control=actionButton(label,symbol,()=>edit(entity,null,defaults),options);
  control.dataset.editorAnchor=label;
  return control;
}
function weeklyMoney(value,{unit=true,signed=false}={}) {
  if(value===null)return h('span',{class:'ng-week-unknown'},tr('Pending amount'));
  if(unit&&!signed)return moneyText(value,'HKD');
  const text=new Intl.NumberFormat(ledger.settings.language==='zh-Hant'?'zh-HK':'en-HK',{
    minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:signed?'exceptZero':'auto',
  }).format(value/100);
  return h('span',{class:'ng-money','data-size':figureSize(text+' HKD')},
    h('span',{class:unit?'ng-money-unit':'ng-screen-reader'},'HKD '),text);
}
function animateSettlement(flow,previous,next) {
  if(!flow)return;
  const keys=['opening','income','settledExpense','differenceForWeek','adjustments'];
  const signedKeys=['adjustments','differenceForWeek','cashChange'];
  const values=figures=>({...Object.fromEntries(keys.map(key=>[key,key==='settledExpense'&&figures.implied<0?null:figures[key]])),
    cashChange:difference(figures.closing,figures.opening),
    bar:Math.round(10000*Math.min(1,Math.max(-1,(figures.differenceForWeek??0)/Math.max(1,figures.income??0,figures.settledExpense??0))))});
  const fields=[...flow.querySelectorAll('.ng-week-number')];
  const track=flow.querySelector('.ng-week-track');
  tweenNumbers(flow,previous?values(previous):null,values(next),current=>{
    for(const field of fields) {
      const key=field.dataset.weekNumber,value=current[key],signed=signedKeys.includes(key);
      if(field.dataset.cents===String(value))continue;
      field.dataset.cents=String(value);
      field.parentElement.dataset.negative=String(value<0);
      field.replaceChildren(weeklyMoney(value,{unit:false,signed}));
    }
    track.style.setProperty('--week-positive',Math.max(0,current.bar/10000));
    track.style.setProperty('--week-negative',Math.max(0,-current.bar/10000));
    track.dataset.signed=String(current.bar);
  });
}
function weekDateRange(week) {
  return compactDate(week)+' – '+compactDate(calendarDay(week,6),{day:'numeric',month:'short',year:'numeric'});
}
const weekEnding=end=>tr('Week ending Sunday')+' · '+compactDate(end,{day:'numeric',month:'short',year:'numeric'});
const observationDay=(end,date=today())=>date<end?date:end;
function manageWeekly(key,close,week) {
  return actionButton('History / Manage','history',async()=>{
    await close();
    settlementDetail=key;settlementWeek=week;
    openPrepTool(key);
    const panel=content.querySelector('#ng-week-detail');
    panel?.scrollIntoView({block:'nearest',behavior:reduceMotion()?'instant':'smooth'});
    panel?.focus({preventScroll:true});
  });
}
function chooseSettlementWeek(week) {
  settlementWeek=week;
  render();
  content.querySelector('#ng-weekly-title')?.focus({preventScroll:true});
}
function chooseSunday(end) {
  selectedSunday=end;
  chartSelections.set('weekly-savings',end);
  if(settlementWeek!==weekOf(end))settlementDetail='';
  settlementWeek=weekOf(end);
  render();
  content.querySelector('#ng-sunday-title')?.focus({preventScroll:true});
}
function sundaySavingsPanel(end,history) {
  const saved=history.find(row=>row.end===end);
  const input=h('input',{id:'ng-sunday-amount',name:'sunday_savings',type:'text',inputmode:'decimal',required:true,
    autocomplete:'off',placeholder:'0.00',value:saved?savingsDigits(saved.balance):''});
  const feedback=h('p',{class:'ng-entry-error',role:'alert'});
  const label=h('span',{},tr('Save'));
  const submit=h('button',{class:'ng-button primary ng-action-control',type:'submit','aria-label':tr('Save')},icon('Check'),label);
  input.addEventListener('input',()=>{label.textContent=tr('Save');feedback.textContent='';});
  const form=h('form',{class:'ng-sunday-form',onsubmit:async event=>{
    event.preventDefault();
    if(submit.disabled)return;
    submit.disabled=true;feedback.textContent='';
    try {
      const revision=ledger.revision,next=clone(ledger);
      if(saveSundaySavings(next.settings,end,savingsCents(input.value))) {
        chartSelections.set('weekly-savings',end);
        await save(next,'Save Sunday Savings '+end,revision,{announce:false});
        content.querySelector('#ng-sunday-title')?.focus({preventScroll:true});
        const savedForm=content.querySelector('.ng-sunday-form');
        if(savedForm) {
          savedForm.querySelector('button span').textContent=tr('Saved');
          savedForm.querySelector('[role="status"]').textContent=tr('Sunday savings saved.');
        }
      } else feedback.textContent=tr('This amount is already saved.');
    } catch(error) {feedback.textContent=tr(error.message);}
    finally {submit.disabled=false;}
  }},h('label',{for:input.id,class:'ng-screen-reader'},tr('Savings in Hong Kong dollars')),
    h('div',{class:'ng-sunday-entry'},h('div',{class:'ng-sunday-amount'},h('span',{'aria-hidden':'true'},'HKD'),input),submit),feedback,
    h('span',{class:'ng-screen-reader',role:'status'}));
  const change=saved?.change??null;
  return h('section',{class:'ng-weekly ng-sunday-savings','aria-labelledby':'ng-sunday-title','data-sunday':end},
    h('header',{class:'ng-week-heading'},h('div',{},h('h2',{id:'ng-sunday-title',tabindex:'-1'},tr('Sunday Savings')),
      h('time',{datetime:end},compactDate(end,{weekday:'short',day:'numeric',month:'short',year:'numeric'})+' · '+tr('Hong Kong time'))),
      actionButton('History','History',()=>openSundayHistory(end,history),{only:true})),
    form,
    h('div',{class:'ng-sunday-change','data-sign':change===null?'unknown':change<0?'negative':change>0?'positive':'zero'},
      h('span',{},tr('Weekly savings change')),
      change===null?h('small',{},tr(saved?.status==='Baseline'?'First saved Sunday · baseline':
        saved?'Previous Sunday missing':'Available after two consecutive Sundays are saved')):weeklyMoney(change,{signed:true})));
}
function openSundayHistory(end,history) {
  transferDialog(tr('Savings history'),(modal,close)=>{
    const date=h('input',{name:'sunday',type:'date',max:latestSunday(),value:end,required:true,
      oninput:()=>date.setCustomValidity('')});
    const open=async saved=>{await close();chooseSunday(saved);};
    modal.append(h('form',{class:'ng-entry-form',onsubmit:event=>{
      event.preventDefault();
      if(latestSunday(date.value)!==date.value) {
        date.setCustomValidity(tr('Choose an ending Sunday.'));date.reportValidity();return;
      }
      void open(date.value);
    }},entryField('Sunday ending date',date),h('button',{class:'ng-button primary',type:'submit'},tr('Open Sunday'))));
    if(history.length)modal.append(h('ul',{class:'ng-week-history ng-sunday-history'},...[...history].reverse().map(row=>{
      const versions=sundayVersions(ledger.settings,row.end);
      return h('li',{},h('button',{class:'ng-study-row',type:'button',onclick:()=>open(row.end)},
        icon('CalendarDays'),h('span',{},compactDate(row.end,{day:'numeric',month:'short',year:'numeric'})),
        weeklyMoney(row.balance),icon('ChevronRight')),
        versions.length>1?h('details',{class:'ng-week-bridge'},h('summary',{},h('span',{},icon('ChevronDown'),tr('Corrections'))),
          ...versions.map(version=>h('div',{class:'ng-week-bridge-row'},
            h('span',{},tr(version.source==='CONFIRMED'?'Original confirmation':version.source==='OBSERVED'?'Historical Sunday observation':'Saved balance'),
              version.at?' · '+new Intl.DateTimeFormat(ledger.settings.language==='zh-Hant'?'zh-HK':'en-HK',
                {timeZone:HONG_KONG,dateStyle:'medium',timeStyle:'short'}).format(new Date(version.at)):null),
            weeklyMoney(version.amount)))):null);
    })));
    modal.append(h('details',{class:'ng-entry-options ng-week-bridge'},
      h('summary',{},h('span',{},icon('ChevronDown'),tr('More history tools'))),
      ...[['settlement','Settlement and opening balances'],['cash','Cash activity and forecast'],['transactions','Transactions and bills']]
        .map(([key,title])=>actionButton(title,'history',async()=>{await close();openPrepTool(key);}))));
  },{quick:true});
}
function weeklySettlementPanel() {
  const report=weeklySettlement(ledger,settlementWeek);
  const {week,confirmed,preceding,observation,end}=report;
  const figures=settlementView(weeklyWithDraft(settlementWeek));
  const {opening,income,settledExpense,differenceForWeek,adjustments,discrepancy}=figures;
  const strip=h('div',{class:'ng-week-controls'},
    actionButton('Previous week','ChevronLeft',()=>chooseSettlementWeek(calendarDay(week,-7)),{only:true}),
    h('time',{datetime:week},weekDateRange(week)),
    actionButton('Next week','ChevronRight',()=>chooseSettlementWeek(calendarDay(week,7)),{only:true}));
  strip.lastElementChild.disabled=week>=weekOf(today());
  const number=(key,value)=>h('span',{class:'ng-week-number','data-week-number':key},
    weeklyMoney(value,{unit:false,signed:['adjustments','differenceForWeek','cashChange'].includes(key)}));
  const details=(key,label,value)=>{
    const metric=key==='expense'?'settledExpense':key;
    return h('button',{type:'button',class:'ng-week-term','aria-haspopup':'dialog',
      'data-week-value':metric,'data-entry-anchor':key,onclick:()=>key==='income'?recordWeeklyIncome(report):recordWeeklyExpense(report)},
    h('span',{class:'ng-week-amount-label'},tr(label),icon('Plus')),
    number(metric,value),
    key==='expense'?h('small',{class:'ng-week-expense-basis',hidden:figures.observed===null&&!discrepancy},
      tr(figures.observed===null?'Settled total':'Implied total')):null);
  };
  const equation=h('div',{class:'ng-week-equation'},details('income','Income',income),h('b',{'aria-hidden':'true'},'−'),
    details('expense','Expense',settledExpense),h('b',{'aria-hidden':'true'},'='),
    h('div',{class:'ng-week-term ng-week-net','data-week-value':'differenceForWeek','data-negative':String(differenceForWeek<0)},
      h('span',{class:'ng-week-amount-label'},tr('Weekly difference')),number('differenceForWeek',differenceForWeek)));
  const comparison=h('div',{},settlementComparison(figures,Boolean(confirmed&&!observation)));
  const variance=h('small',{class:'ng-week-variance'});
  const earlier=ledger.settings.weekly_observation_history?.[week]??[];
  const reconciliation=h('details',{class:'ng-week-bridge'},h('summary',{},
    h('span',{},icon('ChevronDown'),tr('Reconciliation')),variance),comparison,
    report.changed?h('p',{class:'ng-caption'},tr('Current recorded expenses')+' · ',weeklyMoney(report.expense),
      ' · '+tr('Current income')+' · ',weeklyMoney(report.income)):null,
    earlier.length?h('section',{class:'ng-week-movements'},h('h3',{},tr('Earlier savings observations')),
      ...earlier.map(row=>h('div',{class:'ng-week-bridge-row'},h('time',{datetime:row.as_of},compactDate(row.as_of)),
        weeklyMoney(row.amount)))):null,
    report.rows.adjustments.length||report.rows.neutral.length?h('div',{class:'ng-week-movements'},
      h('h3',{},tr(report.changed?'Current cash movements':'Other cash movements')),
      ...[...report.rows.adjustments,...report.rows.neutral].map(entry=>h('div',{class:'ng-week-bridge-row'},
        h('span',{},entry.record.data.description),entry.kind==='savings'||entry.kind==='transfer'?
          h('small',{},tr('Internal movement')):weeklyMoney(entry.cents,{signed:true})))):null);
  const detail=settlementDetail?weeklyTransactionList(weeklySettlement(ledger,week,{asOf:end}),settlementDetail):null;
  const status=h('small',{class:'ng-week-state'});
  const note=h('p',{class:'ng-observation-note','aria-live':'polite'});
  const original=observation?.amount??confirmed?.closing??null;
  const input=h('input',{name:'observed-savings',type:'text',inputmode:'decimal',autocomplete:'off',
    'aria-label':tr('This week’s savings in Hong Kong dollars'),'aria-describedby':'ng-observation-note',
    value:savingsDrafts.get(week)??(original===null?'':savingsDigits(original))});
  note.id='ng-observation-note';
  const submit=h('button',{type:'submit',class:'ng-button primary ng-action-control ng-observation-save','aria-label':tr('Save savings observation'),
    title:tr('Save savings observation'),disabled:true},icon('Check'),h('span',{},tr('Save')));
  let displayed=figures,edited=savingsDrafts.has(week);
  const amountFromInput=()=>savingsCents(input.value);
  const present=(next,observed,isDraft)=>{
    animateSettlement(flow,edited?displayed:null,next);
    displayed=next;
    input.placeholder=next.closing===null?tr('Enter savings'):savingsDigits(next.closing);
    status.textContent=tr(observed?'Provisional observation':confirmed&&!isDraft?'Confirmed Sunday closing':'Calculated estimate');
    const basis=equation.querySelector('.ng-week-expense-basis');
    basis.hidden=next.observed===null&&!next.discrepancy;
    basis.textContent=tr(next.observed!==null?'Implied total':'Settled total');
    variance.replaceChildren(...(next.discrepancy&&next.implied>=0?[weeklyMoney(next.discrepancy,{unit:false,signed:true}),' '+tr('unmatched')]:[]));
    comparison.replaceChildren(settlementComparison(next,Boolean(confirmed&&!observed&&!isDraft)));
    const value=amountFromInput(),invalid=edited&&value===undefined;
    if(invalid)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');
    note.textContent=tr(invalid?'Enter an amount with up to two decimal places.':
      next.implied<0?'Savings exceed the recorded inflows. Review the unexplained difference.':
      observed?(isDraft?'Save this observation':tr('Observed on')+' '+compactDate(observation.as_of)):!confirmed&&!edited?'Enter actual savings to infer expenses.':'');
    const sameObservation=value===original&&(!observation||observation.as_of===observationDay(end));
    submit.disabled=invalid||!edited||sameObservation||value===null&&!observation;
  };
  const savings=h('form',{class:'ng-week-balance ng-week-closing',onsubmit:async event=>{
    event.preventDefault();
    if(submit.disabled)return;
    const value=amountFromInput(),revision=ledger.revision;
    if(value===undefined)return;
    submit.disabled=true;
    await run(async()=>{
      const next=clone(ledger),observations=next.settings.weekly_observations??={};
      if(value===null)delete observations[week];
      else {
        const date=observationDay(end);
        if(observation?.as_of!==date)retainWeeklyObservation(next.settings,week,observation);
        observations[week]={amount:value,as_of:date};
      }
      const draft=savingsDrafts.get(week);savingsDrafts.delete(week);
      try {await save(next,value===null?'Clear savings observation':'Save savings observation',revision,{previousWeek:displayed});}
      catch(error){savingsDrafts.set(week,draft);throw error;}
      showUndo(revision,value===null?'Savings observation cleared.':'Savings observation saved.');
      content.querySelector('[name="observed-savings"]')?.focus({preventScroll:true});
    });
    if(submit.isConnected)submit.disabled=false;
  }},
  h('div',{class:'ng-observation-head'},h('label',{for:'ng-actual-savings'},tr('This week’s savings')),status),
  h('div',{class:'ng-observation-entry'},input,submit),note);
  input.id='ng-actual-savings';
  input.addEventListener('input',()=>{
    edited=true;
    savingsDrafts.set(week,input.value);
    const value=amountFromInput();
    const next=value===undefined?displayed:weeklySettlement(ledger,week,{observed:value,entered:null,preview:true});
    present(next,value!==null&&value!==undefined,true);
  });
  const flow=h('div',{class:'ng-week-flow'},
    h('div',{class:'ng-week-balance ng-week-opening'},
      h('div',{},h('span',{},tr(preceding?'Last week’s closing savings':'Starting savings')),
        h('small',{},'HKD · '+tr(preceding?'Previous confirmed settlement':report.openingPoint?.source==='IMPORTED'?
          'Imported historical record':'Initial balance'),report.openingPoint&&!preceding?' · '+compactDate(report.from):null)),
      h('strong',{'data-week-value':'opening','data-negative':String(opening<0)},number('opening',opening))),
    equation,h('div',{class:'ng-week-track','aria-hidden':'true'},h('i',{'data-side':'negative'}),h('i',{'data-side':'positive'})),
    adjustments||adjustments===null?h('div',{class:'ng-week-other','data-week-value':'adjustments','data-negative':String(adjustments<0)},
      tr('Other cash movements'),' ',number('adjustments',adjustments),
      h('small',{},' · '+tr('Opening-to-closing change')+' ',number('cashChange',difference(figures.closing,figures.opening)))):null,savings);
  present(figures,edited?amountFromInput()!=null:Boolean(observation),edited);
  return h('section',{class:'ng-weekly','aria-labelledby':'ng-weekly-title','data-week-of':week},
    h('header',{class:'ng-week-heading'},
      h('h2',{id:'ng-weekly-title',tabindex:'-1'},tr('Weekly settlement')),
      h('div',{class:'ng-week-toolbar'},strip,actionButton('Settlement history','History',openSettlementHistory,{only:true}))),
    opening===null?h('div',{class:'ng-week-first'},
      h('h3',{},tr('Start with your savings')),
      h('p',{class:'ng-caption'},tr('Enter a known balance and its effective date to start your weekly calculation.')),
      h('div',{class:'ng-actions'},actionButton('Start with my savings','Wallet',()=>openOpening(week),{kind:'primary'}),
        actionButton('Add past weeks','CalendarDays',openSettlementHistory),
        actionButton('Restore Gen 1 data','import',chooseLegacyBackup)),
      h('div',{class:'ng-actions'},actionButton('New income','income',()=>recordWeeklyIncome(report)),
        actionButton('New expense','expense',()=>recordWeeklyExpense(report))),detail):flow,
    report.changed?h('p',{class:'ng-week-changed',role:'status'},icon('CircleAlert'),tr('Records changed since confirmation.')):null,
    opening===null?null:h('div',{class:'ng-week-actions'},actionButton(confirmed?'Review settlement':end>today()?'Settlement details':'Settle week',
      'CheckCheck',()=>openSettlementEditor(week),{kind:confirmed?'secondary':'primary'}),
      preceding?actionButton('Review previous settlement','Pencil',()=>openSettlementEditor(calendarDay(week,-7)),{only:true}):
        confirmed?null:actionButton('Edit opening savings','Pencil',()=>openOpening(week),{only:true}),reconciliation),
    opening===null?null:detail);
}
function openOpening(week) {
  const initial=weeklySettlement(ledger,week);
  const legacy=ledger.legacy?JSON.parse(ledger.legacy.raw):null;
  const imported=cents(legacy?.INITIAL_AMOUNT);
  transferDialog(tr('Opening savings'),(modal,close)=>{
    const figure=h('input',{name:'opening_amount',type:'text',inputmode:'decimal',required:true,
      value:initial.opening===null?'':savingsDigits(initial.opening)});
    const date=h('input',{name:'effective_date',type:'date',max:today(),required:true,value:initial.openingPoint?.as_of??week});
    let origin=initial.openingPoint?.source??'INITIAL';
    figure.addEventListener('input',()=>{origin='INITIAL';});
    const panel=h('form',{class:'ng-entry-form'},entryField('Known savings (HKD)',figure),entryField('Effective date',date),
      h('p',{class:'ng-caption'},tr('This sets your starting savings on that date. It does not add income.')),
      imported===null?null:button(tr('Use imported starting amount'),()=>{
        figure.value=savingsDigits(imported);origin='IMPORTED';figure.focus();
      }));
    entrySubmit(panel,modal,close,'Save opening savings',async current=>{
      const value=savingsCents(figure.value),selected=weekOf(date.value);
      if(!Number.isSafeInteger(value)||date.value>today())throw Error('Enter a valid starting amount and effective date.');
      const selectedReport=weeklySettlement(current,selected);
      if(selectedReport.preceding)throw Error('This week starts from a previous confirmed settlement. Review that settlement first.');
      if(selectedReport.confirmed)throw Error('Review the confirmed settlement to correct its opening.');
      const next=clone(current);
      (next.settings.weekly_openings??={})[selected]={amount:value,as_of:date.value,source:origin};
      settlementWeek=selected;
      return {next,reason:'Set opening savings '+selected,message:'Opening savings saved.'};
    },'opening');
    modal.append(panel);
  },{quick:true});
}
function savingsDigits(value) {
  return new Intl.NumberFormat('en-HK',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
}
function savingsCents(value) {
  const text=value.trim();
  if(text==='')return null;
  if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?$/.test(text))return undefined;
  const cents=Math.round(Number(text.replaceAll(',',''))*100);
  return Number.isSafeInteger(cents)?cents:undefined;
}
function weeklyWithDraft(week) {
  const value=savingsDrafts.get(week);
  const observed=value===undefined?undefined:savingsCents(value);
  return weeklySettlement(ledger,week,observed===undefined?{}:{observed,entered:null,preview:true});
}
function settlementComparison(figures,confirmed=false) {
  const {expense,implied,entered,discrepancy,calculated,adjustments}=figures;
  const row=(label,value,signed=false)=>h('div',{},h('dt',{},tr(label)),h('dd',{},weeklyMoney(value,{signed})));
  return h('div',{class:'ng-settlement-review'},
    h('dl',{},row('Recorded expenses',expense),
      implied===null?null:row('Implied expenses',implied),entered===null?null:row('Entered weekly expense',entered),
      discrepancy?row(confirmed?'Confirmed expense adjustment':'Expense adjustment',discrepancy,true):null,
      adjustments?row('Other cash movements',adjustments,true):null,
      discrepancy?row('Closing from records',calculated):null),
    discrepancy?h('p',{class:'ng-caption'},tr('The expense difference is still unmatched to transactions.')):null);
}
function openSettlementHistory() {
  transferDialog(tr('Settlement history'),(modal,close)=>{
    modal.classList.add('ng-settlement-sheet');
    const chosen=h('input',{type:'date',name:'historical_week',max:today(),value:settlementWeek,required:true});
    modal.append(h('form',{class:'ng-entry-form',onsubmit:async event=>{
      event.preventDefault();
      if(!chosen.value||chosen.value>today())return;
      await close();chooseSettlementWeek(weekOf(chosen.value));
    }},entryField('Choose a date in the week',chosen),h('button',{type:'submit',class:'ng-button primary'},tr('Open selected week'))));
    const dates=weeklyHistory(ledger).map(row=>row.week).reverse();
    modal.append(dates.length?h('ul',{class:'ng-week-history'},...dates.map(week=>{
      const versions=ledger.settings.weekly_settlements?.[week]??[];
      const report=weeklySettlement(ledger,week);
      return h('li',{},h('button',{type:'button',class:'ng-study-row',onclick:async()=>{await close();chooseSettlementWeek(week);}},
        icon('CalendarDays'),h('span',{},h('strong',{},weekDateRange(week)),
          h('small',{},versions.length>1?versions.length+' '+tr('versions'):tr(versions.length?'Confirmed':report.observation?'Observed':'Estimate'))),
        weeklyMoney(versions.at(-1)?.closing??report.closing),icon('ChevronRight')),
        versions.length>1?h('ul',{class:'ng-week-versions'},...versions.map((row,index)=>
          h('li',{},h('details',{class:'ng-week-bridge'},h('summary',{},
            h('span',{},icon('ChevronDown'),tr(index?'Correction':'Original confirmation')),
            weeklyMoney(row.closing)),
          h('p',{class:'ng-caption'},new Intl.DateTimeFormat(ledger.settings.language==='zh-Hant'?'zh-HK':'en-HK',
            {timeZone:workZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(row.confirmed_at))),
          settlementComparison(settlementView({confirmed:row}),true))))):null);
    })):h('p',{class:'ng-caption'},tr('Confirmed weeks appear here.')));
  });
}
function openSettlementEditor(week) {
  const initial=weeklyWithDraft(week),revision=ledger.revision;
  const midweek=initial.observation&&initial.observation.as_of<initial.end?initial.observation:null;
  const value=cents=>cents===null?'':(cents/100).toFixed(2);
  transferDialog(tr(initial.confirmed?'Review weekly settlement':'Confirm weekly settlement'),(modal,close)=>{
    modal.classList.add('ng-settlement-sheet');
    const field=(name,label,initialValue,attributes={})=>h('label',{class:'ng-field'},h('span',{},tr(label)),
      h('input',{type:'number',name,step:'.01',inputmode:'decimal',value:value(initialValue),...attributes}));
    const opening=field('opening','Opening savings (HKD)',initial.opening,{readOnly:Boolean(initial.preceding)});
    const expense=field('entered','Weekly expense (HKD)',initial.entered,{min:0,placeholder:value(initial.expense)});
    const actual=field('observed','Actual closing savings (HKD)',midweek&&!initial.preview?null:initial.observed);
    let mode=initial.observed===null?'expense':'balance';
    const options=segments('settlement-mode','Settlement method',[['expense','Weekly expense'],['balance','Closing savings']],mode,key=>{
      mode=key;refresh();
    });
    const summary=h('div',{class:'ng-settlement-preview'}),error=h('p',{role:'alert',class:'ng-entry-error'});
    const note=h('textarea',{name:'settlement_note',rows:2,maxlength:2000},initial.confirmed?.note??'');
    const dependencies=h('div',{class:'ng-week-dependent','aria-live':'polite'});
    const hint=h('p',{class:'ng-caption ng-settlement-hint'},tr('Leave weekly expense blank to use recorded expenses.'));
    const submit=h('button',{type:'submit',class:'ng-button primary'},tr(initial.confirmed?'Confirm correction':'Confirm settlement'));
    const read=()=>{
      const parse=control=>control.value===''?null:Math.round(Number(control.value)*100);
      return weeklySettlement(ledger,week,{opening:parse(opening.lastElementChild),
        entered:mode==='expense'?parse(expense.lastElementChild):null,observed:mode==='balance'?parse(actual.lastElementChild):null});
    };
    const openingOnly=!initial.preceding&&!initial.confirmed?button(tr('Save opening only'),async()=>{
      if(openingOnly.disabled)return;
      openingOnly.disabled=true;
      try {
        const next=clone(ledger);
        const openings=next.settings.weekly_openings??={};
        openings[week]=initial.openingPoint?{...initial.openingPoint,amount:read().opening}:read().opening;
        await save(next,'Set opening savings '+week,revision);
        await close();
        showUndo(revision,'Opening savings saved.');
      } catch(problem){error.textContent=tr(problem.message);refresh();}
    }):null;
    const refresh=()=>{
      const report=read();
      expense.hidden=expense.lastElementChild.disabled=mode!=='expense';
      actual.hidden=actual.lastElementChild.disabled=mode!=='balance';
      hint.hidden=mode!=='expense';
      const missingActual=mode==='balance'&&report.observed===null;
      closingResult.replaceChildren(weeklyMoney(missingActual?null:report.closing));
      detail.replaceChildren(settlementComparison(report));
      notice.replaceChildren(...(report.discrepancy?[weeklyMoney(report.discrepancy,{signed:true}),' '+tr('unmatched')]:[]));
      alert.textContent=report.implied!==null&&report.implied<0?tr('Negative implied expenses. Check receipts and other cash movements.'):'';
      const impacts=initial.confirmed?dependentSettlements(ledger,week,report.closing):[];
      dependencies.replaceChildren(...(impacts.length?[h('p',{class:'ng-caption'},
        tr('Later confirmed weeks stay saved and will need review. These are the revised closing amounts.')),
      h('ul',{},...impacts.map(row=>h('li',{},compactDate(calendarDay(row.week,6))+' · ',
        weeklyMoney(row.before),' → ',weeklyMoney(row.after))))]:[]));
      submit.disabled=report.end>today()||report.calculated===null||report.closing===null||missingActual||report.implied!==null&&report.implied<0;
      if(openingOnly)openingOnly.disabled=!Number.isSafeInteger(report.opening)||report.observed!==null||report.entered!==null;
    };
    const closingResult=h('strong',{}),alert=h('p',{class:'ng-entry-error'});
    const detail=h('div',{}),notice=h('small',{});
    summary.append(h('div',{class:'ng-settlement-total','aria-live':'polite'},h('span',{},tr('This week’s closing savings')),closingResult),alert,
      h('details',{class:'ng-week-bridge'},h('summary',{},h('span',{},icon('ChevronDown'),tr('Reconciliation')),notice),detail));
    const form=h('form',{oninput:refresh,onsubmit:async event=>{
      event.preventDefault();
      if(submit.disabled)return;
      submit.disabled=true;
      try {
        if(ledger.revision!==revision)throw Error('Records changed. Open the settlement again to review the latest figures.');
        const version=settlementVersion(read(),new Date().toISOString(),note.value.trim());
        const next=clone(ledger);
        const history=next.settings.weekly_settlements??={};
        (history[week]??=[]).push(version);
        retainWeeklyObservation(next.settings,week,midweek);
        if(next.settings.weekly_observations)delete next.settings.weekly_observations[week];
        const draft=savingsDrafts.get(week);savingsDrafts.delete(week);
        try {await save(next,(initial.confirmed?'Correct':'Confirm')+' weekly settlement '+week,revision);}
        catch(error){if(draft!==undefined)savingsDrafts.set(week,draft);throw error;}
        await close();
        showUndo(revision,'Weekly settlement saved.');
      } catch(problem){error.textContent=tr(problem.message);refresh();}
    }},h('p',{class:'ng-caption'},weekDateRange(week)+' · '+tr('Hong Kong time')),
    initial.confirmed?h('p',{class:'ng-caption'},tr('Prior confirmed closing')+' · ',weeklyMoney(initial.confirmed.closing)):null,
    midweek?h('p',{class:'ng-caption'},tr('Observed on')+' '+compactDate(midweek.as_of)+' · ',weeklyMoney(midweek.amount),
      h('span',{},' '+tr('Use the Sunday balance to confirm closing savings.'))):null,
    opening,options,expense,actual,hint,entryField('Notes (optional)',note),dependencies,
    summary,initial.end>today()?h('p',{class:'ng-caption'},tr('Confirm the weekly balance on Sunday or later.')):null,
    error,h('div',{class:'ng-actions'},submit,openingOnly));
    modal.append(form);refresh();
  });
}
function recordWeeklyIncome(report,row=null,earnings=null) {
  const title=row?'Edit income':earnings?'Record additional receipt':'New income';
  transferDialog(tr(title),(modal,close)=>{
    const general=generalIncomeForm(report,row,earnings,modal,close);
    if(row||earnings){modal.append(general);return;}
    const special=specialIncomeForm(report,modal,close);
    special.hidden=true;
    const body=h('div',{class:'ng-income-modes'},general,special);
    modal.append(segments('income-mode','Income mode',[['general','General 一般'],['special','Special 詳細']], 'general',key=>{
      const height=body.getBoundingClientRect().height;
      general.hidden=key!=='general';special.hidden=key!=='special';
      modal.classList.toggle('ng-income-detailed',key==='special');
      resizePanel(body,height);
    }),body);
  },{quick:true});
}
const entryField=(label,control)=>h('label',{class:'ng-field'},h('span',{},tr(label)),control);
function entryAmount(name,value='',required=false) {
  return h('input',{name,type:'number',min:0,step:'.01',inputmode:'decimal',placeholder:'0.00',value,required});
}
function cashReceiptOptions(selected=null) {
  return ledger.records.filter(generalReceipt).sort((a,b)=>b.data.date.localeCompare(a.data.date))
    .map(row=>h('option',{value:row.id,selected:row.id===selected},
      compactDate(row.data.date)+' · '+row.data.description+' · '+amount(Math.round(row.data.amount*100),row.data.currency)));
}
function entrySubmit(panel,modal,close,label,action,anchor='income') {
  const error=h('p',{class:'ng-entry-error',role:'alert'});
  const submit=h('button',{type:'submit',class:'ng-button primary ng-action-control'},icon('Check'),tr(label));
  panel.append(error,submit);
  panel.addEventListener('submit',async event=>{
    event.preventDefault();
    if(submit.disabled)return;
    submit.disabled=true;modal.dataset.applying='true';error.textContent='';
    try {
      const revision=ledger.revision;
      const {next,reason,message,id}=await action(ledger);
      await save(next,reason,revision);
      delete modal.dataset.applying;
      const target=content.querySelector('[data-entry-anchor="'+anchor+'"]');
      await close(target??undefined);
      showUndo(revision,message,id);
      target?.focus({preventScroll:true});
    } catch(problem) {
      error.textContent=tr(problem.message);
    } finally {
      delete modal.dataset.applying;submit.disabled=false;
    }
  });
}
function generalIncomeForm(report,row,earnings,modal,close) {
  const totals=ledger.records.filter(candidate=>generalReceipt(candidate)&&
    (candidate.data.entry_week??candidate.data.receipt_week)===report.week);
  if(!row&&!earnings&&totals.length===1)row=totals[0];
  const data=row?.data??{};
  const aggregate=!earnings&&(!row||Boolean(data.entry_week??data.receipt_week));
  const alreadyAmbiguous=!row&&!earnings&&totals.length>1;
  const supplied=data.amount??earnings?.data.amount??earnings?.data.income??'';
  const figure=entryAmount('amount',supplied,true);
  const code=data.currency??earnings?.data.currency??'HKD';
  const currency=h('select',{name:'currency'},...[...new Set(['HKD',code,...expenseCurrencies()])].map(currencyOption));
  currency.value=code;
  const description=h('input',{name:'description',value:data.description??earnings?.data.description??'',maxlength:240});
  const date=h('input',{name:'date',type:'date',max:today(),value:data.date??today(),required:true});
  const panel=h('form',{class:'ng-entry-form','data-income-pane':'general'},
    h('div',{class:'ng-amount-entry'},entryField('Amount',figure),entryField('Currency',currency)),
    aggregate?null:entryField('Description (optional)',description),
    aggregate?h('p',{class:'ng-caption'},weekEnding(report.end)):entryField('Received date',date),
    row&&aggregate?h('p',{class:'ng-caption'},tr('Saving updates the existing weekly total.')):null,
    alreadyAmbiguous?h('p',{class:'ng-warning'},tr('Multiple historical totals exist. Open History / Manage to review them.')):null);
  if(!alreadyAmbiguous)entrySubmit(panel,modal,close,row&&aggregate?'Update weekly income':'Save income',async current=>{
    const paidDate=aggregate?report.end:date.value;
    const saved={...data,kind:'INCOME',amount:Number(figure.value),currency:currency.value,date:paidDate,
      description:description.value.trim()||tr(earnings?'Tutoring income':'Income'),
      ...(aggregate?{receipt_week:report.week,...(!row||data.entry_week?
        {entry_week:report.week,entry_created_at:data.entry_created_at??new Date().toISOString()}:{})}:{}),
    };
    if(earnings){saved.work_income_id=earnings.id;saved.lesson_date=earnings.data.date;}
    if(!row)Object.assign(saved,cashEntryDefaults(saved));
    else if(paidDate!==data.date){saved.balance_id=null;saved.after_balance=false;}
    const operation=row?{op:'UPDATE',entity:'cash_event',record_id:row.id,expected_revision:row.revision,changes:saved}:
      {op:'ADD',entity:'cash_event',data:saved};
    const {next}=await prepareOperations(current,[operation]);
    return {next,reason:row?'Edit income':'Record income',message:'Income saved.',id:row?.id??next.records.at(-1).id};
  });
  if(aggregate)panel.append(h('details',{class:'ng-entry-options ng-week-bridge',open:alreadyAmbiguous},
    h('summary',{},h('span',{},icon('ChevronDown'),tr('More details'))),
    entryField('Description (optional)',description),manageWeekly('income',close,report.week)));
  else if(!row)panel.append(manageWeekly('income',close,report.week));
  return panel;
}
function specialIncomeForm(report,modal,close) {
  const students=ledger.records.filter(row=>row.entity==='student');
  const student=h('select',{name:'student_id',required:true},h('option',{value:''},tr('Choose student')),
    ...students.map(row=>h('option',{value:row.id},row.data.description)));
  const date=h('input',{name:'date',type:'date',value:report.week===weekOf(today())?today():report.end,required:true});
  const start=h('input',{name:'start_time',type:'time',required:true});
  const end=h('input',{name:'end_time',type:'time'});
  const hours=h('input',{name:'duration',type:'number',step:'any',min:'.01',max:24,inputmode:'decimal',required:true});
  const status=h('select',{name:'status'},...['CONFIRMED','PLANNED','CANCELLED'].map(value=>h('option',{value},tr(optionLabels[value]))));
  const receipt=h('select',{name:'aggregate'},h('option',{value:''},tr('Earned only')),...cashReceiptOptions());
  const note=h('textarea',{name:'note',rows:2,maxlength:2000});
  const earnings=entryAmount('income'),rate=h('span',{class:'ng-caption'}),quoteValue=h('output',{class:'ng-special-earnings'}),
    guide=h('p',{class:'ng-caption'});
  const minutes=time=>{const [h,m]=time.split(':').map(Number);return h*60+m;};
  const duration=()=>end.value&&start.value?((minutes(end.value)-minutes(start.value)+1440)%1440)/60:Number(hours.value);
  const currentStudent=()=>students.find(row=>row.id===student.value);
  const refresh=()=>{
    const chosen=currentStudent(),rateValue=chosen?.data.rate;
    hours.required=!end.value;hours.disabled=Boolean(end.value);
    if(status.value!=='CONFIRMED')receipt.value='';
    receipt.disabled=status.value!=='CONFIRMED';
    rate.textContent=Number.isFinite(rateValue)?amount(Math.round(rateValue*100),chosen.data.currency)+' / '+tr('hour'):tr('Choose student');
    const total=earnings.value!==''?Number(earnings.value):Number.isFinite(rateValue)&&duration()>0?rateValue*duration():null;
    quoteValue.textContent=total===null?'—':amount(Math.round(total*100),chosen?.data.currency??'HKD');
    guide.textContent=tr(receipt.value?'Included in this receipt.':'Record payment separately when received.');
  };
  const panel=h('form',{class:'ng-entry-form','data-income-pane':'special',oninput:refresh},
    h('div',{class:'ng-entry-fields'},entryField('Student',student),entryField('Lesson date',date)),
    h('p',{class:'ng-entry-rate'},tr('Hong Kong time'),' · ',rate),
    h('div',{class:'ng-entry-fields ng-entry-times'},entryField('Start time',start),entryField('End time',end),entryField('Duration (hours)',hours)),
    h('div',{class:'ng-special-total'},h('span',{},tr('Lesson earnings')),quoteValue),
    h('div',{class:'ng-entry-fields'},entryField('Lesson status',status),entryField('Include in General Income',receipt)),
    guide,h('details',{class:'ng-week-bridge'},h('summary',{},h('span',{},icon('ChevronDown'),tr('Notes and earnings adjustment'))),
      entryField('Manual earnings',earnings),entryField('Note',note)));
  panel.addEventListener('change',refresh);
  entrySubmit(panel,modal,close,'Save lesson',async current=>{
    const chosen=currentStudent(),length=duration();
    if(!chosen||!Number.isFinite(length)||length<=0)throw Error('Choose a student and enter the lesson end time or duration.');
    const total=earnings.value===''?(Number.isFinite(chosen.data.rate)?Math.round(chosen.data.rate*length*100)/100:null):Number(earnings.value);
    if(total===null&&status.value==='CONFIRMED')throw Error('Enter the lesson earnings or set the student rate.');
    const data={description:tr('Lesson')+' · '+chosen.data.description,student_id:chosen.id,currency:chosen.data.currency,
      date:date.value,start_time:start.value,end_time:end.value||null,duration:length,time_zone:workZone,
      status:status.value,income:total,note:note.value.trim()};
    const next=await addSpecialIncome(current,data,receipt.value);
    return {next,reason:receipt.value?'Save lesson included in General Income':'Save lesson earnings',message:'Lesson saved.'};
  });
  refresh();
  return panel;
}
function changeWorkReceipt(earning,currentReceipt=null) {
  transferDialog(tr('Link to General Income'),(modal,close)=>{
    const receipt=h('select',{name:'aggregate',required:!currentReceipt},
      h('option',{value:''},tr(currentReceipt?'Remove link':'Choose receipt')),...cashReceiptOptions(currentReceipt?.id));
    const panel=h('form',{class:'ng-entry-form'},h('p',{class:'ng-caption'},earning.data.description),entryField('General Income receipt',receipt));
    entrySubmit(panel,modal,close,'Save link',async current=>{
      let next=current;
      if(currentReceipt&&currentReceipt.id!==receipt.value)next=await setIncludedWork(next,currentReceipt.id,earning.id,false);
      if(receipt.value&&currentReceipt?.id!==receipt.value)next=await setIncludedWork(next,receipt.value,earning.id);
      return {next,reason:'Update receipt link',message:'Receipt link saved.'};
    });
    modal.append(panel);
  },{quick:true});
}
function weeklyTransactionList(report,key) {
  const income=key==='income';
  const entries=report.rows[income?'income':'expenses'].toSorted((a,b)=>b.date.localeCompare(a.date));
  const line=(label,meta,total,actions,id)=>h('li',{class:'ng-week-transaction','data-record-id':id},
    h('div',{},h('strong',{},label),h('small',{},meta)),weeklyMoney(total),
    actions.length?commandMenu(tr('Actions for')+' '+label,actions):null);
  const included=income?new Map():includedExpenseDetails(ledger,report.end);
  const details=ledger.records.filter(row=>included.has(row.id)&&row.data.date>=report.week&&row.data.date<=report.end);
  const list=h('ul',{class:'ng-week-transactions'},...entries.map(entry=>{
    const row=entry.record;
    const meta=income?(row.data.work_income_id?'Additional lesson receipt':'General Income'):
      row.data.budget_item_id?(row.data.trip_id?'Trip payment':'Vienna payment'):row.data.fixed||row.entity==='bill_payment'?'Fixed bill':row.data.type==='SPECIAL'?'Special':'General';
    const actions=row.data.budget_item_id?[actionButton('Open budget item','ChevronRight',()=>{
      const item=ledger.records.find(record=>record.id===row.data.budget_item_id);
      if(!item)return;
      const trip=budgetScope(item);
      const open=budgetDisclosures.get(trip)??new Set();
      open.add(item.data.category);budgetDisclosures.set(trip,open);
      navigate(trip?'Trips':'Budget',{trip,filterCategory:item.data.category});
      requestAnimationFrame(()=>content.querySelector('[data-record-id="'+CSS.escape(item.id)+'"] .folio-budget-open')?.focus());
    },{only:true})]:[
        actionButton('Edit','Pencil',()=>income?recordWeeklyIncome(report,row):edit(row.entity,row)),
        actionButton('Delete','Trash2',()=>remove(row),{kind:'danger'})];
    const linked=row.data.included_work_ids??[];
    const explained=sumKnown(linked.map(id=>{
      const earning=ledger.records.find(candidate=>candidate.id===id);
      return earning?convert(ledger,earning.data.income??earning.data.amount,earning.data.currency,earning.data.date):null;
    }));
    return line(row.data.description,compactDate(row.data.date)+' · '+tr(meta)+
      (linked.length?' · '+linked.length+' '+tr(linked.length===1?'included lesson':'included lessons')+' · '+tr('Explained')+' '+amount(explained,'HKD')+
        ' · '+tr('Unexplained')+' '+amount(difference(entry.cents,explained),'HKD'):''),
      income?entry.cents:entry.cents===null?null:-entry.cents,actions,row.id);
  }),...details.map(row=>line(row.data.description,compactDate(row.data.date)+' · '+tr('Included in General total'),
    convert(ledger,row.data.amount,row.data.currency,row.data.date),
    [actionButton('Edit','Pencil',()=>edit('expense',row)),actionButton('Delete','Trash2',()=>remove(row),{kind:'danger'})],row.id)));
  const addIncome=actionButton('New income','income',()=>recordWeeklyIncome(report),{kind:'primary'});
  addIncome.dataset.entryAnchor='income';
  const panel=h('section',{id:'ng-week-detail',class:'ng-week-detail',tabindex:'-1','aria-labelledby':'ng-week-detail-title'},
    h('div',{class:'ng-week-detail-heading'},h('h3',{id:'ng-week-detail-title'},tr(income?'Weekly income':'Weekly expenses')),income?addIncome:null),
    h('p',{class:'ng-week-detail-total'},tr(income?'Recorded income':'Recorded expenses'),' ',weeklyMoney(income?report.income:report.expense)),
    entries.length||details.length?list:h('p',{class:'ng-caption'},tr(income?'No receipts recorded for this week.':'No expenses recorded for this week.')));
  if(income) {
    const posted=ledger.records.filter(row=>row.entity==='income_entry'&&!row.data.period);
    const lessonIds=new Set(posted.map(row=>row.data.source_id));
    const earnings=[...posted,...ledger.records.filter(row=>row.entity==='lesson'&&row.data.status==='CONFIRMED'&&
      (!row.origin||row.origin.edited)&&!lessonIds.has(row.id))].filter(row=>row.data.date>=report.week&&row.data.date<=report.end||
        entries.some(entry=>entry.record===workReceipt(ledger,row)));
    if(earnings.length)panel.append(h('h3',{},tr('Tutoring earnings')),
      h('ul',{class:'ng-week-transactions'},...earnings.map(row=>{
        const receipt=workReceipt(ledger,row);
        const individual=Boolean(receipt?.data.work_income_id);
        const label=receipt?(individual?'Additional receipt recorded':'Included in General Income'):'Earned only';
        const actions=receipt?(individual?[]:[actionButton('Manage receipt link','Link2',()=>{
          const linked=ledger.records.find(candidate=>receipt.data.included_work_ids.includes(candidate.id)&&
            (candidate.id===row.id||candidate.id===row.data.source_id||candidate.data.source_id&&candidate.data.source_id===row.data.source_id));
          if(linked)changeWorkReceipt(linked,receipt);
        })]):[
          actionButton('Link to General Income','Link2',()=>changeWorkReceipt(row)),
          actionButton('Record additional receipt','payment',()=>recordWeeklyIncome(report,null,row)),
        ];
        return line(row.data.description,compactDate(row.data.date)+' · '+tr(label)+(receipt?' · '+receipt.data.description:''),
          convert(ledger,row.data.amount??row.data.income,row.data.currency,row.data.date),actions,row.id);
      })));
  }
  return panel;
}
function weeklyChart(end,history) {
  const chart=h('section',{class:'ng-week-savings-chart','aria-labelledby':'ng-week-chart-title'});
  const plot=h('div',{class:'ng-week-chart-body'});
  const redraw=animate=>{
    plot.replaceChildren();
    const provisional=Object.entries(ledger.settings.weekly_observations??{}).map(([week,observation])=>({
      end:calendarDay(week,6),balance:observation.amount,asOf:observation.as_of,change:null,status:'Provisional',
    })).filter(row=>row.asOf<row.end&&row.asOf<=today()&&!history.some(saved=>saved.end===row.end));
    const chartHistory=[...history,...provisional].sort((a,b)=>a.end.localeCompare(b.end));
    if(!chartHistory.length) {
      plot.append(h('p',{class:'ng-caption'},tr('Save a Sunday balance to start your history.')));
      return;
    }
    const byDate=new Map(chartHistory.map(row=>[row.end,row]));
    const latest=latestSunday();
    const currentObservation=provisional.find(row=>row.end===calendarDay(weekOf(today()),6));
    const anchor=(weeklyChartRange==='all'||end===latest)?(currentObservation?.end??latest):end;
    const limit=weeklyChartRange==='all'?chartHistory[0].end:calendarDay(anchor,-7*(Number(weeklyChartRange)-1));
    const first=chartHistory[0].end;
    const from=first>limit&&first<=anchor?first:limit;
    const shown=[];
    for(let date=from;date<=anchor;date=calendarDay(date,7)) {
      shown.push(byDate.get(date)??{end:date,balance:null,change:null,status:'Missing week'});
    }
    const max=Math.max(1,...shown.map(row=>Math.abs(row.change??0)));
    const track=h('div',{class:'ng-week-chart-track',role:'group','aria-label':tr('Examine weekly savings')});
    const scroll=h('div',{class:'ng-week-chart-scroll'},track);
    const readout=h('output',{id:'ng-week-chart-readout',class:'ng-screen-reader','aria-live':'polite'});
    const detail=h('div',{class:'ng-week-chart-detail'});
    const choices=shown.map(row=>{
      const value=row.change;
      const sign=value===null?row.status==='Baseline'?'baseline':row.asOf?'provisional':'unknown':value<0?'negative':value>0?'positive':'zero';
      const caption=compactDate(row.end,{weekday:'short',day:'numeric',month:'short',year:'numeric'});
      const status=tr(row.status==='Saved'?'Confirmed Sunday':row.status)+(row.asOf?' · '+compactDate(row.asOf):'');
      const label=caption+' · '+status+(value===null?'':' · '+weeklyMoney(value,{signed:true}).textContent);
      const bar=value===null||value===0?null:h('span',{class:'ng-week-chart-bar'});
      const marker=h('span',{class:'ng-week-chart-plot','aria-hidden':'true','data-sign':sign,
        style:'--measure:'+Math.abs(value??0)/max*100+'%'},bar);
      const control=h('button',{type:'button',class:'ng-week-chart-column','aria-label':label,
        'data-sunday':row.end,'data-status':row.status,'data-sign':sign},
        h('span',{class:'ng-week-chart-amount'},value===null?'—':weeklyMoney(value,{unit:false,signed:true})),
        marker,h('time',{datetime:row.end},compactDate(row.end)));
      track.append(control);
      if(animate&&bar&&!reduceMotion())requestAnimationFrame(()=>bar.animate([{scale:'1 0'},{scale:'1 1'}],
        {duration:300,easing:'cubic-bezier(.2,.8,.3,1)'}));
      return {key:row.end,label,control,inspect:()=>detail.replaceChildren(
        h('div',{class:'ng-week-chart-selected'},h('strong',{},caption),
          row.balance===null?h('small',{},tr('Missing week')):weeklyMoney(row.balance),
          value===null&&row.balance!==null?h('small',{},status):null,
          value===null?null:h('small',{'data-sign':sign},weeklyMoney(value,{signed:true})),
          row.end===end||row.end>latest?null:actionButton('Open Sunday','CalendarDays',()=>chooseSunday(row.end))))};
    });
    if(!choices.some(choice=>choice.key===chartSelections.get('weekly-savings')))chartSelections.set('weekly-savings',end);
    chartControls('weekly-savings',readout,choices);
    plot.append(h('span',{class:'ng-week-zero','aria-hidden':'true'},'0'),scroll,readout,detail);
    requestAnimationFrame(()=>{
      const selected=track.querySelector('[aria-pressed="true"]');
      if(selected)scroll.scrollLeft=Math.max(0,selected.offsetLeft-scroll.clientWidth/2+selected.offsetWidth/2);
    });
  };
  const range=h('select',{'aria-label':tr('History range'),onchange:event=>{weeklyChartRange=event.target.value;redraw(true);}},
    ...[['4','4 weeks'],['8','8 weeks'],['12','12 weeks'],['all','All history']].map(([key,label])=>
      h('option',{value:key,selected:weeklyChartRange===key},tr(label))));
  chart.append(h('header',{class:'ng-week-chart-head'},h('h2',{id:'ng-week-chart-title'},tr('Savings chart')),
    h('details',{class:'ng-sunday-range'},h('summary',{},tr('Range'),icon('ChevronDown')),range)),plot);
  redraw(true);
  return chart;
}
function openPrepTool(tool) {
  prepTool=tool;render();window.scrollTo({top:0,behavior:'instant'});resetChrome?.();
  content.querySelector('[data-prep-back]')?.focus({preventScroll:true});
}
function prepTransactions(host) {
  const recent=ledger.records.filter(row=>row.entity==='expense'&&!row.data.voided&&!row.data.budget_item_id&&!row.data.trip_id&&!isSnapshotSettlement(row))
    .reverse().sort((a,b)=>b.data.date.localeCompare(a.data.date)).slice(0,3);
  const activity=h('section',{class:'ng-recent-expenses'},h('h2',{},tr('Recent expenses')),
    ...(recent.length?recent.map(row=>h('div',{class:'ng-recent-row'},
      h('span',{},h('strong',{},row.data.description),h('small',{},compactDate(row.data.date)+' · '+
        tr(row.data.type==='SPECIAL'?'Special':'General'))),
      moneyText(Math.round(row.data.amount*100),row.data.currency),
      actionButton('Edit expense','Pencil',()=>edit('expense',row),{only:true}))):
      [h('p',{class:'ng-caption'},tr('Saved expenses appear here.'))]));
  host.append(activity,sectionDisclosure('expenses','Expenses and bills',child=>listView('Expenses',child),'expense'),
    sectionDisclosure('wallets','Octopus and e-wallet history',walletHistory,'funds'),
    sectionDisclosure('financial-actions','Savings, loans and balances',financialActions,'funds'));
}
function preDeparture() {
  if(prepTool){
    const back=actionButton('Back to Pre-departure','ChevronLeft',()=>openPrepTool(null));
    back.dataset.prepBack='';
    content.append(back);
    if(prepTool==='settlement')content.append(weeklySettlementPanel());
    else if(prepTool==='cash')content.append(financeDashboard());
    else if(prepTool==='transactions')prepTransactions(content);
    else content.append(weeklyTransactionList(weeklySettlement(ledger,settlementWeek,{asOf:calendarDay(settlementWeek,6)}),prepTool));
    return;
  }
  const end=selectedSunday??latestSunday();
  const history=sundayHistory(ledger.settings);
  const report=weeklySettlement(ledger,weekOf(end),{asOf:end});
  const quick=(kind,label,total,hasRecords,open)=>h('button',{class:'ng-sunday-quick',type:'button','aria-haspopup':'dialog',
    'data-entry-anchor':kind,onclick:()=>open(report)},icon(actionIcons[kind]),h('span',{},h('strong',{},tr(label)),
    hasRecords?weeklyMoney(total):h('small',{},tr('Not recorded'))),icon('Plus'));
  content.append(sundaySavingsPanel(end,history),weeklyChart(end,history),
    h('div',{class:'ng-sunday-quick-row'},quick('income','Income',report.income,report.rows.income.length,recordWeeklyIncome),
      quick('expense','Expense',report.expense,report.rows.expenses.length,recordWeeklyExpense)),
    h('div',{class:'ng-pre-stream'},
      sectionDisclosure('subsidy','Subsidy',subsidies,'subsidy',tr('Grants and receipts')),
      sectionDisclosure('income','Income management',incomePanel,'income',
        ledger.settings.timer?.running?tr('Timer running'):tr('Earnings and tutoring'))));
}
function subsidies(host) {
  const grants=ledger.records.filter(row=>row.entity==='grant');
  const receipts=ledger.records.filter(row=>row.entity==='cash_event'&&row.data.related_id&&
    grants.some(grant=>grant.id===row.data.related_id));
  const label=tr('Subsidy');
  host.append(h('div',{class:'ng-actions ng-context-actions'},
    editAction('Add subsidy','subsidy','grant',{status:'可申請'},{kind:'primary'}),
    actionButton('Export to AI','export',()=>exportBudgetToAI(subsidyScope,label),{display:'AI export'}),
    actionButton('Import from AI','import',()=>importBudgetFromAI(subsidyScope,label),{display:'AI import'})),
    h('div',{class:'ng-context-records'},...(grants.length?grants.map(row=>recordRow(row)):
      [h('p',{class:'ng-empty'},tr('Add a subsidy to track its approval and expected disbursement.'))])));
  if(receipts.length)host.append(sectionDisclosure('subsidy-receipts','Grant receipt history',
    child=>child.append(...receipts.map(row=>recordRow(row))),'history'));
}
function financialActions(host) {
  const grants=new Set(ledger.records.filter(row=>row.entity==='grant').map(row=>row.id));
  const rows=ledger.records.filter(row=>['balance','account','account_transfer','savings_deposit','loan'].includes(row.entity)||
    row.entity==='cash_event'&&row.data.kind!=='INCOME'&&!grants.has(row.data.related_id));
  host.append(h('div',{class:'ng-actions ng-context-actions'},
    editAction('Add savings','funds','savings_deposit',{direction:'IN'}),
    editAction('Reconcile opening balance','sync','balance',{scope:'EXCHANGE'}),
    editAction('Add account','funds','account'),editAction('Transfer between accounts','transfer','account_transfer'),
    editAction('Add loan','payment','loan'),editAction('Record cash movement','payment','cash_event')),
    ...rows.map(row=>recordRow(row)));
  fundingWorkspace(host);
}
function incomePanel(host) {
  const direct=ledger.records.filter(row=>row.entity==='cash_event'&&row.data.kind==='INCOME'&&!row.data.voided&&!row.data.related_id)
    .sort((a,b)=>b.data.date.localeCompare(a.data.date));
  host.append(h('div',{class:'ng-actions ng-context-actions'},
    actionButton('Record income','income',()=>recordWeeklyIncome(weeklySettlement(ledger,settlementWeek)),{kind:'primary'})),
    h('p',{class:'ng-caption'},tr('Actual income received')),
    h('dl',{class:'ng-plan-summary ng-income-totals'},...[['week','This week'],['month','This month']].map(([key,label])=>
      h('div',{},h('dt',{},tr(label)),h('dd',{},moneyText(periodMoney(ledger,key).income))))),
    sectionDisclosure('income-history','Income history',child=>{
      workAnalytics(child);
      child.append(h('h3',{},tr('Recorded income')),...(direct.length?direct.map(row=>recordRow(row)):
        [h('p',{class:'ng-empty'},tr('Direct income appears here after it is saved.'))]));
    },'history'),
    sectionDisclosure('income-students','Students and lesson records',child=>listView('Work',child,{withWorkTools:false}),'students'),
    sectionDisclosure('income-calendar','Timetable',workCalendar,'calendar'),
    sectionDisclosure('income-timer','Earnings timer',child=>child.append(timerPanel()),'timer'),
    sectionDisclosure('income-handoff','Work backup and handoff',workDataTools,'backup'));
}
function financeDashboard() {
  const panel=h('section',{class:'ng-period-dashboard','aria-label':tr('Cash movement statistics')});
  const summary=h('div',{class:'ng-period-summary'});
  const tabset=segments('finance-period','Financial period',[['week','This week'],['month','This month']],financePeriod,key=>{
    const before=periodMoney(ledger,financePeriod);
    financePeriod=key;
    draw(before);
  });
  function draw(before) {
    const report=periodMoney(ledger,financePeriod);
    const display=value=>value===null?tr('No recorded value'):amount(value);
    const totals=h('dl',{class:'ng-plan-summary'},
      ...[['Income','income'],['Expenditure net of refunds','spending'],['Net cash change','net']]
        .map(([text,key])=>h('div',{},h('dt',{},tr(text)),h('dd',{'data-period-metric':key},report[key]===null?display(null):moneyText(report[key])))));
    const highest=Math.max(1,...report.slices.flatMap(row=>[Math.abs(row.income??0),Math.abs(row.spending??0)]));
    const output=h('output',{id:'ng-finance-chart-readout',class:'ng-chart-readout',role:'status'});
    const choices=report.slices.map(slice=>{
      const label=compactDate(slice.from)+(slice.from===slice.to?'':' – '+compactDate(slice.to));
      const text=label+' · '+tr('Income')+' '+display(slice.income)+' · '+tr('Expenditure')+' '+display(slice.spending);
      const value=(key)=>h('i',{'data-kind':key,'data-known':String(slice[key]!==null),
        style:'--bar:'+Math.abs(slice[key]??0)/highest*100+'%'});
      return {key:slice.from,label:text,control:h('button',{type:'button',class:'ng-period-point','aria-label':text},
        h('span',{'aria-hidden':'true'},value('income'),value('spending')),h('small',{},compactDate(slice.from)))};
    });
    const chartKey='cash-period-'+financePeriod;
    if(choices.length&&!choices.some(choice=>choice.key===chartSelections.get(chartKey)))chartSelections.set(chartKey,choices.at(-1).key);
    chartControls(chartKey,output,choices);
    summary.replaceChildren(totals,h('div',{class:'ng-period-chart',role:'group','aria-label':tr('Income and expenditure by date')},
      ...choices.map(row=>row.control)),output,
      h('p',{class:'ng-caption'},tr('Net cash change includes recorded savings transfers, security deposits and financing movements.')));
    if(before)animateAmounts(summary,before,report);
  }
  panel.append(h('div',{class:'ng-finance-heading'},h('h2',{},tr('Cash activity')),tabset),summary,
    sectionDisclosure('trends','Spending forecast',spending,'ChartNoAxesCombined'));draw();
  return panel;
}
function showSection(route,id) {
  if(route==='Pre-departure')prepTool=null;
  secondarySections.add(id);
  navigate(route);
  requestAnimationFrame(()=>{
    const label=content.querySelector('#ng-section-'+id)?.parentElement.querySelector('summary');
    label?.focus();
  });
}
function navigate(name,context=viewState.get(name)) {
  if(!tabs.includes(name))return;
  const previous=view;
  if(name!==previous)prepTool=null;
  viewState.set(view,{query,filterEntity,filterCategory,trip:currentTrip,scroll:window.scrollY});
  view=name;query=context?.query??'';filterEntity=context?.filterEntity??'';filterCategory=context?.filterCategory??'';
  currentTrip=name==='Trips'?context?.trip??null:null;
  if(name!==previous&&history.state?.workieRoute!==name)history.pushState({...history.state,workieRoute:name,workieTrip:currentTrip},'');
  pending=null;say('');render();
  requestAnimationFrame(()=>{window.scrollTo({top:context?.scroll??0,behavior:'instant'});resetChrome?.();});
  if(name!==previous)pageHeading().focus({preventScroll:true});
  if(name!==previous&&!reduceMotion()&&!content.querySelector('.v3-reveal')) {
    const direction=tabs.indexOf(name)>tabs.indexOf(previous)?1:-1;
    content.animate([{opacity:.68,transform:'translateX('+direction*7+'px)'},{opacity:1,transform:'none'}],
      {duration:190,easing:'ease-out'});
  }
}
async function start() {
  root=h('section',{id:'nextgen-workspace','aria-label':'Workie Next Generation'});
  status=h('p',{id:'ng-status',role:'status',class:'ng-status'});
  undoAction=h('div',{class:'ng-undo-action'});
  content=h('div',{id:'ng-content'});
  content.append(h('p',{role:'status',class:'ng-caption'},tr('Opening your local records…')));
  const destination=name=>{
    const item=button(name,()=>navigate(name));
    item.replaceChildren(h('i',{'data-lucide':routeIcons[name],'aria-hidden':'true'}),h('span',{class:'ng-nav-label'},name));
    if(name==='Pre-departure')item.append(h('span',{class:'ng-nav-short','aria-hidden':'true'},'Prep'));
    item.dataset.ngView=name;item.dataset.ngLabel=name;return item;
  };
  const themeButton=button('',()=>run(async()=>{
    const dark=!document.documentElement.classList.contains('dark');
    await changeTheme(dark?'dark':'light');
  }));
  themeButton.id='ng-theme';themeButton.classList.add('ng-icon-button');
  themeButton.setAttribute('aria-label','Switch light and dark appearance');
  themeButton.setAttribute('aria-pressed',String(document.documentElement.classList.contains('dark')));
  themeButton.append(h('i',{'data-lucide':'sun','aria-hidden':'true'}));
  const currencyButton=button('',()=>run(async()=>{
    if(!ledger)return;
    const currency=ledger.settings.currency==='EUR'?'HKD':'EUR';
    if(!displayQuote(ledger,currency))throw Error('Add a dated '+currency+' exchange rate in Settings.');
    const next=clone(ledger);next.settings.currency=currency;await save(next,'Change display currency');
  }));
  currencyButton.id='ng-currency';currencyButton.classList.add('ng-icon-button');
  currencyButton.setAttribute('aria-label','Switch display currency');
  currencyButton.append(h('i',{'data-lucide':'banknote','aria-hidden':'true'}));
  const tool=(label,icon,action)=>h('button',{type:'button',class:'ng-button v3-tool','data-ng-label':label,
    'aria-label':label,onclick:()=>{if(ledger)action();}},
    h('i',{'data-lucide':icon,'aria-hidden':'true'}),h('span',{class:'ng-nav-label'},label));
  root.append(h('div',{class:'ng-masthead'},
    h('div',{class:'ng-chrome-brand'},
    h('a',{class:'folio-wordmark',href:'#',onclick:event=>{event.preventDefault();if(ledger)navigate('Home');}},'Workie',
      h('span',{'aria-hidden':'true'},'·')),h('span',{class:'ng-compact-title','aria-hidden':'true'})),
    h('div',{class:'ng-header-tools'},
      tool('Search','search',searchRecords),
      currencyButton,themeButton)),
    h('header',{class:'ng-page-header'},h('div',{class:'folio-page-heading'},h('p',{class:'folio-label folio-section-label'}),
      h('h1',{id:'ng-page-title',tabindex:'-1'},tr('Vienna exchange')))),status,
    undoAction,h('aside',{id:'ng-legacy-warning',class:'ng-warning',hidden:true},
      'Legacy records changed. Review them in Settings to keep both workspaces reconciled.',
      button(tr('Review data'),()=>navigate('Settings'))),
    h('aside',{id:'ng-migration-choice',class:'ng-warning',hidden:true},
      h('p',{},tr('Workie found records from an earlier version. Review these records or choose a Gen 1 backup. Synced records from other devices do not load automatically.')),
      actionButton('Restore Gen 1 data','import',chooseLegacyBackup)),content);
  document.querySelector('#views-root').prepend(root);
  const skip=document.querySelector('.skip-content-link');
  skip.addEventListener('click',event=>{
    if(root.hidden)return;
    event.preventDefault();
    pageHeading().focus();
  });
  const destinations=h('nav',{id:'ng-mobile-navigation','aria-label':'Workie destinations'},...tabs.map(destination));
  document.body.append(destinations);
  document.body.classList.add('ng-mounted');
  resetChrome=adaptiveChrome(document,window);
  document.addEventListener('pointerdown',event=>{
    for(const menu of document.querySelectorAll('.ng-command-menu[open]'))if(!menu.contains(event.target))menu.open=false;
  });
  window.lucide?.createIcons();
  history.replaceState({...history.state,workieRoute:view},'');
  window.addEventListener('popstate',event=>{
    const route=event.state?.workieRoute;
    if(ledger&&!root.hidden&&tabs.includes(route)&&(route!==view||route==='Trips'&&currentTrip!==(event.state.workieTrip??null))) {
      navigate(route,{...viewState.get(route),trip:event.state.workieTrip});
    }
  });
  setInterval(()=>{
    const clock=document.querySelector('#ng-timer-clock');
    const timer=ledger?.settings.timer;
    if(clock&&timer?.running) {
      clock.textContent=timerReadout(timer);
      document.querySelector('#ng-timer-earnings').textContent=timerEarnings(timer);
    }
  },1000);
  document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&ledger&&!root.hidden&&!document.querySelector('dialog[open]')) {
      event.preventDefault();searchRecords();
    }
  });
  const returnButton=button(tr('Return to NextGen'),()=>{
    window.requestBudgetClose(()=>{
      document.body.classList.remove('ng-legacy-open');
      document.body.classList.add('ng-active');root.hidden=false;returnButton.hidden=true;render();
      pageHeading().focus({preventScroll:true});
    });
  });
  returnButton.id='ng-return';returnButton.hidden=true;
  document.body.append(returnButton);
  dialog=h('dialog',{id:'ng-editor','aria-labelledby':'ng-editor-title'});form=h('form',{onsubmit:submitEditor});
  window.visualViewport?.addEventListener('resize',adjustEditorViewport);
  window.visualViewport?.addEventListener('scroll',adjustEditorViewport);
  form.addEventListener('input',event=>{
    form.dataset.dirty='true';
    event.target.removeAttribute('aria-invalid');event.target.removeAttribute('aria-errormessage');
    if(!form.querySelector('[aria-invalid=true]'))form.querySelector('#ng-form-error').textContent='';
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
  dialog.append(form);document.body.append(dialog);
  ledger=await readLedger();
  migrationRequired=!ledger&&localStorage.getItem('tutoring_data')!==null;
  window.addEventListener('storage',event=>{
    if(event.key==='tutoring_data'&&ledger&&!root.hidden&&!dialog.open) {
      if(!ledger.revision) migrationRequired=event.newValue!==null;
      render();
    }
  });
  channel?.addEventListener('message',async()=>{
    if(dialog.open) {say('Another tab changed the data. Finish or cancel your draft, then reload before saving.',true);return;}
    const saved=await readLedger();
    if(saved){ledger=saved;migrationRequired=false;render();}
  });
  if(ledger)markActive();
  ledger??=emptyLedger();
  const startButton=button(tr('Review existing records'),()=>run(async()=>{
    renderMigrationPreview(await migrationPreview(localStorage));
  }),'primary');
  startButton.id='ng-review-migration';
  root.querySelector('#ng-migration-choice').append(startButton);
  document.body.classList.add('ng-active');
  document.documentElement.classList.remove('ng-boot');
  render();
  if(needsSetup()&&!localStorage.getItem(welcomePreference))onboarding();
}
if(typeof document!=='undefined') start().catch(error=>{
  document.documentElement.classList.remove('ng-boot');
  if(status) {
    say(tr('Could not open the workspace.')+' '+tr(error.message),true);
    document.body.classList.add('ng-active');
    root.querySelectorAll('.ng-header-tools button,.ng-nav button').forEach(control=>{control.disabled=true;});
    document.querySelectorAll('#ng-mobile-navigation button,#ng-sidebar button').forEach(control=>{control.disabled=true;});
    content.replaceChildren(h('section',{class:'ng-surface ng-empty-state'},h('h2',{},tr('Local records need attention')),
      h('p',{class:'ng-caption'},tr('Retry opening the workspace or use the preserved legacy view to make a recovery copy.')),
      button(tr('Retry opening Workie'),()=>location.reload(),'primary'),
      button(tr('Open legacy workspace'),()=>openLegacy(()=>window.switchTab('settings')))));
  }
  else console.error(error);
});
