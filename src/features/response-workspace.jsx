import {OriginalQuestions,SavedRequestContext} from '../components/saved-request-context';
import React,{useRef,useState} from 'react';
import {activeQuote,activeRFQ,money} from '../domain.mjs';
import {replyContext} from '../workflow-adapter.mjs';
import {Button,ActionLink,ActionGroup,EvidenceLabel,Notice,Heading} from '../components/primitives';

const date=value=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(value));
function RouteLink({to,api,children,variant='secondary'}){return <ActionLink href={`#${to}`} variant={variant} onClick={e=>{e.preventDefault();api.navigate(to);}}>{children}</ActionLink>;}
function ReplyIdentity({reply,revision,base,rfq}){return <dl className="n-response-identity"><div><dt>Simulated reply</dt><dd>{reply.id}</dd></div><div><dt>Change request</dt><dd>{revision.id}</dd></div><div><dt>Source quote</dt><dd>{base.id} · v{base.version}</dd></div><div><dt>Saved inquiry</dt><dd>{rfq.id} · v{rfq.version}</dd></div></dl>;}

export function ResponseWorkspace({state,api,persistent}){
  const context=replyContext(state),[issue,setIssue]=useState(''),errorRef=useRef(null),busy=useRef(false);
  const perform=operation=>{
    if(busy.current)return;busy.current=true;
    try{const result=operation();if(result?.error)throw new Error(result.error);setIssue('');}
    catch(error){setIssue(error.message||'The next step could not be opened. Your existing records are retained.');requestAnimationFrame(()=>{errorRef.current?.focus();errorRef.current?.scrollIntoView({block:'center',behavior:'instant'});});}
    finally{busy.current=false;}
  };
  if(context.error)return <><Heading eyebrow="SIMULATED REPLY" title="Open a saved change request." description="Each example response belongs to one request and one source quote version."/><Notice kind="error" title="No linked reply is available" role="status">{context.error} Your existing records are retained.</Notice><div className="n-response-empty-actions"><ActionGroup>{activeQuote(state)?<RouteLink to="revision" api={api}>View change requests</RouteLink>:<RouteLink to={activeRFQ(state)?'rfq':'configure'} api={api}>{activeRFQ(state)?'View saved inquiry':'Return to inquiry'}</RouteLink>}<Button variant="text" icon="download" onClick={api.exportCase}>Export case</Button></ActionGroup></div></>;
  const {reply,revision,base,rfq,issued,nextVersion,subtotalCents,pendingItems}=context;
  const quoteLabel=issued?`View example quote v${nextVersion}`:'Continue to seller review';
  const openQuote=()=>perform(()=>api.openReplyQuote(reply.id));
  const openRevision=()=>perform(()=>api.openReplyRevision(revision.id));
  return <><Heading eyebrow="SIMULATED SUPPLIER REPLY" title="Review the example response." description="Requested changes, proposed terms and open questions stay connected."><Button variant="secondary" onClick={openRevision}>View change request</Button></Heading>
    <Notice kind="example" title="Example response · Not sent by NHI"><p>The prices and delivery proposal below are invented for this demonstration. They do not confirm availability, suitability or an order.</p></Notice>
    {!persistent&&<div className="n-response-feedback"><Notice kind="error" title="This case is kept in this session only" role="status">Browser storage is unavailable or full. Export the case before leaving.</Notice></div>}
    {issue&&<div className="n-response-feedback" ref={errorRef} tabIndex={-1}><Notice kind="error" title="This action needs attention" role="alert">{issue} Your existing records are unchanged.</Notice></div>}
    <div className="n-response-mobile-action"><Button icon="arrow" onClick={openQuote}>{quoteLabel}</Button><p className="n-help">{issued?'Reopens the existing version.':'Review and explicitly issue the next version as the seller.'} Source quote v{base.version} stays unchanged.</p></div>
    <div className="n-response-layout"><article className="n-response-document" aria-label={`Simulated reply ${reply.id}`}>
      <div className="n-response-document-head"><div><p className="n-eyebrow">REGARDING YOUR CHANGE REQUEST</p><h2>{base.product.id} · {reply.requirements.company}</h2><p className="n-help">{date(reply.createdAt)} · Fictional customer scenario</p></div><EvidenceLabel kind="example">Local simulation</EvidenceLabel></div>
      <ReplyIdentity reply={reply} revision={revision} base={base} rfq={rfq}/>
      <section className="n-response-section"><div className="n-section-heading"><h2>Requested and proposed.</h2><EvidenceLabel kind="review">Review required</EvidenceLabel></div><p className="n-help">A proposed term does not replace the customer's original request.</p>
        <div className="n-response-decisions">{reply.decisions.map((decision,index)=><section className="n-response-decision" key={`${decision.topic}-${index}`}><div className="n-section-heading"><h3>{decision.topic}</h3><EvidenceLabel kind={decision.status==='Review required'?'review':'example'}>{decision.status}</EvidenceLabel></div><dl><div><dt>You requested</dt><dd>{decision.requested}</dd></div><div><dt>Example response</dt><dd>{decision.response}</dd></div></dl></section>)}</div>
      </section>
      <section className="n-response-section"><OriginalQuestions record={issued||base} title="Related questions"/><p className="n-help">The example commercial reply does not answer these saved engineering questions.</p></section>
      <SavedRequestContext record={issued||base} api={api} includeQuestions={false}/>{reply.assumption&&<p className="n-help">{reply.assumption}</p>}
      <p className="n-response-disclaimer">This reply prepares a demonstration quote comparison. NHI has not received, issued or approved it.</p>
    </article><aside className="n-response-side"><p className="n-eyebrow">CONTINUE THIS CASE</p><h2>See the revised scope.</h2><p className="n-help">Quote v{nextVersion} stays linked to {revision.id} and this reply. The source quote v{base.version} is preserved.</p>
      <dl className="n-response-summary"><div><dt>Requested quantity</dt><dd>{Number(reply.requirements.quantity).toLocaleString('en-US')} units</dd></div><div><dt>Example base price</dt><dd>{money(reply.unitCents)} / unit</dd></div><div><dt>Priced subtotal · USD</dt><dd>{money(subtotalCents)}</dd></div><div><dt>Final total</dt><dd>Pending review</dd></div></dl>
      <p className="n-help">The subtotal includes only known example amounts. {pendingItems.length>0?`Still unpriced: ${pendingItems.join(' · ')}. These are not treated as zero.`:'Engineering and commercial review remain open.'}</p>
      <div className="n-response-timing"><p className="n-eyebrow">DELIVERY PROPOSAL</p><p>{reply.lead}</p><p className="n-help">Your request: {reply.requirements.timing}. Neither window is confirmed.</p></div>
      {issued&&<Notice title={`Quote v${issued.version} is already available`}>Opening it reuses the saved version. No duplicate quote is created.</Notice>}
      <ActionGroup stack><Button icon="arrow" onClick={openQuote}>{quoteLabel}</Button><Button variant="secondary" onClick={openRevision}>View source change request</Button><Button variant="text" icon="download" onClick={()=>perform(api.exportCase)}>Export case</Button></ActionGroup>
      <p className="n-help">{persistent?'Local demo record.':'Session-only record.'} No message is sent to NHI, and no order is placed.</p>
    </aside></div>
  </>;
}
