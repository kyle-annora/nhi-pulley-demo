import React from 'react';

const themeNames={belt:'Belt contact',flange:'Flange & diameter',mount:'Mounting area'};
const ownerNames={Customer:'Customer · information to provide',Sales:'Sales · commercial follow-up',Engineering:'Engineering · technical review'};
function sourceLabel(item){
  const source=item.source||{};
  if(source.kind==='explorer')return `From 3D inspection · ${themeNames[source.theme]||'Saved customer input'}`;
  if(source.kind==='revision')return 'From your change request';
  if(source.kind==='commercial')return 'From the quote';
  return 'From the inquiry';
}
function ReviewItem({item,grouped}){
  const note=item.source?.note,detail=item.detail||item.nextAction||'';
  return <li className="n-review-item">
    <div className="n-review-item-heading"><strong>{item.title}</strong><span className="n-review-item-status">{item.status||'Awaiting review'}</span></div>
    <p>{detail}</p>
    {note&&!detail.includes(note)&&<p className="n-review-original"><span>Your question:</span> {note}</p>}
    {grouped&&item.nextAction&&item.nextAction!==detail&&<p className="n-review-action"><span>Action:</span> {item.nextAction}</p>}
    {['explorer','revision'].includes(item.source?.kind)&&item.response&&item.response!==detail&&<p className="n-review-response"><span>Response:</span> {item.response}</p>}
    <p className="n-review-item-source">{sourceLabel(item)}{!grouped&&` · Next: ${item.owner||'Engineering'}`}</p>
  </li>;
}
export function ReviewItemsList({items=[],title='Questions to resolve',compact=false,groupByOwner=false,description}){
  if(!items.length)return null;
  const groups=groupByOwner?['Customer','Sales','Engineering'].map(owner=>({owner,items:items.filter(item=>item.owner===owner)})).filter(group=>group.items.length):[{owner:null,items}];
  const legacy=items.some(item=>item.legacyProjection);
  return <section className={`n-review-items${compact?' n-review-items-compact':''}`} aria-label={typeof title==='string'?title:'Questions to resolve'}>
    {title&&<div className="n-section-heading"><h3>{title}</h3><span className="n-review-count">{items.length} open</span></div>}
    {description&&<p className="n-review-description">{description}</p>}
    {legacy&&<p className="n-help n-review-legacy">Shown from retained requirements. Earlier records are unchanged; this does not add a supplier response.</p>}
    {groups.map(group=><div className="n-review-owner" key={group.owner||'all'}>
      {group.owner&&<h4>{ownerNames[group.owner]}</h4>}
      <ul>{group.items.map((item,i)=><ReviewItem key={item.id||`${item.title}-${i}`} item={item} grouped={Boolean(group.owner)}/>)}</ul>
    </div>)}
  </section>;
}
