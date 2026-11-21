// Protocol primitives. Product adapters must resolve identity/revision and revalidate
// this preview under the same transaction used to write records and batch history.
import {calendarDay,weekOf} from './lesson-time.mjs';
const protocol = 'workie-transfer';
const version = 1;
const maxBytes = 128 * 1024;
const maxOperations = 100;
const enumerated = (values) => ({type:'string',enum:values});
const text = {type:'string',maxLength:240};
const amount = {type:'money'};
const currency = {type:'currency'};
const date = {type:'date'};
const optionalDate = {type:'date',nullable:true,optional:true};
const reference = {type:'string',maxLength:180,nullable:true,optional:true};
const note = {type:'string',maxLength:2000,optional:true,allowEmpty:true};
const cashScope = {balance_id:reference,after_balance:{type:'boolean',optional:true},voided:{type:'boolean',optional:true},account_id:reference};
const payment = {description:text,amount,currency,date,...cashScope};
const weeklyEntry = {entry_week:optionalDate,entry_created_at:{type:'string',maxLength:24,optional:true,nullable:true}};
const budgetFields={
  description:{type:'string',maxLength:240},amount,currency,
  category:enumerated(['TRANSPORT','HOUSING','FOOD','LEISURE']),
  due_date:optionalDate,priority:enumerated(['HIGH','MEDIUM','LOW']),
  subcategory:{...text,optional:true},trip_id:reference,completed_on:optionalDate,
  frequency:{...enumerated(['ONCE','MONTHLY','DAILY']),optional:true},
  start_date:optionalDate,end_date:optionalDate,share:{type:'number',minimum:0,maximum:1,optional:true},
  participants:{type:'shares',optional:true},source:{...note},source_date:optionalDate,
  confidence:{...enumerated(['QUOTED','ESTIMATE','CONFIRMED']),optional:true},
  kind:{...enumerated(['COST','SECURITY_DEPOSIT','RESERVE']),optional:true},scenario:{...text,optional:true},note,
};
export const schema = {
  budget_item:{...budgetFields,due_date:{type:'date',nullable:true}},
  expense:{
    description:{type:'string',maxLength:240}, amount:{type:'money'}, currency:{type:'currency'},
    date:{type:'date'}, type:enumerated(['GENERAL','SPECIAL']), fixed:{type:'boolean',optional:true},
    payee:{...text,optional:true,nullable:true},
    category:{...enumerated(['TRANSPORT','HOUSING','FOOD','LEISURE']),optional:true,nullable:true},
    bill:{...enumerated(['rent','water','electricity','internet','phone','other']),nullable:true,optional:true},
    budget_item_id:reference,trip_id:reference,rule_id:reference,note,
    ...cashScope,...weeklyEntry,
  },
  savings_deposit:{...payment,direction:{...enumerated(['IN','OUT']),optional:true},account_id:reference,note},
  income_entry:{description:text,amount,currency,date,period:{type:'month',optional:true},source_id:reference,note},
  grant:{description:text,amount:{...amount,nullable:true},currency,
    status:enumerated(['可申請','已申請等待批核','已批核等待發放','已發放']),
    expected_date:optionalDate,due_date:optionalDate,source:{...note},source_date:optionalDate,note},
  loan:{description:text,amount,currency,due_date:optionalDate,
    repayment_amount:{...amount,optional:true},repayment_frequency:{...enumerated(['MONTHLY','WEEKLY','ONCE']),optional:true},note},
  cash_event:{...payment,kind:enumerated(['INCOME','REFUND','LOAN_DRAW','LOAN_REPAYMENT','INTEREST','SECURITY_PAYMENT']),
    ...weeklyEntry,
    related_id:reference,student_id:reference,work_income_id:reference,receipt_week:optionalDate,
    included_work_ids:{type:'references',optional:true},
    lesson_date:optionalDate,start_time:{type:'time',optional:true,nullable:true},end_time:{type:'time',optional:true,nullable:true},
    duration:{type:'number',minimum:0.00001,maximum:24,optional:true,nullable:true},note},
  trip:{description:text,destination:note,currency:{...currency,optional:true},start_date:optionalDate,end_date:optionalDate,
    status:{...enumerated(['PLANNED','CONFIRMED','CANCELLED']),optional:true},scenario:{...text,optional:true},note},
  trip_budget_item:{...budgetFields,trip_id:{type:'string',maxLength:180}},
  fixed_bill_rule:{description:text,amount,currency,due_date:date,
    frequency:enumerated(['MONTHLY','WEEKLY','ONCE']),bill:enumerated(['rent','water','electricity','internet','phone','other']),
    end_date:optionalDate,active:{type:'boolean',optional:true},note},
  bill_payment:{...payment,rule_id:{type:'string',maxLength:180},period_date:date,note},
  task:{description:text,due_date:optionalDate,done:{type:'boolean'},trip_id:reference,budget_item_id:reference,
    group:{...enumerated(['VISA','UNIVERSITY','COURSES','HOUSING','GRANT','INSURANCE','ARRIVAL','RETURN','PACKING','OTHER']),optional:true},
    source:{...note},source_date:optionalDate,note},
  student:{description:text,rate:amount,currency,grade:{...note},subject:{...note},
    contact:{...note},address:{...note},location:{...note},note},
  lesson:{description:text,student_id:{type:'string',maxLength:180},date:date,
    start_time:{type:'time',optional:true,nullable:true},end_time:{type:'time',optional:true,nullable:true},
    duration:{type:'number',minimum:0.00001,maximum:24,optional:true,nullable:true},
    status:enumerated(['PLANNED','CONFIRMED','CANCELLED']),income:{...amount,nullable:true,optional:true},currency,
    time_zone:{type:'timezone',optional:true},start_at:{type:'instant',nullable:true,optional:true},series_id:reference,note},
  lesson_series:{description:text,student_id:{type:'string',maxLength:180},weekday:{type:'number',integer:true,minimum:0,maximum:6},
    start_time:{type:'time'},duration:{type:'number',minimum:0.25,maximum:24},currency,
    effective_from:date,end_date:optionalDate,active:{type:'boolean'},time_zone:{type:'timezone',optional:true},
    rate_override:{...amount,optional:true,nullable:true},note},
  account:{description:text,kind:enumerated(['CASH','BANK','EWALLET']),currency,note},
  account_transfer:{description:text,amount,currency,date,
    from_account_id:{type:'string',maxLength:180},to_account_id:{type:'string',maxLength:180},note},
  fx_quote:{description:text,currency,rate:{type:'number',minimum:0.00000001,maximum:1e9},date,source:text},
  balance:{description:text,amount,currency,as_of:date,scope:{...enumerated(['EXCHANGE','ACCOUNT']),optional:true},account_id:reference},
  document:{description:text,file_name:text,media_type:text,owner_id:reference,note},
  course:{description:text,credits:{type:'number',minimum:0,maximum:120},
    home_approval:enumerated(['PENDING','APPROVED','REJECTED']),host_approval:enumerated(['PENDING','APPROVED','REJECTED']),
    due_date:optionalDate,source:{...note},note},
  housing_option:{description:text,amount:{...amount,nullable:true},currency,
    security_deposit:{...amount,nullable:true},start_date:optionalDate,end_date:optionalDate,
    status:enumerated(['SHORTLISTED','APPLIED','RESERVED','CONFIRMED','CANCELLED']),
    source:{...note},source_date:optionalDate,address:{...note},note},
};
export function validateRecord(entity,data,{asOf=null}={}) {
  if (!Object.hasOwn(schema,entity)) problem('entity','unsupported entity');
  validateFields(data,entity,entity,false,asOf);
  return data;
}
const validCurrency = new Set(Intl.supportedValuesOf('currency'));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const forbidden = new Set(['__proto__','prototype','constructor']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const problem = (path, message) => { throw new Error(`${path}: ${message}`); };
const validDate = (date) => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms=Date.parse(date+'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === date;
};

// JSON.parse accepts duplicate property names. Reject the ambiguity before
// validating the resulting object. Full syntax is already checked by JSON.parse.
function rejectDuplicateKeys(source) {
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}[\]:,]/g;
  const stack = [];
  for (const match of source.matchAll(tokens)) {
    const token = match[0], parent=stack.at(-1);
    if (token==='{' || token==='[') stack.push({keys:token==='{'?new Set():null});
    else if (token==='}' || token===']') stack.pop();
    else if (token.startsWith('"') && parent?.keys &&
      /^\s*:/.test(source.slice(match.index+token.length))) {
      const key=JSON.parse(token);
      if (forbidden.has(key) || parent.keys.has(key)) problem('$',`forbidden or repeated property at character ${match.index+1}`);
      parent.keys.add(key);
    }
  }
}

