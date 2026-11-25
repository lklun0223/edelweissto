import {importModules,importRegistry,schemaForPrompt} from './wtp.mjs';

const date='2026-01-04';
const money={amount:10,currency:'HKD'};
const plan={...money,category:'TRANSPORT',priority:'MEDIUM',due_date:null,confidence:'ESTIMATE'};
const samples={
  budget_item:['Campus transit',plan],trip:['Example visit',{destination:'Brno',status:'PLANNED'},'trip'],
  trip_budget_item:['Rail estimate',{...plan,trip_id:'$ref:trip'},null,['trip']],
  income_entry:['Reported income',{...money,date}],
  expense:['Confirmed expense',{...money,date,type:'SPECIAL'}],
  cash_event:['Confirmed receipt',{...money,date,kind:'INCOME'}],grant:['Potential subsidy',{...money,status:'可申請'}],
  loan:['Loan offer',money],savings_deposit:['Confirmed deposit',{...money,date}],
  balance:['Observed balance',{...money,as_of:date}],
  account:['Wallet A',{kind:'CASH',currency:'HKD'},'account'],
  account_transfer:['Confirmed transfer',{...money,date,from_account_id:'$ref:account',to_account_id:'$ref:other'},null,['account','other']],
  fixed_bill_rule:['Rent schedule',{...money,due_date:date,frequency:'MONTHLY',bill:'rent'},'bill'],
  bill_payment:['Confirmed rent payment',{...money,date,period_date:date,rule_id:'$ref:bill'},null,['fixed_bill_rule']],
  fx_quote:['Documented rate',{currency:'EUR',rate:8,date,source:'Synthetic reference'}],
  student:['Example student',{rate:10,currency:'HKD'},'student'],
  lesson:['Planned class',{student_id:'$ref:student',date,start_time:'10:00',duration:1,status:'PLANNED',currency:'HKD'},null,['student']],
  lesson_series:['Saturday class',{student_id:'$ref:student',weekday:6,start_time:'10:00',duration:1,currency:'HKD',
    effective_from:date,active:true},null,['student']],
  task:['Check itinerary',{done:false,trip_id:'$ref:trip',group:'PACKING'},null,['trip']],
  course:['Example course',{credits:3,home_approval:'PENDING',host_approval:'PENDING'}],
  housing_option:['Example residence',{...money,security_deposit:null,status:'SHORTLISTED'}],
  document:['Document metadata',{file_name:'example.pdf',media_type:'application/pdf'}],
  other:['Wallet B',{kind:'CASH',currency:'HKD'},'other'],
};
export const importScopes=Object.freeze({
  all:'All Workie data',budget:'Vienna Budget',trips:'Trips and planned costs',
  finance:'Income, expenses and funding',subsidy:'Subsidies',schedule:'Students and schedules',preparation:'Exchange preparation',
});
const scopeEntities=scope=>scope==='all'?Object.keys(importRegistry):
  scope==='subsidy'?['grant']:importModules[scope]??Object.keys(importRegistry);

function sampleBatch(entities,batch_id) {
  const operations=new Map();
  const add=key=>{
    if(operations.has(key))return;
    const [description,data,alias,dependencies=[]]=samples[key];
    for(const dependency of dependencies)add(dependency);
    operations.set(key,{op:'ADD',entity:key==='other'?'account':key,...(alias?{local_ref:alias}:{}),data:{description,...data}});
  };
  for(const entity of entities)add(entity);
  return {protocol:'workie-transfer',version:1,batch_id,operations:[...operations.values()]};
}
export function transferExample(scope='all',batchId=crypto.randomUUID()) {
  return JSON.stringify(sampleBatch(scopeEntities(scope),batchId),null,2);
}

export function importInstructions(scope='all',{tripId=null}={}) {
  const entities=scopeEntities(scope),batchId=crypto.randomUUID();
  const example=sampleBatch(entities,batchId);
  const described=[...new Set(example.operations.map(operation=>operation.entity))];
  return [
    'A. Discuss and confirm my choices before exporting. Planning scope: '+importScopes[scope]+
      '. Ask about missing required information. Never invent dates, bookings, facts, costs, income, grants, rates or payments.',
    'B. When I say "Export Workie Changes", return exactly one JSON object and no surrounding prose or Markdown. '+
      'Use workie-transfer version 1 and the supplied batch_id once. Request a new prompt for a new batch.',
    'Use ADD for confirmed new records and UPDATE for edits with the exact existing record_id and expected_revision. '+
      'Ask me to copy selected records if more context is needed. AI Import does not delete records.',
    'For a new related record, put a unique lowercase local_ref on its ADD and use "$ref:alias" in a relationship field. '+
      'For existing records use their exact IDs. These are relationship references, never update targets.',
    tripId&&scope==='trips'?'The existing trip selected in Workie has trip_id '+JSON.stringify(tripId)+
      '. Use it for costs for that trip. For a new trip use a batch-local reference.':null,
    'Use amounts in their original currency and never silently convert them. Use confidence ESTIMATE for estimates where supported. '+
      'Planned costs and grant status do not record actual payments. Only include actual cash movements explicitly confirmed by the user.',
    scope==='all'||scope==='finance'?'An unlinked General expense or weekly income total uses its Hong Kong week-ending Sunday. '+
      'Use Special for an individually dated expense, and the actual date for linked payments. Workie records creation metadata.':null,
    'Supported fields and actions\n'+schemaForPrompt(described,{ai:true}),
    'Synthetic example. Replace its sample facts; include only the records I confirm.\n'+JSON.stringify(example,null,2),
  ].filter(Boolean).join('\n\n');
}
