import React from 'react';
import {Heading,Button,ActionLink,EvidenceLabel,Notice} from '../components/primitives';
import {resolveRecordView,recordHref} from '../record-view.mjs';
import {CATALOG,FINISHES,formatDimension} from '../domain.mjs';
import {explorerEvidenceText} from '../explorer-evidence.mjs';

const themes={belt:'Belt contact',flange:'Flange & clearance',mount:'Mounting'};
const identity=(source,r)=>source==='draft'?`${r.product.id} · Working inquiry`:`${r.product.id} · ${r.id} v${r.version}`;
const sourceName=item=>item.source?.kind==='explorer'?`3D inspection · ${themes[item.source.theme]||'Saved input'}`:item.source?.kind==='revision'?'Saved change request':item.source?.kind==='commercial'?'Quote conditions':'Inquiry requirements';
function RecordLink({api,source,record,section,params={},children,...rest}){
  const href=recordHref(source,record,section,params);
  return <ActionLink href={href} onClick={e=>{e.preventDefault();api.navigate(href);}} {...rest}>{children}</ActionLink>;
}
function QuestionDetail({item,view,api}){
  const {record:r,source}=view,note=item.source?.note,detail=item.detail||'',detailWithoutNote=note?detail.replace(note,'').trim():detail;
  const original=note||detail;
  const status=item.status||'Awaiting review';
  return <article className="n-question-detail" aria-label={`Question: ${item.title}`}>
    <p className="n-eyebrow">{item.owner||'Engineering'} · {status}</p><h2>{item.title}</h2>
    <div className="n-question-original"><h3>{note?'Your saved question':'Recorded information'}</h3><p>{original}</p></div>
    {note&&detailWithoutNote&&<p className="n-help">{detailWithoutNote}</p>}
    {item.nextAction&&item.nextAction!==original&&<section className="n-question-next"><h3>Next · {item.owner||'Engineering'}</h3><p>{item.nextAction}</p></section>}
    {item.response&&item.response!==original&&!['Additional customer information is still needed.','No supplier answer recorded.','No engineering answer or approval recorded.'].includes(item.response)&&<p className="n-question-response">{item.response}</p>}
    <p className="n-question-source">{sourceName(item)}{item.legacyProjection?' · Projected from retained requirements':''}</p>
    {item.owner==='Customer'&&<div className="n-question-action">{source==='draft'?<><Button variant="secondary" onClick={()=>api.navigate('configure')}>Edit working inquiry</Button><p className="n-help">Return to inquiry review after editing. Technical unknowns may stay open.</p></>:source==='quote'?<p className="n-help">To provide information, return to current work and create a linked change request.</p>:<p className="n-help">Recorded when this RFQ was saved. Working-draft edits do not change this record.</p>}</div>}
    {item.source?.kind==='explorer'&&<p className="n-help">Illustrative Explorer context · Not manufacturer CAD or fit approval.</p>}
  </article>;
}
function Questions({view,api,params}){
  const {record:r,source,items}=view,owners=['Customer','Engineering','Sales'].filter(o=>items.some(i=>i.owner===o));
  const selected=items.find(i=>i.id===params.item),owner=owners.includes(params.owner)?params.owner:owners.includes(selected?.owner)?selected.owner:owners[0];
  const visible=items.filter(i=>i.owner===owner),active=visible.find(i=>i.id===params.item);
  const base={from:params.from||undefined,owner};
  if(!items.length)return <Notice title="No review questions recorded">This record contains no saved review questions. Application fit is not verified by viewing it.</Notice>;
  return <div className="n-question-browser" data-detail={Boolean(active)||undefined}>
    <nav className="n-question-filters" aria-label="Question owner">{owners.map(o=><RecordLink key={o} api={api} source={source} record={r} section="questions" params={{...base,owner:o}} aria-current={owner===o?'page':undefined}>{o==='Customer'?'Needed from you':o} <span>{items.filter(i=>i.owner===o).length}</span></RecordLink>)}</nav>
    <div className="n-question-layout"><nav className="n-question-index" aria-label={`${owner} questions`}><p className="n-help">{visible.length} {visible.length===1?'item':'items'} · Select one to review</p><ul>{visible.map(item=><li key={item.id}><RecordLink api={api} source={source} record={r} section="questions" params={{...base,item:item.id}} aria-label={`${item.title} · ${item.status||'Awaiting review'}`} aria-current={active?.id===item.id?'page':undefined}><strong>{item.title}</strong><span>{item.status||'Awaiting review'}</span></RecordLink></li>)}</ul></nav>
      <div className="n-question-reading">{params.item&&!selected?<Notice kind="error" title="Question unavailable">This question is not in the selected record. Choose another item from the list.</Notice>:active?<><div className="n-question-list-return"><RecordLink api={api} source={source} record={r} section="questions" params={base}>Back to {owner==='Customer'?'your items':`${owner.toLowerCase()} items`}</RecordLink></div><QuestionDetail item={active} view={view} api={api}/></>:<div className="n-question-empty"><h2>Choose a question.</h2><p>Read its original information, who needs to act and the next step.</p></div>}</div>
    </div>
  </div>;
}
function Rows({items}){return <dl className="n-reference-rows">{items.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v||'Not provided'}</dd></div>)}</dl>;}
function Reference({view,api,params}){
  const {record:r,source}=view,d=r.requirements,basis=d.selectionBasis;
  const panes=[['catalog','Catalog dimensions'],['application','Application details'],['selection','Selection basis'],['explorer','Explorer inputs']];
  const pane=panes.some(([k])=>k===params.pane)?params.pane:'catalog';
  const measurements=(d.explorerRequirements||[]).filter(input=>!view.items.some(item=>item.source?.kind==='explorer'&&(item.source.requirementId===input.id||(item.source.theme===input.feature&&item.source.note===input.note))));
  return <><nav className="n-reference-tabs" aria-label="Reference topic">{panes.map(([k,label])=><RecordLink key={k} api={api} source={source} record={r} section="specification" params={{from:params.from,pane:k}} aria-current={pane===k?'page':undefined}>{label}</RecordLink>)}</nav><article className="n-reference-document">
    {pane==='catalog'&&<><h2>{r.product.id} · {r.product.name}</h2><Rows items={[[ 'A · Outside diameter',`${formatDimension(r.product,'od','in')} / ${formatDimension(r.product,'od','mm')}`],['B · Belt-running diameter',`${formatDimension(r.product,'flat','in')} / ${formatDimension(r.product,'flat','mm')}`],['D · Belt-running width',`${formatDimension(r.product,'width','in')} / ${formatDimension(r.product,'width','mm')}`]]}/><ActionLink href={CATALOG} target="_blank" rel="noreferrer">NHI catalog · page 6</ActionLink><p className="n-help">Catalog dimensions identify the candidate. Application fit remains unverified.</p></>}
    {pane==='application'&&<><h2>Saved application details</h2><p>{d.application}</p><Rows items={[[ 'Estimated annual quantity',d.annual?`${d.annual} units`:'Unknown'],['Belt contact',d.belt],['Mounting',d.mounting],['Operating speed',d.speed?`${d.speed} RPM`:'Unknown · review needed'],['Radial load',d.load?`${d.load} lbf`:'Unknown · review needed'],['Requested finish',FINISHES[d.finish]||d.finish],['Customer notes',d.notes||'None provided']]}/></>}
    {pane==='selection'&&<><h2>Selection basis</h2>{basis?<><p>{basis.context?.purpose||'Purpose unknown'} · {basis.context?.belt||'Belt contact unknown'}</p><p>{basis.assessment?.status}</p><Rows items={(basis.assessment?.dimensions||[]).map(x=>[x.label,`Your input: ${x.input} ${x.unit} · Catalog: ${x.catalog}`])}/></>:<p>No selection comparison was saved with this record.</p>}<p className="n-help">Public catalog comparison is not a fit or tolerance approval.</p></>}
    {pane==='explorer'&&<><h2>Saved Explorer inputs</h2>{measurements.length?measurements.map(input=><section className="n-reference-input" key={input.id}><h3>{themes[input.feature]||input.feature}</h3><p>{explorerEvidenceText(input)}</p>{input.note&&<p>{input.note}</p>}</section>):<p>No additional measurements beyond the review questions are recorded.</p>}<RecordLink api={api} source={source} record={r} section="questions" params={{from:params.from,owner:'Engineering'}}>Read the saved inspection questions</RecordLink><p className="n-help">Viewed themes: {(r.interests||[]).map(k=>themes[k]||k).join(' · ')||'None recorded'}. Viewing records interest only; it does not confirm fit.</p></>}
  </article></>;
}
function Files({view,api}){
  const files=view.record.requirements.attachments||[];
  return <section className="n-reference-document" aria-label="Saved attachments"><h2>{files.length} {files.length===1?'attachment':'attachments'}</h2>{files.length?<ul className="n-record-files">{files.map((f,i)=><li key={`${f.name}-${i}`}><div><strong>{f.name}</strong><p className="n-help">{f.sample?'Example sketch · Not an engineering drawing':`${Math.ceil(f.size/1024)} KB · Local attachment`}</p></div><Button variant="secondary" onClick={()=>api.downloadAttachment(f)}>Download</Button></li>)}</ul>:<p>No attachments are saved with this record.</p>}<p className="n-help">Files belong to the displayed record. Nothing has been sent to NHI.</p></section>;
}
export function RecordWorkspace({state,api,routeParams={}}){
  const view=resolveRecordView(state,routeParams),section=['questions','specification','files'].includes(routeParams.section)?routeParams.section:'questions';
  if(view.error)return <div className="n-record-workspace"><Heading title="Record unavailable."/><Notice kind="error" title="This link needs attention">{view.error}</Notice><Button variant="secondary" onClick={()=>api.navigate('history')}>View saved records</Button></div>;
  const {record:r,source}=view,title={questions:'Technical review',specification:'Product reference',files:'Drawings & references'}[section];
  const returnLabel=source==='draft'?'Back to inquiry review':source==='rfq'?'Back to saved RFQ':routeParams.from==='quote-document'?'Back to quote document':'Back to current work';
  return <div className="n-record-workspace" data-question-detail={section==='questions'&&view.items.some(item=>item.id===routeParams.item)||undefined}><div className="n-record-return"><Button variant="text" onClick={()=>api.returnRecord(view,routeParams.from)}>{returnLabel}</Button></div><Heading eyebrow={identity(source,r)} title={title} description={section==='questions'?'Each question keeps its original context and next step.':undefined}><EvidenceLabel kind="example">Local example · {source==='draft'?'Working draft':'Saved record'}</EvidenceLabel></Heading>
    {section==='questions'?<Questions view={view} api={api} params={routeParams}/>:section==='specification'?<Reference view={view} api={api} params={routeParams}/>:<Files view={view} api={api}/>}
  </div>;
}
