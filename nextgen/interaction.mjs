export const actionIcons=Object.freeze({
  budget:'Plus',payment:'Banknote',subsidy:'BadgePercent',expense:'ReceiptText',
  income:'CircleArrowDown',trip:'MapPinPlus',export:'Share2',import:'ClipboardPaste',
  history:'History',calendar:'CalendarDays',students:'UsersRound',timer:'Timer',
  appearance:'Palette',dates:'CalendarRange',backup:'ArchiveRestore',rates:'ArrowLeftRight',
  sync:'RefreshCw',migration:'Database',transfer:'ArrowDownUp',funds:'Wallet',
});

export const permitsMotion=()=>!matchMedia('(prefers-reduced-motion: reduce)').matches;
export const movementCurve='cubic-bezier(.22,.8,.25,1)';

const panelMotions=new WeakMap();
export function resizePanel(node,previousHeight) {
  if(!permitsMotion()||!node.isConnected)return;
  panelMotions.get(node)?.cancel();
  const height=node.getBoundingClientRect().height;
  if(Math.abs(previousHeight-height)<2)return;
  const animation=node.animate([{height:previousHeight+'px',overflow:'clip'},{height:height+'px',overflow:'clip'}],
    {duration:290,easing:movementCurve});
  panelMotions.set(node,animation);
  animation.finished.catch(()=>{}).finally(()=>{if(panelMotions.get(node)===animation)panelMotions.delete(node);});
}

const activeNumbers=new WeakMap();
export function tweenNumbers(node,from,to,draw) {
  const previous=activeNumbers.get(node);
  if(previous)cancelAnimationFrame(previous.frame);
  if(!permitsMotion()||!from) {
    activeNumbers.delete(node);draw(to);return;
  }
  from=previous?.values??from;
  const time=performance.now(),state={frame:0,values:from};
  const step=now=>{
    if(!node.isConnected){activeNumbers.delete(node);return;}
    const progress=Math.min(1,(now-time)/370),eased=1-(1-progress)**3;
    state.values=Object.fromEntries(Object.entries(to).map(([key,value])=>[
      key,Number.isFinite(value)&&Number.isFinite(from[key])?
        Math.round(from[key]+(value-from[key])*eased):value,
    ]));
    draw(state.values);
    if(progress<1)state.frame=requestAnimationFrame(step);
    else activeNumbers.delete(node);
  };
  activeNumbers.set(node,state);
  draw(from);
  state.frame=requestAnimationFrame(step);
}

export function adaptiveChrome(doc,win) {
  const body=doc.body;
  let previous=win.scrollY, distance=0, frame=0, compact=false;
  const viewport=win.visualViewport;
  function update() {
    frame=0;
    const position=Math.max(0,win.scrollY), delta=position-previous;
    const touchesInput=doc.activeElement?.matches('input, select, textarea, [contenteditable=true]');
    body.toggleAttribute('data-workie-keyboard',Boolean(touchesInput&&viewport&&
      win.innerHeight-viewport.height-viewport.offsetTop>110));
    if(delta)distance=(Math.sign(distance)===Math.sign(delta)?distance:0)+delta;
    previous=position;
    if(position<66||distance<-22)compact=false;
    else if(position>160&&distance>28)compact=true;
    body.toggleAttribute('data-workie-compact',compact);
  }
  function queue() {
    if(!frame)frame=win.requestAnimationFrame(update);
  }
  win.addEventListener('scroll',queue,{passive:true});
  win.addEventListener('resize',queue,{passive:true});
  viewport?.addEventListener('resize',queue,{passive:true});
  doc.addEventListener('focusin',queue);
  doc.addEventListener('focusout',queue);
  return ()=>{
    previous=win.scrollY;distance=0;compact=false;
    body.removeAttribute('data-workie-compact');
    queue();
  };
}