function keys(value, path, allowed, required=allowed) {
  if (!object(value)) problem(path,'must be an object');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) problem(`${path}.${key}`,'unexpected property');
  for (const key of required) if (!Object.hasOwn(value,key)) problem(`${path}.${key}`,'required property missing');
}

function validateFields(fields, entity, path, patch, asOf) {
  const rules=schema[entity], allowed=Object.keys(rules);
  keys(fields,path,allowed,patch?[]:allowed.filter(key=>!rules[key].optional));
  if (patch && Object.keys(fields).length===0) problem(path,'cannot be empty');
  for (const [key,value] of Object.entries(fields)) {
    const rule=rules[key], where=`${path}.${key}`;
    if (value===null && rule.nullable) continue;
    if (rule.type==='money') {
      if (typeof value!=='number' || value<0 || !Number.isFinite(value) ||
        !Number.isSafeInteger(Math.round(value*100)) || Math.round(value*100)/100!==value) {
        problem(where,'must be non-negative, with no more than two decimal places');
      }
    } else if (rule.type==='currency') {
      if (!validCurrency.has(value)) problem(where,'must be a supported ISO currency code');
    } else if (rule.type==='date') {
      if (!validDate(value)) problem(where,'must be a valid calendar date (YYYY-MM-DD)');
      if (['date','as_of'].includes(key) && ['expense','savings_deposit','bill_payment','cash_event','balance','account_transfer'].includes(entity) && asOf && value>asOf) {
        const week=weekOf(asOf);
        const isAggregate=entity==='expense'&&fields.type==='GENERAL'||entity==='cash_event'&&fields.kind==='INCOME';
        const period=fields.entry_week??(entity==='cash_event'?fields.receipt_week:null);
        if(!isAggregate||period!==week||value!==calendarDay(week,6))problem(where,'cannot record a future cash event');
      }
      if (key==='completed_on'&&asOf&&value>asOf) problem(where,'cannot complete an item in the future');
    } else if (rule.type==='number') {
      if(typeof value!=='number' || !Number.isFinite(value) || value<rule.minimum || value>rule.maximum ||
        rule.integer&&!Number.isInteger(value)) problem(where,'number outside supported range');
    } else if (rule.type==='time') {
      if(typeof value!=='string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) problem(where,'expected HH:mm');
    } else if (rule.type==='month') {
      if(typeof value!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) problem(where,'expected YYYY-MM');
    } else if (rule.type==='timezone') {
      try {if(typeof value!=='string') throw Error();new Intl.DateTimeFormat('en',{timeZone:value});}
      catch {problem(where,'expected a valid IANA time zone');}
    } else if (rule.type==='instant') {
      if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) ||
        !Number.isFinite(Date.parse(value))) problem(where,'expected a verified UTC instant');
    } else if (rule.type==='references') {
      if(!Array.isArray(value)||value.length>100||new Set(value).size!==value.length||
        value.some(id=>typeof id!=='string'||!id.trim()||id.length>180))problem(where,'expected up to 100 distinct record IDs');
    } else if (rule.type==='shares') {
      if(!Array.isArray(value)||value.length>50)problem(where,'expected a list of participants');
      const seen=new Set();let total=0,self=0;
      for(const [index,participant] of value.entries()) {
        keys(participant,where+'['+index+']',['name','share','self']);
        if(typeof participant.name!=='string'||!participant.name.trim()||seen.has(participant.name)||
          typeof participant.share!=='number'||!Number.isFinite(participant.share)||participant.share<0||
          participant.share>1||typeof participant.self!=='boolean') problem(where,'invalid or repeated participant');
        seen.add(participant.name);total+=participant.share;if(participant.self)self++;
      }
      if(value.length && (Math.abs(total-1)>0.000001||self!==1)) problem(where,'shares must total 100% and identify exactly one participant as you');
    } else if (typeof value!==rule.type || rule.enum && !rule.enum.includes(value) ||
      rule.maxLength && ((!rule.allowEmpty && !value.trim()) || value.length>rule.maxLength)) {
      problem(where,rule.enum?`expected ${rule.enum.join(' or ')}`:`expected ${rule.type}`);
    }
  }
}

