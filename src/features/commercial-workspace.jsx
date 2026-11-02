import React,{useState} from 'react';
import {activeQuote,activeRFQ,money,FINISHES,CATALOG} from '../domain.mjs';
import {commercialContext} from '../commercial-adapter.mjs';
import {recordReviewItems,reviewHandoff} from '../review-items.mjs';
import {Heading,Button,ActionLink,ActionGroup,Field,EvidenceLabel,Notice} from '../components/primitives';
import {SavedRequestContext,OriginalQuestions} from '../components/saved-request-context';
import {InquiryEvidence} from './inquiry-workspace';

export function CaseHandoff({state,api}){
  if(['components','history','select','explore','configure','review'].includes(state.step))return null;
  const context=commercialContext(state),seller=state.step==='seller',rfq=activeRFQ(state),q=activeQuote(state);
  return <section className="n-case-handoff" aria-label="Current project and role">
    <div><span className="n-eyebrow">{seller?'SELLER · DEMO STUDIO':'BUYER · PRODUCT ROOM'}</span><strong>{rfq?`${rfq.product.id} / ${rfq.id}`:`${state.selected} / Working inquiry`}{q?` / v${q.version}`:''}</strong></div>
    <div><span className="n-help">{q&&context.latestQuote?.version>q.version?`Earlier quote v${q.version} · latest is v${context.latestQuote.version}`:context.status||'Record your requirements, then review the inquiry.'}</span>{rfq&&<Button variant="text" onClick={()=>seller?api.navigate(q?'quote':'rfq'):api.openSeller()}>{seller?'Return to buyer':'View as seller'}</Button>}</div>
  </section>;
}
function PendingChanges({pending,api,seller=false,showHeading=true}){
  if(!pending.length)return null;
  return <section className="n-pending-changes" aria-label="Changes awaiting a reply">
    {showHeading&&<div className="n-section-heading"><h2>New change awaiting a seller reply</h2><EvidenceLabel kind="review">Seller action needed</EvidenceLabel></div>}
    <p>This request needs a seller response before a next step can be confirmed. Saved review plans remain available in history.</p>
    {pending.map(r=><div key={r.id} className="n-pending-change"><div><strong>{r.id}</strong><p>{r.changes.length?r.changes.map(c=>`${{quantity:'Quantity',timing:'Delivery',finish:'Finish'}[c.field]||c.field}: ${c.field==='finish'?FINISHES[c.after]:c.after}`).join(' · '):'Technical question'} · against v{r.quoteVersion}</p>{r.message&&<p>{r.message}</p>}</div><Button variant="primary" onClick={()=>seller?api.openSeller(r.id):api.viewRevisions()}>{seller?`Review ${r.id}`:'View pending change'}</Button></div>)}
  </section>;
}
function Proposal({quote,reply,note,revision}){
  if(!quote)return null;
  const items=recordReviewItems(quote,{reply,revision});
  return <>
    <dl className="n-commercial-facts"><div><dt>Proposed version</dt><dd>{quote.id} · v{quote.version}</dd></div><div><dt>Quantity</dt><dd>{quote.requirements.quantity} units</dd></div><div><dt>Example priced subtotal · USD</dt><dd>{money(quote.totals.subtotalCents)}</dd></div><div><dt>Example lead time</dt><dd>{quote.lead}</dd></div></dl>
    <dl className="n-commercial-facts"><div><dt>Customer requested delivery</dt><dd>{quote.requirements.timing} · Not confirmed</dd></div><div><dt>Payment</dt><dd>{quote.terms}</dd></div><div><dt>Validity</dt><dd>{quote.validity}</dd></div></dl>
    <div className="n-table-scroll" role="region" aria-label="Proposed quote lines" tabIndex={0}><table className="n-table"><thead><tr><th>Scope</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{quote.lines.map((l,i)=><tr key={i}><th>{l.label}</th><td>{l.qty} {l.unit}</td><td>{money(l.unitCents)}</td><td>{money(l.unitCents===null?null:l.qty*l.unitCents)}</td></tr>)}</tbody></table></div>
    <p className="n-help">Final total pending. Unpriced: {quote.totals.pending.join(', ')}. Technical release remains open.</p>{note&&<p><strong>Seller note:</strong> {note}</p>}
    {reply&&<div className="n-commercial-decisions"><h3>Reply to each requested change</h3>{reply.decisions.map((d,i)=><section key={i}><div className="n-section-heading"><h3>{d.topic}</h3><EvidenceLabel kind="example">{d.status}</EvidenceLabel></div><p><strong>Buyer requested:</strong> {d.requested}</p><p><strong>Example reply:</strong> {d.response}</p></section>)}</div>}
    <OriginalQuestions record={quote} items={items} title="Related questions"/>
  </>;
}
export function SellerWorkspace({state,api}){
  const context=commercialContext(state,{revisionId:state.sellerRevisionId||undefined});
  const [note,setNote]=useState(context.draft?.sellerNote||'Example proposal only. Open technical questions require engineering review.'),[draft,setDraft]=useState(context.draft||null),[review,setReview]=useState(null),[error,setError]=useState('');
  const rfq=context.rfq,latest=context.latestQuote,revision=state.revisions.find(r=>r.id===state.sellerRevisionId&&r.rfqId===rfq?.id);
  const operation=fn=>{try{const r=fn();if(r?.error){setError(r.error);return null;}setError('');return r;}catch(e){setError(e.message);return null;}};
  if(!rfq)return <><Heading eyebrow="SELLER · DEMO STUDIO" title="A saved inquiry comes first." description="The seller receives the reviewed RFQ snapshot."/><Button onClick={()=>api.navigate('review')}>Review buyer inquiry</Button></>;
  const save=()=>{const result=operation(()=>api.saveSellerDraft({rfqId:rfq.id,revisionId:revision?.id,sellerNote:note}));if(result){setDraft(result.draft);setReview(null);}};
  const reviewDraft=()=>{const result=operation(()=>api.reviewSellerDraft(draft.key));if(result){setReview(result.review||result);requestAnimationFrame(()=>document.getElementById('seller-proposal')?.scrollIntoView({block:'start',behavior:'instant'}));}};
  const issue=()=>operation(()=>api.issueSellerDraft(review));
  const pending=context.pendingRevisions||[];
  if(context.nextStep&&!revision&&!pending.length)return <><Heading eyebrow="SELLER · DEMO STUDIO" title={context.acknowledgement?'Continue the review plan.':'Review the next action.'} description={`${rfq.id} / ${latest.id} · v${latest.version}. The open questions and each party's action stay together.`}/><NextStepPanel state={state} api={api} seller/><ActionGroup><Button variant="secondary" onClick={()=>api.openBuyerQuote(latest)}>View quote v{latest.version}</Button><Button variant="text" onClick={()=>api.navigate('rfq')}>View original inquiry</Button></ActionGroup></>;
  return <><Heading eyebrow="SELLER · DEMO STUDIO" title={revision?'Respond to the change.':pending.length?'Review the new request.':'Prepare the proposal.'} description={`${rfq.id} · ${rfq.requirements.company}. Review the same product, evidence and open questions.`}/>
    <Notice kind="example" title="Seller simulation · Local only">This view demonstrates NHI's possible workflow. Proposal prices and replies are fictional; nothing is sent.</Notice>
    {!revision&&<PendingChanges pending={pending} api={api} seller/>}
    {error&&<Notice kind="error" role="alert" title="Action needs attention">{error}</Notice>}
    <div className="n-commercial-layout"><article className="n-document">
      <div className="n-section-heading"><h2>{rfq.product.id} · Inquiry evidence</h2><EvidenceLabel kind="customer">Saved buyer request</EvidenceLabel></div><p>{rfq.requirements.application}</p>
      <dl className="n-commercial-facts"><div><dt>Requested quantity</dt><dd>{rfq.requirements.quantity} units</dd></div><div><dt>Requested delivery</dt><dd>{rfq.requirements.timing}</dd></div><div><dt>Requested finish</dt><dd>{FINISHES[rfq.requirements.finish]}</dd></div><div><dt>Mounting</dt><dd>{rfq.requirements.mounting}</dd></div></dl>
      <InquiryEvidence draft={rfq.requirements}/>

      <ActionLink href={CATALOG} target="_blank" rel="noreferrer">NHI source catalog · page 6</ActionLink>
      {rfq.requirements.attachments.length>0&&<section className="n-commercial-section"><h3>Saved drawings & references</h3>{rfq.requirements.attachments.map((f,i)=><div key={i}><Button variant="text" onClick={()=>api.downloadAttachment(f)}>Download {f.name}</Button><p className="n-help">{f.sample?'Illustrative application sketch · Example data':'Buyer-supplied reference'}</p></div>)}</section>}
      {revision&&<section className="n-commercial-section"><h2>{revision.id} · Buyer change request</h2><p className="n-help">Against {revision.quoteId} · v{revision.quoteVersion}</p><dl className="n-commercial-facts">{revision.changes.map(c=><div key={c.field}><dt>{c.field}</dt><dd>{c.before} → {c.after}</dd></div>)}</dl>{revision.message&&<p className="n-message">{revision.message}</p>}</section>}
      {draft&&context.canDraft&&<section id="seller-proposal" className="n-commercial-section"><div className="n-section-heading"><h2>{review?'Ready for your issue decision':'Private example draft'}</h2><EvidenceLabel kind="example">{review?'Reviewed · Not issued':'Not visible to buyer'}</EvidenceLabel></div><Proposal quote={draft.quote} reply={draft.reply} revision={revision} note={draft.sellerNote}/>{review&&<ActionGroup><Button onClick={issue}>Issue reviewed example quote v{draft.quote.version}</Button><Button variant="secondary" onClick={()=>setReview(null)}>Back to draft</Button></ActionGroup>}</section>}
    </article><aside className="n-side n-commercial-side">
      {latest&&(!revision||context.blockedReason)?<><p className="n-eyebrow">ISSUED VERSION</p><h2>Quote v{latest.version} is available.</h2><p>{pending.length?'The new request above is awaiting a seller response.':'Reopen it to compare terms or request the next engineering step.'}</p><Button variant={pending.length?'secondary':'primary'} onClick={()=>api.openBuyerQuote(latest)}>View buyer quote v{latest.version}</Button>{context.blockedReason&&revision&&<p className="n-help">{context.blockedReason}</p>}{context.nextStep&&<details className="n-disclosure"><summary>Earlier review request · {context.nextStep.id}</summary><p>{context.nextStep.message}</p>{context.acknowledgement&&<p>{context.acknowledgement.message}</p>}<p className="n-help">Saved history. New changes need a separate response.</p></details>}</>:<><p className="n-eyebrow">{review?'3 · ISSUE':'SELLER ACTION'}</p><h2>{review?'Issue this example?':'Draft, review, then issue.'}</h2>{!review&&<Field label="Seller proposal note" textarea rows={5} value={note} onChange={e=>{setNote(e.target.value);setReview(null);}} hint="Saved with the proposal. This does not resolve the technical questions."/>}<ActionGroup stack>{review?<><Button onClick={issue}>Issue example quote v{draft.quote.version}</Button><Button variant="secondary" onClick={()=>setReview(null)}>Back to draft</Button></>:<><Button variant={draft?'secondary':'primary'} onClick={save}>{draft?'Save draft changes':'Prepare example draft'}</Button>{draft&&<Button disabled={note!==draft.sellerNote} onClick={reviewDraft}>Review example quote v{draft.quote.version}</Button>}</>}</ActionGroup><p className="n-help">{note!==draft?.sellerNote&&draft&&!review?'Save your edited note before reviewing. ':''}{review?'Issuing adds a fixed quote version and its linked example reply. Earlier records are preserved.':'Saving a draft does not issue a quote. Example amounts are fixed for this demonstration.'}</p></>}
      <Button variant="text" onClick={()=>api.navigate(latest?'quote':'rfq')}>Return to buyer</Button>
    </aside></div></>;
}
function defaultReviewMessage(q,handoff,seller){
  return `${seller?'Acknowledge the engineering review plan':'Please coordinate an engineering review'} for ${q.id} v${q.version}. Review the saved customer questions and identify any additional application information needed. Technical answers and fit approval remain pending.`;
}
export function NextStepPanel({state,api,seller=false}){
  const q=activeQuote(state),context=commercialContext(state),request=(state.commercial?.nextSteps||[]).find(r=>r.quoteId===q?.id&&r.quoteVersion===q?.version),ack=(state.commercial?.acknowledgements||[]).find(a=>a.requestId===request?.id);
  const reply=(state.replies||[]).find(r=>r.id===q?.responseId),revision=(state.revisions||[]).find(r=>r.id===q?.revisionId);
  const items=q?recordReviewItems(request||q,{reply,revision}):[],handoff=reviewHandoff(items);
  const [message,setMessage]=useState(()=>q?defaultReviewMessage(q,handoff,seller):''),[review,setReview]=useState(false),[error,setError]=useState('');
  if(!q)return null;
  const latest=context.latestQuote,archived=latest?.id!==q.id||latest?.version!==q.version,pending=archived?[]:context.pendingRevisions||[];
  const perform=()=>{const result=seller?api.acknowledgeNextStep({requestId:request.id,message}):api.requestNextStep({quoteId:q.id,quoteVersion:q.version,kind:'engineering-review',message});if(result?.error)setError(result.error);};
  const title=archived?'Saved review plan.':pending.length?'A new change needs a reply.':ack?'Review action acknowledged.':request?'Engineering review requested.':'Plan the engineering review.';
  const agenda=<><div className="n-review-outcome"><strong>Next: engineering review</strong><p>Engineering reviews the saved questions and replies with findings. Sales follows up if the proposal needs to change.</p></div><OriginalQuestions record={q} items={items} title="Questions included"/><SavedRequestContext record={q} api={api} includeQuestions={false}/></>;
  return <section className="n-next-step" aria-label="Next step confirmation">
    <div className="n-section-heading"><div><p className="n-eyebrow">{q.id} · v{q.version} / {q.rfqId}</p><h2>{title}</h2></div><EvidenceLabel kind={pending.length?'review':ack?'saved':request?'review':'example'}>{archived?'Saved history':pending.length?'Seller action needed':ack?'Example acknowledgement':request?'Seller action needed':'Local example'}</EvidenceLabel></div>
    {!archived&&!pending.length&&<p className="n-next-status">{ack?handoff.status:request?'Seller: review the agenda and acknowledge the proposed action.':'Review the open questions and each party’s action before saving the request.'}</p>}
    {archived?<><p>This plan belongs to quote v{q.version}. Current work continues from v{latest?.version}.</p><Button variant="secondary" onClick={()=>api.openBuyerQuote(latest)}>Open latest quote v{latest?.version}</Button></>:<PendingChanges pending={pending} api={api} seller={seller} showHeading={false}/>}
    {(archived||pending.length)&&request?<details className="n-disclosure"><summary>Saved review agenda · {request.id}{ack?' · acknowledged':''}</summary>{agenda}<p><strong>Buyer message:</strong> {request.message}</p>{ack&&<p><strong>Saved seller acknowledgement:</strong> {ack.message}</p>}</details>:<>
      {agenda}
      {request?<><details className="n-disclosure"><summary>Saved messages · {request.id}{ack?' · acknowledged':''}</summary><p><strong>Buyer:</strong> {request.message}</p>{ack&&<p><strong>Seller:</strong> {ack.message}</p>}</details>{!ack&&!archived&&!pending.length&&(seller?<><Field label="Seller acknowledgement" textarea rows={4} value={message} onChange={e=>{setMessage(e.target.value);setReview(false);}} hint="Confirm the review action. Questions remain open until a substantive answer is recorded."/>{review&&<Notice title="Review seller acknowledgement">{message}</Notice>}<ActionGroup><Button onClick={()=>review?perform():setReview(true)}>{review?'Confirm example review plan':'Review acknowledgement'}</Button>{review&&<Button variant="text" onClick={()=>setReview(false)}>Edit</Button>}</ActionGroup></>:<><p className="n-help">The review request is saved locally and awaits the simulated seller's acknowledgement.</p><Button variant="secondary" onClick={()=>api.openSeller()}>Continue as seller</Button></>)}</>:!archived&&!pending.length&&<><Field label="Message for this review" textarea rows={3} value={message} onChange={e=>{setMessage(e.target.value);setReview(false);}} hint="The saved agenda keeps the questions above, their sources and the exact quote version."/>{review&&<Notice title="Review your request">{message}</Notice>}<ActionGroup><Button onClick={()=>review?perform():setReview(true)}>{review?'Confirm demo review request':'Review next-step request'}</Button>{review&&<Button variant="text" onClick={()=>setReview(false)}>Edit request</Button>}</ActionGroup></>}
    </>}
    <p className="n-help">Local demonstration · No message is sent. A review acknowledgement does not approve fit, accept the quote or place an order.</p>
    {error&&<Notice kind="error" role="alert" title="Request not saved">{error}</Notice>}
  </section>;
}
