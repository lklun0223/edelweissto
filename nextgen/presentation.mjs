// The funding instrument projects the existing allocation view onto a
// cumulative financial scale. Accounting and reconciliation stay upstream.
export function fundingInstrument({h,button,chart,amount,tr,selected,onSelect,onOpenCategory,onReviewPlan}) {
  const columns=h('div',{class:'v3-chart-columns',role:'group','aria-label':tr('Funding categories')});
  const detail=h('div',{class:'v3-insight','aria-live':'polite','aria-atomic':'true'});
  const controls=[];
  let current=null;
  const known=chart.complete&&chart.total>0;
  const cashCoverage=known&&chart.rows.every(row=>row.covered!==null)?
    Math.floor(chart.rows.reduce((total,row)=>total+row.covered,0)/chart.total*100):null;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const value=(label,cents)=>h('div',{},h('dt',{},tr(label)),h('dd',{},amount(cents)));
  function inspect(row,{animate=false}={}) {
    if(current?.id===row.id)return;
    current=row;
    onSelect(row.id);
    controls.forEach((control,index)=>control.setAttribute('aria-pressed',String(chart.rows[index].id===row.id)));
    const readout=h('div',{class:'v3-insight-values'},
      h('p',{class:'v3-insight-name'},h('span',{'aria-hidden':'true'},row.label),tr(row.name),
        row.next?h('small',{},tr('Next threshold')):null,
        h('span',{class:'v3-insight-target'},tr('Plan')+' '+amount(row.target))),
      h('dl',{},value('Cash funded',row.covered),value('Approved grants',row.grant),
        value('Still needed',row.expected===null||row.target===null?null:row.target-row.expected)));
    detail.replaceChildren(readout,chart.complete
      ?button(tr('Open budget category'),()=>onOpenCategory(row.id))
      :button(tr('Review budget'),onReviewPlan));
    if(animate&&!reduced())readout.animate([{opacity:.42,transform:'translateY(3px)'},{opacity:1,transform:'none'}],
      {duration:220,easing:'cubic-bezier(.2,.84,.26,1)'});
  }
  for(const [index,row] of chart.rows.entries()) {
    const fill=field=>h('span',{class:'v3-chart-fill v3-chart-'+field,'data-allocation':row.id+'-'+field,
      'data-allocation-axis':'y',style:'transform:scaleY('+(row.target?(row[field]??0)/row.target:0)+')'});
    const control=h('button',{class:'v3-chart-category',type:'button','data-category':row.id,'aria-pressed':'false',
      'aria-label':tr(row.name)+'. '+tr('Cash funded')+' '+amount(row.covered)+'. '+tr('Plan')+' '+amount(row.target),
      onclick:()=>inspect(row,{animate:true}),
      onkeydown:event=>{
        const indexByKey={ArrowLeft:index-1,ArrowRight:index+1,ArrowUp:index-1,ArrowDown:index+1,Home:0,End:chart.rows.length-1};
        if(indexByKey[event.key]===undefined)return;
        event.preventDefault();
        const choice=Math.max(0,Math.min(controls.length-1,indexByKey[event.key]));
        controls[choice].focus();
        inspect(chart.rows[choice],{animate:true});
      }},
      h('span',{class:'v3-chart-slot','aria-hidden':'true',style:'--floor:'+row.start+'%;--height:'+row.width+'%;--rim:'+(row.start+row.width)+'%'},
        known&&row.target>0?h('span',{class:'v3-chart-block','data-known':String(row.covered!==null)},fill('expected'),fill('covered')):null,
        known&&index<chart.rows.length-1?h('span',{class:'v3-chart-link'}):null),
      h('span',{class:'v3-chart-caption','aria-hidden':'true'},h('b',{},row.label),h('span',{},tr(row.name))));
    controls.push(control);
    columns.append(control);
  }
  inspect(chart.rows.find(row=>row.id===selected)||chart.rows.find(row=>row.next)||chart.rows[0]);
  const data=h('details',{class:'v3-chart-data'},
    h('summary',{},tr('Funding data')),
    h('div',{class:'v3-chart-table'},h('table',{class:'ng-table'},
      h('caption',{},tr('Sequential budget allocation')),
      h('thead',{},h('tr',{},...['Category','Plan','Cash funded','With approved grants'].map(x=>h('th',{scope:'col'},tr(x))))),
      h('tbody',{},...chart.rows.map(row=>h('tr',{},h('th',{scope:'row'},row.label+' '+tr(row.name)),
        ...[row.target,row.covered,row.expected].map(cents=>h('td',{},amount(cents)))))))));
  return h('section',{class:'v3-instrument','aria-labelledby':'v3-instrument-title'},
    h('header',{class:'v3-instrument-head'},h('div',{},
      h('h2',{id:'v3-instrument-title'},tr('Funding waterfall'))),
      cashCoverage===null?null:h('p',{class:'v3-instrument-target'},h('span',{},tr('Covered by cash')),
        h('strong',{},cashCoverage+'%'))),
    h('div',{class:'v3-chart-legend'},...['Cash funded','Approved grants','Unfunded'].map((label,index)=>
      h('span',{},h('i',{'aria-hidden':'true','data-swatch':String(index)}),tr(label)))),
    h('div',{class:'v3-chart-plot','data-chart-known':String(known)},columns,
      !known?h('p',{class:'v3-chart-empty'},tr(chart.complete?'Add planned costs to see the waterfall.':'Review the plan and assign categories to see the waterfall.')):null),
    detail,data);
}