export class TransferSyntaxError extends Error {
  constructor(source, problem, start=0, body=source) {
    super('invalid JSON');
    this.name='TransferSyntaxError';
    const position=problem.message.match(/\bposition (\d+)\b/i)?.[1];
    const location=problem.message.match(/\bline (\d+)\s+column (\d+)\b/i);
    let index=position===undefined?null:Number(position);
    if(index===null&&location) {
      const lines=body.split('\n');
      index=lines.slice(0,Number(location[1])-1).reduce((n,line)=>n+line.length+1,0)+Number(location[2])-1;
    }
    if(index===null&&/end of (json |input|data)|unterminated/i.test(problem.message))index=body.length;
    const escapes=[];
    let inString=false;
    for(let i=0;i<body.length;i++) {
      if(body[i]==='\\') {
        if(inString)i++;
        else if(body[i+1]==='[')escapes.push(i);
      } else if(body[i]==='"')inString=!inString;
    }
    const escaped=escapes.length===1?escapes[0]:null;
    if(index===null)index=escaped;
    this.index=index===null?null:Math.max(0,Math.min(source.length,start+index));
    const before=this.index===null?null:source.slice(0,this.index);
    this.line=before===null?null:before.split('\n').length;
    this.column=before===null?null:before.length-before.lastIndexOf('\n');
    this.escapedArray=escaped!==null&&index===escaped;
    if(this.escapedArray) {
      const corrected=body.slice(0,escaped)+body.slice(escaped+1);
      try {
        JSON.parse(corrected);
        this.suggestion=source.slice(0,start)+corrected+source.slice(start+body.length);
      } catch { /* Multiple syntax errors require manual editing. */ }
    }
  }
}

