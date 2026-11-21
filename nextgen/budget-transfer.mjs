import {activeBudget,financialModel,prepareBatch,today} from './ledger.mjs';
import {budgetScope,planPosition} from './product-finance.mjs';
import {parseWtp,schemaForPrompt} from './wtp.mjs';
import {prompt} from './wtp-prompt.mjs';

export function budgetScopeRecords(ledger,scope) {
  return ledger.records.filter(row=>['budget_item','trip_budget_item'].includes(row.entity)&&
    budgetScope(row)===scope&&activeBudget(ledger,row));
}

export function budgetTransferContext(ledger,scope,label) {
  const position=planPosition(financialModel(ledger),scope);
  const obligations=new Map(position.obligations.map(row=>[row.id,row]));
  const entity=scope===null?'budget_item':'trip_budget_item';
  return [prompt,schemaForPrompt(),[
    'Budget scope: '+label,
    'Return only valid Workie Transfer Protocol JSON for changes to the supplied budget.',
    'Use '+entity+' for new records. Use each exported entity, record_id and expected_revision for edits or deletes.',
    scope===null?'Do not set trip_id.':'Every new item must include trip_id '+JSON.stringify(scope)+'.',
    'Do not change scenario or assign a record to a different trip. Payment and settlement values in the context are informational.',
  ].join('\n'),JSON.stringify({as_of:today(),scope:{type:scope===null?'VIENNA':'TRIP',trip_id:scope,label},
    records:budgetScopeRecords(ledger,scope).map(row=>{
      const obligation=obligations.get(row.id);
      return {entity:row.entity,record_id:row.id,expected_revision:row.revision,data:row.data,
        settlement:{display_currency:'HKD',paid_cents:obligation?.paid??null,remaining_cents:obligation?.cents??null,
          completed_on:row.data.completed_on??null}};
    })},null,2)].join('\n\n');
}

export async function prepareScopedBudgetBatch(ledger,source,scope) {
  if(scope!==null&&!ledger.records.some(row=>row.entity==='trip'&&row.id===scope&&row.data.status!=='CANCELLED')) {
    throw Error('This trip is no longer an active transfer target.');
  }
  const prepared=await prepareBatch(ledger,source);
  const allowed=new Set(budgetScopeRecords(ledger,scope).map(row=>row.id));
  const newEntity=scope===null?'budget_item':'trip_budget_item';
  const currentScenario=scope===null?ledger.settings.scenario:ledger.records.find(row=>row.id===scope)?.data.scenario??'Base';
  for(const [index,change] of prepared.diff.entries()) {
    const fail=()=>{throw Error('$.operations['+index+']: change falls outside the selected budget.');};
    if(change.op==='ADD') {
      if(change.entity!==newEntity||budgetScope({data:change.after})!==scope||
        change.after.scenario&&change.after.scenario!==currentScenario)fail();
    } else {
      if(!allowed.has(change.record_id))fail();
      if(change.op==='UPDATE'&&(budgetScope({data:change.after})!==scope||
        (change.after.scenario??'')!==(change.before.scenario??'')))fail();
    }
  }
  return {...prepared,before:planPosition(prepared.before,scope),after:planPosition(prepared.after,scope)};
}

export const subsidyScope=Symbol('subsidies');

export function subsidyTransferContext(ledger) {
  return [prompt,schemaForPrompt(),[
    'Subsidy scope: only grant records.',
    'Use grant for new subsidies. Use each exported record_id and expected_revision for edits or deletes.',
    'Do not create or edit receipts, loans, cash events or any other records. Manage disbursements separately in Workie.',
  ].join('\n'),JSON.stringify({as_of:today(),scope:{type:'SUBSIDIES'},
    records:ledger.records.filter(row=>row.entity==='grant').map(row=>({
      entity:row.entity,record_id:row.id,expected_revision:row.revision,data:row.data,
    }))},null,2)].join('\n\n');
}

export async function prepareScopedSubsidyBatch(ledger,source) {
  const batch=parseWtp(source);
  for(const [index,operation] of batch.operations.entries()) {
    if(operation.entity!=='grant')throw Error('$.operations['+index+']: change falls outside Subsidy.');
  }
  return prepareBatch(ledger,source);
}
