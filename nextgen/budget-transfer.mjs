import {activeBudget,financialModel,prepareBatch,today} from './ledger.mjs';
import {budgetScope,planPosition} from './product-finance.mjs';
import {parseWtp,schema} from './wtp.mjs';
import {scopedTransferPrompt} from './wtp-prompt.mjs';

export class TransferContextError extends Error {
  constructor(message,destination=null) {
    super(message);this.name='TransferContextError';this.destination=destination;
  }
}
export function budgetScopeRecords(ledger,scope) {
  return ledger.records.filter(row=>['budget_item','trip_budget_item'].includes(row.entity)&&
    budgetScope(row)===scope&&activeBudget(ledger,row));
}

export function budgetTransferContext(ledger,scope,label) {
  return context(scope,label,budgetScopeRecords(ledger,scope));
}

const entityFor=scope=>scope===subsidyScope?'grant':scope===null?'budget_item':'trip_budget_item';
function fieldsFor(scope) {
  return Object.fromEntries(Object.entries(schema[entityFor(scope)]).filter(([key])=>
    !['scenario','completed_on'].includes(key)&&(key!=='trip_id'||scope!==null)));
}
function context(scope,label,rows) {
  const entity=entityFor(scope),fields=fieldsFor(scope),batchId=crypto.randomUUID();
  const records=rows.filter(row=>row.entity===entity).map(row=>({record_id:row.id,expected_revision:row.revision,
    data:Object.fromEntries(Object.entries(row.data).filter(([key])=>Object.hasOwn(fields,key)))}));
  return scopedTransferPrompt({label,entity,fields,records,batchId,example:transferExample(scope,batchId),
    tripId:entity==='trip_budget_item'?scope:null,asOf:today()});
}

export async function prepareScopedBudgetBatch(ledger,source,scope) {
  if(scope!==null&&!ledger.records.some(row=>row.entity==='trip'&&row.id===scope&&row.data.status!=='CANCELLED')) {
    throw Error('This trip is no longer an active transfer target.');
  }
  const proposal=parseWtp(source);
  if(proposal.operations.every(operation=>operation.entity==='grant')) {
    throw new TransferContextError('This proposal contains grants. Open Subsidy import to review it.','subsidy');
  }
  const allowed=new Set(budgetScopeRecords(ledger,scope).map(row=>row.id));
  const entity=entityFor(scope),fields=fieldsFor(scope);
  const currentScenario=scope===null?ledger.settings.scenario:ledger.records.find(row=>row.id===scope)?.data.scenario??'Base';
  for(const [index,operation] of proposal.operations.entries()) {
    const {op,data,changes,record_id}=operation;
    const path='$.operations['+index+']';
    if(operation.entity!==entity||op!=='ADD'&&!allowed.has(record_id)) {
      throw Error(path+'.entity: change falls outside the selected budget. Use '+entity+' and an ID from this export for edits.');
    }
    for(const key of Object.keys(data??changes??{})) {
      const field=path+(op==='ADD'?'.data.':'.changes.')+key;
      if(key==='scenario')throw Error(field+': change falls outside the selected budget. Remove scenario; this import targets only the currently selected plan.');
      if(key==='trip_id'&&(op!=='ADD'||data.trip_id!==scope)) {
        throw Error(field+': '+(scope&&op==='ADD'?'Use this trip ID: '+scope:'Leave out trip_id for this operation.'));
      }
      if(!Object.hasOwn(fields,key))throw Error(field+': Leave out '+key+' and record payments separately in Workie.');
    }
  }
  const prepared=await prepareBatch(ledger,source,{budgetPlan:currentScenario});
  return {...prepared,before:planPosition(prepared.before,scope),after:planPosition(prepared.after,scope)};
}

export const subsidyScope=Symbol('subsidies');

export function subsidyTransferContext(ledger) {
  return context(subsidyScope,'Subsidy',ledger.records);
}

export async function prepareScopedSubsidyBatch(ledger,source) {
  const batch=parseWtp(source);
  const destinations=batch.operations.map(operation=>{
    if(operation.entity!=='budget_item')return null;
    const row=operation.data??ledger.records.find(record=>record.id===operation.record_id)?.data;
    return row&&!row.trip_id&&!operation.changes?.trip_id?'vienna':null;
  });
  for(const [index,operation] of batch.operations.entries()) {
    if(operation.entity==='grant')continue;
    const onlyVienna=destinations.every(value=>value==='vienna');
    throw new TransferContextError(onlyVienna?
      'This proposal contains Vienna Budget items. Subsidy import accepts grants only.':
      '$.operations['+index+']: Subsidy import accepts grants only. Review the record type before importing.',
    onlyVienna?'vienna':null);
  }
  return prepareBatch(ledger,source);
}

export function transferExample(scope,batchId=crypto.randomUUID()) {
  const operation=scope===subsidyScope?
    {entity:'grant',data:{description:'Example grant',amount:100,currency:'HKD',status:'可申請'}}:
    {entity:scope==null?'budget_item':'trip_budget_item',
      data:{description:'Example transit ticket',amount:10,currency:'EUR',category:'TRANSPORT',priority:'MEDIUM',due_date:null,
        ...(scope==null?{}:{trip_id:scope})}};
  return JSON.stringify({protocol:'workie-transfer',version:1,batch_id:batchId,
    operations:[{op:'ADD',...operation}]},null,2);
}