export function parseWtp(source, {asOf=null}={}) {
  if (typeof source!=='string' || source.length>maxBytes || new TextEncoder().encode(source).length>maxBytes) {
    problem('$',`expected JSON text of no more than ${maxBytes} bytes`);
  }
  const fence=/^([ \t\r\n]*\x60{3}(?:json)?[ \t]*\r?\n)([\s\S]*?)\r?\n[ \t]*\x60{3}[ \t\r\n]*$/i.exec(source);
  const body=fence?.[2]??source;
  const start=fence?.[1].length??0;
  let payload;
  try {payload=JSON.parse(body);} catch(error) {throw new TransferSyntaxError(source,error,start,body);}
  rejectDuplicateKeys(body);
  keys(payload,'$',['protocol','version','batch_id','operations']);
  if (payload.protocol!==protocol) problem('$.protocol',`expected ${protocol}`);
  if (payload.version!==version) problem('$.version',`expected ${version}`);
  if (typeof payload.batch_id!=='string' || !uuid.test(payload.batch_id)) problem('$.batch_id','expected a UUID');
  if (!Array.isArray(payload.operations) || !payload.operations.length || payload.operations.length>maxOperations) {
    problem('$.operations',`expected 1–${maxOperations} proposals`);
  }
  const touched=new Set();
  payload.operations.forEach((operation,i)=>{
    const path=`$.operations[${i}]`;
    if (!object(operation) || !['ADD','UPDATE','DELETE'].includes(operation.op)) problem(`${path}.op`,'expected ADD, UPDATE or DELETE');
    if (!Object.hasOwn(schema,operation.entity)) problem(`${path}.entity`,'unsupported entity');
    const base=['op','entity'];
    if(operation.op==='ADD') {
      keys(operation,path,[...base,'data']);
      validateFields(operation.data,operation.entity,path+'.data',false,asOf);
      return;
    }
    keys(operation,path,[...base,'record_id','expected_revision',...(operation.op==='UPDATE'?['changes']:[])]);
    if (typeof operation.record_id!=='string' || !operation.record_id.trim() || operation.record_id.length>180) {
      problem(path+'.record_id','expected the exact ID from Workie');
    }
    if (!Number.isSafeInteger(operation.expected_revision) || operation.expected_revision<1) {
      problem(path+'.expected_revision','expected the positive revision from Workie');
    }
    const target=JSON.stringify([operation.entity,operation.record_id]);
    if (touched.has(target)) problem(path+'.record_id','more than one proposal targets this record');
    touched.add(target);
    if (operation.op==='UPDATE') validateFields(operation.changes,operation.entity,path+'.changes',true,asOf);
  });
  return {...payload,batch_id:payload.batch_id.toLowerCase()};
}

