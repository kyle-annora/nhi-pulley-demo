import React,{useState,useRef,useEffect} from 'react';
import {SavedRequestContext,OriginalQuestions,QuoteAttachments} from '../components/saved-request-context';
import {activeQuote,FINISHES,money} from '../domain.mjs';
import {quoteComparison,replyFor} from '../journey.mjs';
import {resolveRecordView} from '../record-view.mjs';
import {commercialContext} from '../commercial-adapter.mjs';
import {quoteKey} from '../quote-adapter.mjs';
import {quoteFollowup} from '../quote-followup.mjs';
import {Button,ActionLink,ActionGroup,ChoiceGroup,Field,EvidenceLabel,Notice,Heading} from '../components/primitives';
import {VersionSelector,Comparison} from '../components/patterns';

const date=v=>new Date(v).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
function QuoteContext({q}) {return <dl className="n-record-meta"><div><dt>Quote</dt><dd>{q.id} · v{q.version}</dd></div><div><dt>Inquiry</dt><dd>{q.rfqId} · v{q.rfqVersion}</dd></div><div><dt>Example date</dt><dd>{date(q.createdAt)}</dd></div></dl>;}
function QuoteTotal({q}) {return <div className="n-totals"><div><span>Priced subtotal <small>USD</small></span><strong>{money(q.totals.subtotalCents)}</strong></div><div><span>Final total</span><span>{q.totals.totalCents===null?'Pending review':money(q.totals.totalCents)}</span></div><p className="n-help">Freight and tax remain unknown. Unpriced items are excluded, not treated as zero.</p></div>;}
function Aside({q,api,revision=false}) {return <aside className="n-side"><p className="n-eyebrow">{revision?'SOURCE QUOTE · PRESERVED':'CONTINUE THIS CASE'}</p><h2>{revision?q.product.id:'A change or a question?'}</h2><p>{revision?`${q.id} · v${q.version}`:'Ask for a different quantity, delivery window, finish or technical clarification.'}</p>{!revision&&<ActionGroup stack><Button icon="arrow" disabled={!api.canRevise} onClick={api.newRevision}>Request a revision</Button><Button variant="text" onClick={()=>api.navigate('rfq')}>View saved RFQ</Button></ActionGroup>}<dl className="n-side-meta"><div><dt>Quoted quantity</dt><dd>{q.requirements.quantity} units</dd></div><div><dt>Priced subtotal</dt><dd>{money(q.totals.subtotalCents)}</dd></div><div><dt>Final total</dt><dd>Pending review</dd></div></dl><Notice title="Example commercial data">No NHI offer, availability or application fit is confirmed.</Notice><p className="n-help">A revision adds a linked request. This quote's prices and terms stay unchanged.</p></aside>;}

function QuoteCurrentTask({q,api,view}){
  const action=()=>view.archived?api.openBuyerQuote(view.latest):view.pending.length?api.viewRevisions():api.navigate('next');
  const quantityOnly=view.pending.length===1&&view.pending[0].changes.length===1&&view.pending[0].changes[0].field==='quantity';
  const changeValue=(change,value)=>change.field==='finish'?(FINISHES[value]||value):change.field==='quantity'?<>{Number(value).toLocaleString('en-US')} <span>units</span></>:value;
  const title=quantityOnly?'Quantity change':view.pending.length?'Your requested changes':view.ack?'Engineering review':view.request?'Review request':view.status;
  return <section className="n-quote-current-task" aria-labelledby="quote-current-task-title" data-waiting={view.waiting||undefined}>
    <p className="n-eyebrow">{view.archived?'HISTORICAL QUOTE':view.pending.length?'CURRENT REQUEST':'CURRENT WORK'}</p>
    <h2 id="quote-current-task-title">{title}</h2>
    {view.pending.length>0?<div className="n-case-changes">{view.pending.map(r=><section className="n-case-change" key={r.id} aria-label={`Saved change ${r.id}`}>
      <p className="n-case-change-source">{r.id} · Against {r.quoteId} v{r.quoteVersion}</p>
      {r.changes.length?r.changes.map(c=><div className="n-case-change-field" data-field={c.field} key={c.field}>
        {!quantityOnly&&<h3>{{quantity:'Quantity',timing:'Delivery window',finish:'Finish'}[c.field]||c.field}</h3>}
        <dl className="n-case-change-values"><div><dt>{c.field==='quantity'?'Quoted':c.field==='timing'?'Previously requested':'Finish request'} · v{r.quoteVersion}</dt><dd>{changeValue(c,c.before)}</dd></div><div data-requested><dt>{c.field==='quantity'?'Requested':'New request'}</dt><dd>{changeValue(c,c.after)}</dd></div></dl>
      </div>):<p className="n-case-question-only">Technical question awaiting review</p>}
    </section>)}</div>:<p className="n-quote-task-explanation">{view.next}</p>}
    {view.waiting&&<div className="n-case-wait" role="status">
      <p className="n-case-wait-title">{view.status}</p>
      <p>{view.pending.length?'No action needed from you on this change right now.':view.customerGuidance}</p>
    </div>}
    {view.pending.length>0&&<p className="n-case-quote-unchanged">Quote v{q.version} remains unchanged until a revised proposal is issued.</p>}
    <div className="n-case-task-actions"><div className="n-quote-next-action"><ActionGroup><Button variant={view.waiting?'secondary':'primary'} disabled={Boolean(view.error)} onClick={action}>{view.actionLabel}</Button>{!view.waiting&&<Button variant="text" disabled={Boolean(view.error)||!api.canRevise} onClick={api.newRevision}>Request a revision</Button>}</ActionGroup></div>
      {view.waiting&&<details className="n-quote-other-actions"><summary>Other actions</summary><Button variant="text" disabled={Boolean(view.error)||!api.canRevise} onClick={api.newRevision}>Request another change</Button></details>}
    </div>
    <p className="n-help">Local example only · Nothing sent to NHI. No fit approval or order.</p>
  </section>;
}

const quoteDocumentHref=q=>`#quote-document?source=quote&id=${encodeURIComponent(q.id)}&version=${q.version}`;
function QuoteSummary({q,api,view}) {
  const exclusions=q.totals.pending||[],finishLine=q.lines.find(line=>/finish/i.test(line.label)&&!line.label.startsWith(q.product.id));
  const finishName=(FINISHES[q.requirements.finish]||q.requirements.finish).split('—')[0].trim();
  const finishOutcome=q.requirements.finish==='iron-phosphate'?'Standard iron phosphate included.':finishLine?.unitCents!=null?`${finishName}: ${money(finishLine.unitCents)} / unit allowance. Suitability still needs review.`:`${finishName}: feasibility and price still need review.`;
  return <section className="n-quote-decision" aria-label="Current quote decision">
    <div className="n-quote-work-column"><QuoteCurrentTask q={q} api={api} view={view}/>
      <aside className="n-quote-technical-context" aria-label={view.technicalLabel}><OriginalQuestions record={q} limit={1} title={view.technicalLabel.startsWith('Separate')?'Separate technical review':'Technical review'}/></aside>
    </div>
    <aside className="n-quote-basis" aria-labelledby="quote-basis-title">
      <div className="n-case-quote-heading"><h2 id="quote-basis-title">Current quote · v{q.version}</h2><p>{q.id}</p></div>
      <div className="n-case-quote-total"><p>Priced subtotal · USD</p><strong>{money(q.totals.subtotalCents)}</strong><p>For {Number(q.requirements.quantity).toLocaleString('en-US')} units</p></div>
      <dl className="n-quote-basis-facts">
        <div><dt>Proposed lead time · conditional</dt><dd>{q.lead}<p className="n-quote-basis-note">Requested: {q.requirements.timing} · Not confirmed</p></dd></div>
        <div><dt>Finish condition</dt><dd>{finishOutcome}</dd></div>
      </dl>
      <p className="n-case-total-condition">Final total: {q.totals.totalCents===null?'pending review':money(q.totals.totalCents)}.{exclusions.length?` Excludes unpriced ${exclusions.join(', ').toLowerCase()}.`:''}</p>
      <ActionLink href={quoteDocumentHref(q)} onClick={event=>{event.preventDefault();api.openQuoteDocument(q);}}>Open quote document</ActionLink>
      <p className="n-quote-provenance">Based on {q.rfqId}.</p>
    </aside>
  </section>;
}
function QuoteVersionComparison({before,after}) {
  return <dl className="n-quote-differences" aria-label="Quote version comparison">{quoteComparison(before,after).map(([label,original,revised])=>{
    const changed=original!==revised;
    return <div className="n-quote-difference" key={label} data-changed={changed||undefined}><dt>{label}<span className="n-change-label">{changed?'Changed':'Unchanged'}</span></dt><dd><span className="n-quote-value-label">v{before.version} · original</span><span>{original}</span></dd><dd><span className="n-quote-value-label">v{after.version} · revised example</span><span>{revised}</span></dd></div>;
  })}</dl>;
}
export function QuoteWorkspace({state,api}) {
  const context=commercialContext(state),q=context.latestQuote;
  if(context.error)return <><Heading eyebrow="CURRENT WORK" title="The saved context needs attention."/><Notice title="No record was changed" kind="error">{context.error}</Notice><ActionLink href="#history" onClick={event=>{event.preventDefault();api.navigate('history');}}>Open saved records</ActionLink></>;
  if(!q)return <><Heading eyebrow="CURRENT WORK" title="Continue your saved inquiry." description="A quote is a separate, later example stage."/><Button onClick={api.prepareQuote}>Continue to seller review</Button></>;
  const view=quoteFollowup(state,q);
  return <div className="n-quote-room n-quote-followup">
    <header className="n-quote-room-header"><div><h1 id="page-title" tabIndex={-1}>{q.product.id} <span>· Current work</span></h1><p className="n-quote-identity">{q.rfqId} · Latest proposal {q.id} v{q.version}</p></div><EvidenceLabel kind="example">Example · Not an NHI offer</EvidenceLabel></header>
    <QuoteSummary q={q} api={api} view={view}/>

  </div>;
}

export function QuoteDocumentWorkspace({state,api,routeParams={}}){
  const context=resolveRecordView(state,{...routeParams,source:'quote'}),q=context.record;
  const [section,setSection]=useState(routeParams.view==='comparison'?'comparison':'document');
  useEffect(()=>{setSection(routeParams.view==='comparison'?'comparison':'document');if(['reference','attachments'].includes(routeParams.view))requestAnimationFrame(()=>document.getElementById(routeParams.view==='attachments'?'quote-attachments':'quote-request-context')?.scrollIntoView({block:'start',behavior:'instant'}));},[q?.id,q?.version,routeParams.view]);
  if(context.error||!q)return <div className="n-quote-document-workspace"><Heading eyebrow="QUOTE DOCUMENT" title="This quote is unavailable."/><Notice kind="error" title="Saved records are unchanged">{context.error||'Open an exact quote version from saved records.'}</Notice><ActionLink href="#quote" onClick={event=>{event.preventDefault();api.navigate('quote');}}>Return to current work</ActionLink></div>;
  const versions=state.quotes.filter(x=>x.id===q.id&&x.rfqId===q.rfqId).sort((a,b)=>a.version-b.version),before=versions.find(x=>x.version===q.previousVersion),archived=context.latestQuote?.version!==q.version;
  return <div className="n-quote-document-workspace">
    <div className="n-doc-actions"><ActionLink href="#quote" variant="secondary" onClick={event=>{event.preventDefault();api.openCurrentWork(q);}}>Return to current work</ActionLink><Button variant="secondary" onClick={()=>api.pdfQuote(q)}>Download quote PDF</Button></div>
    <Heading eyebrow={`${q.product.id} · QUOTE DOCUMENT`} title={`${q.id} · v${q.version}`} description={`${date(q.createdAt)} · ${q.requirements.company} · ${archived?'Earlier saved version':'Latest saved version'}`}><EvidenceLabel kind="example">Example · Not an NHI offer</EvidenceLabel></Heading>
    <div id="quote-attachments"><QuoteAttachments record={q} api={api} open={routeParams.view==='attachments'}/></div>
    <div className="n-doc-controls"><VersionSelector quote={q} versions={versions} onChange={version=>api.openQuoteDocument(versions.find(item=>item.version===version))}/>{before&&<ChoiceGroup variant="segmented" label="Document content" value={section} onChange={setSection} choices={[{value:'document',label:'Quote document'},{value:'comparison',label:`Changes from v${before.version}`} ]}/>}</div>
    {archived&&<p className="n-doc-version-note">You are reading v{q.version}. Current follow-up continues with v{context.latestQuote?.version}; this document does not change that work.</p>}
    {section==='comparison'&&before?<section className="n-doc-comparison"><h2>Changes from v{before.version} to v{q.version}</h2><p className="n-help">Saved example proposals · Changes do not confirm technical suitability.</p><QuoteVersionComparison before={before} after={q}/>{q.responseId&&<Button variant="text" onClick={()=>api.openHistory({type:'reply',id:q.responseId})}>View the saved seller reply</Button>}</section>:<article className="n-document" id="quote-document">
      <div className="n-document-header"><div><p className="n-eyebrow">PREPARED FOR · FICTIONAL CUSTOMER</p><h2>{q.requirements.company}</h2><p>{q.requirements.name}<br/>{q.requirements.email}</p></div><QuoteContext q={q}/></div>
      <div className="n-table-scroll" tabIndex="0" role="region" aria-label="Quote line items"><table className="n-table n-price-table"><caption className="n-sr-only">Example quote line items, USD</caption><thead><tr><th>Item & scope</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{q.lines.map((l,i)=><tr key={i}><th scope="row">{l.label}{l.unitCents===null&&<small>Review required</small>}</th><td>{l.qty.toLocaleString('en-US')}<small>{l.unit}</small></td><td>{money(l.unitCents)}</td><td>{money(l.unitCents===null?null:l.qty*l.unitCents)}</td></tr>)}</tbody></table></div><QuoteTotal q={q}/>
      <section className="n-section"><h2>Requested timing & example terms</h2><dl className="n-terms"><div><dt>Customer requested window</dt><dd>{q.requirements.timing}<small>Not confirmed</small></dd></div><div><dt>Example lead time</dt><dd>{q.lead}</dd></div><div><dt>Payment</dt><dd>{q.terms}</dd></div><div><dt>Validity</dt><dd>{q.validity}</dd></div></dl></section>
      {q.sellerNote&&<section className="n-section"><h2>Seller note · Example</h2><p className="n-doc-seller-note">{q.sellerNote}</p></section>}
      <p className="n-disclaimer">This example cannot be used to place an order. A priced allowance does not confirm manufacturing suitability. NHI has not issued or approved this document.</p>
    </article>}
    <div id="quote-request-context"><SavedRequestContext record={q} api={api} open={routeParams.view==='reference'} includeAttachments={false}/></div>
  </div>;
}

export function RevisionWorkspace({state,api,showForm,persistent}) {
  const q=activeQuote(state),key=q&&quoteKey(q),[draft,setDraft]=useState(state.revisionDraft),[errors,setErrors]=useState({}),saving=useRef(false);
  if(!q)return <Notice title="No saved quote is selected.">Return to your inquiry to open an example quote.</Notice>;
  const records=state.revisions.filter(r=>r.quoteId===q.id&&r.quoteVersion===q.version).slice().reverse(),hasSaved=records.length>0&&!showForm;
  function update(name,value){const next={...draft,[name]:value};setDraft(next);setErrors(e=>({...e,[name]:undefined}));api.updateDraft(key,next);}
  function submit(e){e.preventDefault();if(saving.current)return;saving.current=true;try{const r=api.saveRevision(key,draft);if(r?.errors){setErrors(r.errors);requestAnimationFrame(()=>document.querySelector('.nhi-ui [aria-invalid="true"]')?.focus());}}catch(error){setErrors({form:error.message});}finally{saving.current=false;}}
  const requests=['quantity','timing','finish'].filter(k=>draft[k]&&String(draft[k])!==String(q.requirements[k]));
  return <><Heading eyebrow="QUOTE FOLLOW-UP" title={hasSaved?'Your change stays connected.':'What would you like to change?'} description={`${q.id} · v${q.version} / ${q.rfqId}. Every request stays linked to this exact version.`}><Button variant="secondary" icon="back" onClick={()=>api.navigate('quote')}>Return to current work</Button></Heading>
    <div className="n-workspace"><section className="n-document">{hasSaved?<><Notice kind="saved" role="status" title={persistent?'Demo change request saved':'Change request kept in this session'}>Local record only. No message has been sent to NHI. The source quote is unchanged.</Notice>{records.map(r=><article className="n-saved-request" key={r.id} id={`request-${r.id}`} tabIndex={-1} data-current={r.id===state.activeRevisionId||undefined} aria-current={r.id===state.activeRevisionId?true:undefined}><div className="n-section-heading"><h2>{r.id}</h2><EvidenceLabel kind="customer">{r.id===state.activeRevisionId?'Opened request':'Customer request'}</EvidenceLabel></div><p className="n-help">Regarding {r.quoteId} · v{r.quoteVersion} / {r.rfqId} · {date(r.createdAt)}</p>{r.changes.length>0&&<Comparison rows={r.changes.map(c=>[{quantity:'Quantity',timing:'Delivery window',finish:'Finish'}[c.field],c.field==='finish'?FINISHES[c.before]:c.before,c.field==='finish'?FINISHES[c.after]:c.after])} beforeLabel={`Quoted v${q.version}`} afterLabel="Requested" caption={`Requested changes in ${r.id}`} showState={false}/>} {r.message&&<div className="n-message"><p className="n-eyebrow">CUSTOMER MESSAGE</p><p>{r.message}</p></div>}<OriginalQuestions record={q} title="Related 3D questions"/><Notice title="Next step in this demonstration">Continue as the seller to prepare a reply, review the proposal and explicitly issue the next example version.</Notice>{q.product.id==='F-4412'&&<Button variant="secondary" onClick={()=>api.simulateReply(r.id)}>{replyFor(state,r.id)?'View simulated reply':'Continue as seller'}</Button>}</article>)}<ActionGroup><Button disabled={!api.canRevise} onClick={api.newRevision} icon="plus">Add another request</Button><Button variant="secondary" icon="download" onClick={api.exportCase}>Export case</Button></ActionGroup></>:<>
      <div className="n-section-heading"><h2>Revision request</h2><EvidenceLabel kind="example">Local demonstration</EvidenceLabel></div><p>Leave unchanged fields blank. New values are requests for review.</p>
      <form onSubmit={submit} noValidate className="n-revision-form">{errors.form&&<Notice role="alert" title="Request not saved">{errors.form}</Notice>}<div className="n-fields-grid"><Field id="n-quantity" label="Requested quantity" optional inputMode="numeric" value={draft.quantity} onChange={e=>update('quantity',e.target.value)} hint={`Currently quoted: ${q.requirements.quantity} units`} error={errors.quantity}/><Field id="n-timing" label="Requested delivery window" optional value={draft.timing} onChange={e=>update('timing',e.target.value)} hint={`Current request: ${q.requirements.timing}`} error={errors.timing}/><Field id="n-finish" label="Requested finish" optional className="n-field-wide" options={[["","Keep current request"],...Object.entries(FINISHES)]} value={draft.finish} onChange={e=>update('finish',e.target.value)} hint={`Current request: ${FINISHES[q.requirements.finish]}`} error={errors.finish}/><Field id="n-message" label="Question or reason for the change" className="n-field-wide" textarea rows={5} value={draft.message} onChange={e=>update('message',e.target.value)} placeholder="Tell us what should change and why…" error={errors.message}/></div>
      {(requests.length>0||draft.message.trim())&&<div className="n-request-preview"><p className="n-eyebrow">YOUR REQUEST · NOT A NEW QUOTE</p><p>{requests.length?`${requests.length} requested field change${requests.length>1?'s':''}`:'Technical question only'}{draft.message.trim()&&requests.length?' and a customer message':''}. Linked to {q.id} · v{q.version}.</p></div>}
      <div className="n-form-bottom"><ActionGroup><Button type="submit" icon="arrow">Save demo change request</Button><Button variant="text" onClick={()=>api.navigate('quote')}>Return to current work</Button></ActionGroup><p className="n-help">Saved in this browser. Your example quote stays unchanged.</p></div></form></>}</section><Aside q={q} api={api} revision/></div></>;
}
