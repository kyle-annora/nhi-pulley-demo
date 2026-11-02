import React,{useRef,useState} from 'react';
import {Heading,Notice,EvidenceLabel,ActionGroup,ActionLink,Button} from '../components/primitives';
import {FINISHES,activeRFQ} from '../domain.mjs';
import {inquiryDocument,rfqStatus} from '../rfq-adapter.mjs';
import {rfqViewContext} from '../rfq-context.mjs';
import {SavedRequestContext,OriginalQuestions} from '../components/saved-request-context';

const formatDate=v=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(v));
const qty=v=>v?(Number.isFinite(Number(v))?`${Number(v).toLocaleString('en-US')} units`:`${v} · check input`):'Unknown · review needed';
const pendingQuoteSummary=context=>{
  if(!context.pending.length)return '';
  const change=context.pending.flatMap(request=>request.changes||[]).filter(change=>change.field==='quantity').at(-1);
  return change?`Later request: ${qty(change.after)} · still open.`:`${context.pending.length} change request${context.pending.length===1?' remains':'s remain'} open.`;
};
function RouteLink({to,api,children,variant='text',icon}){return <ActionLink href={`#${to}`} variant={variant} icon={icon} onClick={e=>{e.preventDefault();api.navigate(to);}}>{children}</ActionLink>;}
function InquiryDocument({packet,api,context,referenceOpen=false}){
  const d=packet.requirements,p=packet.product;
  return <article className="n-rfq-document" aria-label={packet.id?`Saved inquiry ${packet.id}`:'Inquiry draft for review'}>
    <div className="n-rfq-document-head"><div><p className="n-eyebrow">{packet.id?'SAVED REQUEST DETAILS':'CONFIRM YOUR REQUEST'}</p><h2>{p.id}</h2><p className="n-help">{p.name} · A Series</p></div><EvidenceLabel kind="customer">{packet.id?'Fixed RFQ snapshot':'Working draft'}</EvidenceLabel></div>
    <dl className="n-rfq-core-facts"><div><dt>Requested quantity</dt><dd>{qty(d.quantity)}</dd></div><div><dt>Requested delivery</dt><dd>{d.timing}</dd></div><div><dt>Finish request</dt><dd>{d.finish==='custom'?(d.notes||'Other finish · description needed'):(FINISHES[d.finish]||d.finish)}</dd></div></dl>
    <p className="n-rfq-terms-note">Requested timing and finish need supplier review.</p>
    <section className="n-rfq-application"><h3>Application</h3><p>{d.application}</p></section>
    <section className="n-rfq-contact"><h3>Contact for this inquiry</h3><p><strong>{d.name}</strong> · {d.company}</p><p>{d.email}</p></section>
    <OriginalQuestions record={packet} title="Your saved questions"/>
    <SavedRequestContext record={packet} api={api} open={referenceOpen} includeQuestions={false}/>
  </article>;
}
function QuoteRelationship({context,packet}){
  if(!context.quote)return null;
  return <div className="n-rfq-quote-context"><h3>Linked quote · v{context.quote.version}</h3><p>{context.quote.id} · {qty(context.quote.requirements.quantity)}</p>{context.pending.length>0&&<p className="n-help">{pendingQuoteSummary(context)} Follow up from the quote.</p>}<p className="n-help">This RFQ remains the saved {qty(packet.requirements.quantity)} request.</p></div>;
}
export function InquiryReview({state,api,persistent,routeParams={}}){
  const packet=inquiryDocument(state),context=rfqViewContext(state,packet),[issue,setIssue]=useState(''),saving=useRef(false),message=useRef(null);
  const showIssue=text=>{setIssue(text);saving.current=false;requestAnimationFrame(()=>{message.current?.focus();message.current?.scrollIntoView({block:'center',behavior:'instant'});});};
  const save=()=>{
    if(saving.current)return;saving.current=true;
    try{
      const result=api.saveInquiry(packet.fingerprint);
      if(result?.error||result?.errors){showIssue(result.error||'Some required details need attention. Your draft is retained; return to configuration to correct them.');}
    }catch{showIssue('The request could not be saved. Your draft is retained. Try again or export the case.');}
  };
  return <div className="n-rfq-workspace" data-mode="review"><Heading eyebrow={`${packet.product.id} · INQUIRY REVIEW`} title="Confirm your request." description="Confirm the details below. Technical questions can stay open."><EvidenceLabel kind="example">Fictional customer scenario</EvidenceLabel></Heading>
    <section className="n-rfq-current-task" aria-label="Your confirmation"><p>Saving creates a local RFQ record or reopens an unchanged one. Existing quotes stay unchanged.</p>
      {context.rfq&&<div className="n-rfq-review-context"><p>This draft {context.draftChanged?'differs from':'matches'} {context.rfq.id}.</p><details><summary>Saved request & quote context</summary><p>{context.rfq.id} · {qty(context.rfq.requirements.quantity)} saved.</p>{context.error?<p>{context.error}</p>:context.quote?<><QuoteRelationship context={context} packet={context.rfq}/><Button variant="text" onClick={()=>api.openBuyerQuote(context.quote)}>Follow up on quote v{context.quote.version}</Button></>:<p>No quote has been issued for this saved request.</p>}</details></div>}
    </section>
    {!persistent&&<div className="n-rfq-feedback"><Notice kind="error" title="Browser storage is unavailable" role="status">The request can be kept in this session. Export the case before leaving.</Notice></div>}
    {issue&&<div className="n-rfq-feedback" ref={message} tabIndex={-1}><Notice kind="error" title="Review needed before saving" role="alert"><p>{issue}</p><Button variant="text" onClick={api.correctInquiry}>Check required details</Button></Notice></div>}
    <div className="n-rfq-layout"><InquiryDocument packet={packet} api={api} context={context} referenceOpen={routeParams.view==='reference'}/><aside className="n-rfq-side" aria-label="Save this inquiry"><p className="n-eyebrow">READY TO KEEP THIS REQUEST?</p><h2>{packet.product.id}</h2><p>{qty(packet.requirements.quantity)}</p><p className="n-help">Your inputs, files and open questions stay together.</p><div className="n-rfq-desktop-action"><ActionGroup stack><Button onClick={save}>Save demo RFQ</Button><RouteLink to="configure" api={api} variant="secondary">Edit requirements</RouteLink></ActionGroup><p className="n-help">Local demo · No message sent to NHI.</p></div><div className="n-rfq-secondary-actions"><Button variant="text" icon="download" onClick={api.exportCase}>Export case</Button>{activeRFQ(state)&&<RouteLink to="rfq" api={api}>View saved RFQ</RouteLink>}</div></aside></div>
    <div className="n-rfq-mobile-action" aria-label="Save inquiry"><ActionGroup><RouteLink to="configure" api={api}>Edit requirements</RouteLink><Button onClick={save}>Save demo RFQ</Button></ActionGroup><p className="n-help">Local demo · No message sent to NHI.</p></div>
  </div>;
}
export function SavedRFQ({state,api,persistent,rfqSaveResult,routeParams={}}){
  const packet=inquiryDocument(state,'saved'),[feedback,setFeedback]=useState('');
  if(!packet)return <div className="n-rfq-workspace"><Heading eyebrow="YOUR INQUIRY" title="No RFQ saved yet." description="Review your requirements to create a local request."/><Notice title="Your working draft is still available">No saved record is selected. The draft has not been submitted.</Notice><div className="n-rfq-feedback"><ActionGroup><RouteLink to="configure" api={api} variant="primary">Configure your inquiry</RouteLink><RouteLink to="review" api={api} variant="secondary">Review current draft</RouteLink></ActionGroup></div></div>;
  const context=rfqViewContext(state,packet),status=rfqStatus({persistent,draftChanged:context.draftChanged,duplicate:rfqSaveResult?.id===packet.id&&rfqSaveResult.duplicate});
  const exportRecord=()=>{try{api.exportRFQ(packet.id);setFeedback(`${packet.id} exported as JSON. The saved record is unchanged.`);}catch{setFeedback('Export could not be started. Please try again.');}};
  const next=()=>context.quote?api.openBuyerQuote(context.quote):api.prepareQuote(),nextLabel=context.quote?'Continue follow-up':'Continue to seller review';
  return <div className="n-rfq-workspace" data-mode="saved"><Heading eyebrow={`${packet.product.id} · SAVED INQUIRY`} title={packet.id} description={`Version ${packet.version} · ${formatDate(packet.createdAt)} · ${packet.requirements.company}`}><EvidenceLabel kind="example">Local demo · Fictional customer scenario</EvidenceLabel></Heading>
    <section className="n-rfq-current-task" aria-labelledby="rfq-current-task-title"><h2 id="rfq-current-task-title" aria-live="polite">{status.title}</h2><p>{status.detail}</p>{status.duplicate&&<p className="n-help">{status.duplicate}</p>}<p className="n-rfq-next-owner">{context.error?'The saved context needs attention before continuing.':context.quote?'Next in this demo: follow up on the quote and open changes.':'Next in this demo: sales reviews this request; engineering checks the open technical questions.'}</p>{!context.error&&context.quote&&<div className="n-rfq-mobile-quote-context"><p>Quote v{context.quote.version}: {qty(context.quote.requirements.quantity)}. {pendingQuoteSummary(context)}</p><p className="n-help">This RFQ remains the saved {qty(packet.requirements.quantity)} request.</p></div>}</section>
    {context.error&&<div className="n-rfq-feedback"><Notice kind="error" title="Saved context needs attention" role="alert">{context.error}</Notice></div>}
    {status.draftChanged&&<div className="n-rfq-draft-note"><p>{context.isCurrentProduct?'The working draft has different details.':'The working draft is for another product.'} This RFQ and its linked quotes are unchanged.</p><RouteLink to="review" api={api}>Review working draft</RouteLink></div>}
    {feedback&&<p className="n-rfq-feedback n-help" role="status">{feedback}</p>}
    <div className="n-rfq-layout"><InquiryDocument packet={packet} api={api} context={context} referenceOpen={routeParams.view==='reference'}/><aside className="n-rfq-side" aria-label="Continue this saved inquiry"><p className="n-eyebrow">NEXT IN THIS DEMO</p><h2>{context.quote?'Continue the quote':'Seller review'}</h2><p className="n-help">{context.quote?'Follow the saved proposal and any later change requests.':'Sales prepares a draft, reviews the proposed terms and explicitly issues an example quote.'}</p><div className="n-rfq-desktop-action"><ActionGroup stack><Button disabled={Boolean(context.error)} onClick={next}>{nextLabel}</Button><RouteLink to="configure" api={api} variant="secondary">Back to working draft</RouteLink></ActionGroup></div>{!context.error&&<QuoteRelationship context={context} packet={packet}/>}<div className="n-rfq-secondary-actions"><Button variant="text" icon="download" onClick={exportRecord}>Export RFQ</Button><Button variant="text" icon="download" onClick={api.exportCase}>Export case</Button></div><p className="n-help">A saved RFQ is not a quote acceptance, technical approval or order.</p></aside></div>
    <details className="n-disclosure n-rfq-receiving-preview"><summary>Simulated receiving preview</summary><p>Sales and engineering would review this same {packet.id} snapshot: {packet.product.id}, {qty(packet.requirements.quantity)}, the saved application, attachments and open questions above.</p><p className="n-help">This is a local receiving preview. NHI has not received or reviewed this request.</p>{!context.error&&<Button variant="secondary" onClick={()=>api.openSeller()}>View as seller</Button>}</details>
    <div className="n-rfq-mobile-action" aria-label="Continue saved inquiry"><ActionGroup><RouteLink to="configure" api={api}>Working draft</RouteLink><Button disabled={Boolean(context.error)} onClick={next}>{nextLabel}</Button></ActionGroup><p className="n-help">Local demo · Saved record stays unchanged.</p></div>
  </div>;
}