export async function batchHash(batch) {
  const stable = value => Array.isArray(value) ? value.map(stable) : object(value) ?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
  const binary=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(batch))));
  return Array.from(new Uint8Array(binary),byte=>byte.toString(16).padStart(2,'0')).join('');
}

// A pure, all-or-nothing preview. Neither the supplied record map nor any persistent
// state is mutated. Completion of preview is not authorization to commit.
export function previewWtp(batch, lookup) {
  return batch.operations.map((operation,i)=>{
    const {op,entity,record_id,expected_revision,data,changes}=operation;
    if (op==='ADD') return {op,entity,before:null,after:structuredClone(data)};
    const stored=lookup(entity,record_id);
    if (!stored) problem(`$.operations[${i}].record_id`,'record was not found');
    if (stored.revision!==expected_revision) problem(`$.operations[${i}].expected_revision`,'record changed since it was copied');
    const before=structuredClone(stored.data);
    return {op,entity,record_id,before,after:op==='DELETE'?null:{...before,...structuredClone(changes)}};
  });
}

export const schemaForPrompt = (entities=Object.keys(schema)) => JSON.stringify({protocol,version,maxOperations,
  value_rules:{
    currency:'ISO 4217 uppercase currency code. Amounts preserve their original currency.',
    currencies:[...validCurrency],
    money:'Non-negative finite JSON number, maximum two decimal places and a safe integer number of cents.',
    date:'Valid YYYY-MM-DD calendar date. Null is permitted only for fields marked nullable.',
    references:'Copy existing immutable IDs from selected record context. Do not invent a reference.',
    income_entry:'Reporting income summary. Actual exchange cash is reconciled separately through balances, savings deposits and cash events.',
    fx_quote:'rate is HKD per one unit of currency, with a recorded date and source.',
    shares:'participants is an array of {name, share, self}. share ranges from 0 to 1, totals 1, and exactly one participant has self:true.',
  },
  operations:{ADD:['entity','data'],UPDATE:['entity','record_id','expected_revision','changes'],
    DELETE:['entity','record_id','expected_revision']},
  fields:Object.fromEntries(entities.map(key=>[key,schema[key]]))},null,2);
