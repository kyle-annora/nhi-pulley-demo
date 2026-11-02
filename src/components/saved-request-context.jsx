import React,{useEffect,useState} from 'react';
import {Button,ActionLink} from './primitives';
import {CATALOG,formatDimension} from '../domain.mjs';

const names={belt:'Belt contact',flange:'Flange & clearance',mount:'Mounting'};
const present=value=>typeof value==='string'&&value.trim();
const requirementsFor=record=>record?.requirements||record?.quoteSnapshot?.requirements||{};

function OriginalQuestion({item}){
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>setExpanded(false),[item.id,item.note]);
  return <details className="n-original-question" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary aria-label={`${item.region} · ${item.status} · ${expanded?'Hide':'Show'} saved question`}>
      <span className="n-original-question-region">{item.region}</span>
      {!expanded&&<span className="n-original-question-preview">{item.note}</span>}
      <span className="n-original-question-status">{item.status}</span>
    </summary>
    {expanded&&<div><p>{item.note}</p><p className="n-help">{item.source}.</p></div>}
  </details>;
}

// These are the customer's original words, rather than generated completeness
// checks. Reading this component never assigns work or changes a saved record.
export function OriginalQuestions({record,items,title='Related questions',limit}){
  const requirements=requirementsFor(record);
  let questions=(items||record?.reviewItems||[]).filter(item=>['explorer','revision'].includes(item.source?.kind)).map(item=>({
    id:item.id,note:item.source?.note||item.detail||'',
    region:item.source?.kind==='explorer'?(names[item.source.theme]||'3D inspection'):'Customer question',
    source:item.source?.kind==='explorer'?'Saved in the 3D inspection':'Saved with the change request',
    theme:item.source?.theme,status:item.source?.kind==='revision'?'Saved customer message':item.status||'Awaiting engineering review'
  })).filter(item=>present(item.note));
  if(!questions.length)questions=(requirements.explorerRequirements||[]).filter(input=>input.kind==='review'&&present(input.note)).map(input=>({
    id:input.id,note:input.note,region:names[input.feature]||'3D inspection',theme:input.feature,
    source:'Saved in the 3D inspection',status:'Awaiting engineering review'
  }));
  const seen=new Set();questions=questions.filter(item=>{const key=`${item.region}:${item.note}`;if(seen.has(key))return false;seen.add(key);return true;});
  if(limit)questions=[...questions].sort((a,b)=>Number(b.theme==='mount')-Number(a.theme==='mount')).slice(0,limit);
  if(!questions.length)return null;
  return <section className="n-original-questions" aria-label={title}>
    {title&&<h3>{title}</h3>}
    {questions.map(item=><OriginalQuestion key={item.id} item={item}/>)}
  </section>;
}

export function RequestAttachments({record,api}){
  const files=requirementsFor(record).attachments||[];
  return <section className="n-saved-request-files" aria-label="Request attachments"><h3>Attachments</h3>{files.length?<ul>{files.map((file,index)=><li key={`${file.name}:${index}`}><div><strong>{file.name}</strong><span>{file.sample?'Example reference · Not an engineering drawing':'Saved with this request'}</span></div><Button variant="text" size="compact" onClick={()=>api.downloadAttachment(file)} aria-label={`Download ${file.name}`}>Download</Button></li>)}</ul>:<p className="n-help">No files were included in this request.</p>}</section>;
}

export function QuoteAttachments({record,api,open=false}){
  const [expanded,setExpanded]=useState(open),files=requirementsFor(record).attachments||[];
  useEffect(()=>setExpanded(open),[open,record?.id,record?.version]);
  return <details className="n-quote-attachments" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary>Attachments · {files.length}</summary>
    {expanded&&<div><p className="n-help">{record.id} · v{record.version} · Saved request files</p><RequestAttachments record={record} api={api}/></div>}
  </details>;
}

export function SavedRequestContext({record,api,open=false,includeQuestions=true,includeAttachments=true}){
  const [expanded,setExpanded]=useState(open);
  useEffect(()=>setExpanded(open),[open,record?.id,record?.version]);
  const p=record?.product,d=requirementsFor(record);
  if(!p)return null;
  const notProvided='Not provided in this request';
  const mounting=d.mounting==='Confirm mounting dimensions'?'Marked for confirmation':d.mounting||notProvided;
  return <details className="n-saved-request-context" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary>{includeAttachments?'Request details & attachments':'Request details & questions'}</summary>
    <div className="n-saved-request-content">
      <dl className="n-saved-catalog-dimensions">{[['od','A · Outside diameter'],['flat','B · Running diameter'],['width','D · Width']].map(([key,label])=><div key={key}><dt>{label}</dt><dd>{formatDimension(p,key,'in')} <span>({formatDimension(p,key,'mm')})</span></dd></div>)}</dl>
      <dl className="n-saved-application-facts">{[
        ['Belt contact',d.belt||notProvided],['Mounting',mounting],
        ['Operating speed',d.speed?`${d.speed} RPM`:notProvided],['Radial load',d.load?`${d.load} lbf`:notProvided],
        ['Annual quantity',d.annual?`${d.annual} units`:notProvided]
      ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {d.notes&&<p className="n-saved-request-note"><strong>Customer notes</strong>{d.notes}</p>}
      {includeQuestions&&<OriginalQuestions record={record}/>}
      {includeAttachments&&<RequestAttachments record={record} api={api}/>}
      <ActionLink href={CATALOG} target="_blank" rel="noreferrer">NHI catalog · page 6</ActionLink>
      <p className="n-help n-saved-request-boundary">Saved request context · Application fit remains unconfirmed.</p>
    </div>
  </details>;
}
