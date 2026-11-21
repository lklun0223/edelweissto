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
  const html=doc.documentElement;
  const masthead=doc.querySelector('#nextgen-workspace > .ng-masthead');
  const title=doc.getElementById('ng-page-title');
  const dock=doc.getElementById('ng-mobile-navigation');
  let frame=0;
  const viewport=win.visualViewport;
  let restingWidth=0,restingHeight=0;
  function update() {
    frame=0;
    const header=masthead?.getBoundingClientRect();
    const titleBox=title?.getBoundingClientRect();
    const dockBox=dock?.getBoundingClientRect();
    const dockSize=dockBox?.height??0;
    const focused=doc.activeElement?.matches('input:not([type=checkbox]):not([type=radio]), select, textarea, [contenteditable=true]');
    if(!focused||win.innerWidth!==restingWidth) {
      restingWidth=win.innerWidth;restingHeight=win.innerHeight;
    }
    const keyboard=focused&&viewport&&viewport.scale<=1.05&&
      Math.max(restingHeight-win.innerHeight,win.innerHeight-viewport.height-viewport.offsetTop)>90;
    const obscured=viewport&&viewport.scale<=1.05&&!keyboard?
      Math.max(0,win.innerHeight-viewport.height-viewport.offsetTop):0;
    const stuck=win.scrollY>8;
    body.toggleAttribute('data-workie-keyboard',Boolean(keyboard));
    body.toggleAttribute('data-workie-stuck',stuck);
    const chromeBottom=Math.max(header?.bottom??0,win.innerWidth>=1181?dockBox?.bottom??0:0);
    body.toggleAttribute('data-workie-compact',Boolean(stuck&&titleBox&&titleBox.top<=chromeBottom));
    html.style.setProperty('--workie-header-height',(header?.height??0)+'px');
    html.style.setProperty('--workie-dock-height',dockSize+'px');
    html.style.setProperty('--workie-viewport-bottom',obscured+'px');
  }
  function queue() {
    if(!frame)frame=win.requestAnimationFrame(update);
  }
  win.addEventListener('scroll',queue,{passive:true});
  win.addEventListener('resize',queue,{passive:true});
  viewport?.addEventListener('resize',queue,{passive:true});
  viewport?.addEventListener('scroll',queue,{passive:true});
  doc.addEventListener('focusin',queue);
  doc.addEventListener('focusout',queue);
  if(typeof win.ResizeObserver==='function') {
    const observer=new win.ResizeObserver(queue);
    for(const node of [masthead,title,dock])if(node)observer.observe(node);
  }
  queue();
  return ()=>{
    body.removeAttribute('data-workie-compact');
    body.removeAttribute('data-workie-stuck');
    queue();
  };
}
