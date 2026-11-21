export const CATEGORIES=Object.freeze([
  {id:'TRANSPORT',name:'Transport',label:'行'}, {id:'HOUSING',name:'Housing',label:'住'},
  {id:'FOOD',name:'Food',label:'食'}, {id:'LEISURE',name:'Leisure',label:'樂'},
].map(Object.freeze));
export const GRANT_STATUS=Object.freeze(['可申請','已申請等待批核','已批核等待發放','已發放']);
const naturalMoney=value=>Number.isSafeInteger(value) && value>=0;
const checkedSum=(left,right)=>Number.isSafeInteger(left+right)?left+right:null;

// Inputs must be explicit, unique, already converted to the same currency and
// on the same paid-vs-unpaid basis. Never infer a category from a custom name.
export function allocateWaterfall(resources, obligations) {
  if (resources!==null && !Number.isSafeInteger(resources)) throw Error('Invalid resources');
  const seen=new Set(), unclassified=[];
  const targets=new Map(CATEGORIES.map(({id})=>[id,0]));
  for (const {id,category,cents} of obligations) {
    if(!id || seen.has(id)) throw Error('Budget item ID missing or repeated');
    seen.add(id);
    if(cents!==null && !naturalMoney(cents)) throw Error('Invalid budget amount');
    if(!targets.has(category)){unclassified.push(id);continue;}
    const running=targets.get(category);
    targets.set(category,running===null || cents===null?null:checkedSum(running,cents));
  }
  let remaining=resources===null || unclassified.length ? null : Math.max(0,resources);
  let next=null;
  const rows=CATEGORIES.map((category)=>{
    const target=targets.get(category.id);
    const covered=remaining!==null && target!==null?Math.min(remaining,target):null;
    const gap=covered===null?null:target-covered;
    if(next===null && (gap===null || gap>0)) next=category.id;
    remaining=covered===null?null:remaining-covered;
    return {...category,target,covered,gap};
  });
  return {rows,next,unclassified,remaining};
}

// Received money belongs in the reconciled available amount. Grant metadata
// may project an outstanding approved amount, but never changes present cash.
export function expectedCoverage(available, grants) {
  if (available!==null && !Number.isSafeInteger(available)) throw Error('Invalid available amount');
  let approved=0, missing=0;
  const seen=new Set();
  for(const grant of grants) {
    if(!grant.id || seen.has(grant.id) || !GRANT_STATUS.includes(grant.status)) throw Error('Invalid or repeated grant');
    seen.add(grant.id);
    if(grant.status!=='已批核等待發放') continue;
    const cents=grant.outstandingCents;
    if(cents===null) {missing++;continue;}
    if(!naturalMoney(cents)) throw Error('Invalid grant amount');
    if(approved!==null) approved=checkedSum(approved,cents);
  }
  return {available,approved,missing,
    expected:available===null || approved===null || missing ? null : checkedSum(available,approved)};
}
