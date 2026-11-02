import React,{useState,useRef,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {PATRICK_KEY,PATRICK_QUESTION,createPatrickSession,restorePatrickSession,patrickTransition,patrickView,preparedPatrickSession} from './patrick-flow.mjs';
import {product,FINISHES,money} from './domain.mjs';
import {Button,ActionLink,Field,EvidenceLabel,ChoiceGroup,Notice} from './components/primitives';
import {PulleyStage} from './features/pulley-stage';
import {PatrickCapabilities} from './features/patrick-capabilities';

const ARCHIVE_KEY='nhi-patrick-demo-runs-v1';
const checks=[
  {id:'belt',label:'Belt contact',title:'The running surface is not the outside edge.',text:'B is the running diameter. D is the width between the flanges. These are the surfaces your reference needs to match.',facts:'B · 2.75 in     D · 0.75 in'},
  {id:'flange',label:'Outside clearance',title:'The flange needs its own clearance.',text:'A measures across the flange edges. It is larger than the running diameter; matching B alone does not establish clearance.',facts:'A · 3.125 in     B · 2.75 in'},
  {id:'mount',label:'Mounting',title:'A useful question starts here.',text:'The hub is illustrative. Shaft fit, mounting offsets and spacers need engineering review against the application reference.',facts:'Bore and mounting fit · unconfirmed'}
];
const shortTitles=['See where the question begins.','The same question reaches the inquiry.','The proposal changed. The question stayed.','A traceable next conversation.'];
const shortActions=['Show the prepared inquiry','Show prepared quote v2','Show the acknowledged review plan'];
function download(value,name,type='application/json'){
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function readSession(){try{const raw=localStorage.getItem(PATRICK_KEY);return {raw,session:restorePatrickSession(raw)||createPatrickSession(),invalid:!!raw&&!restorePatrickSession(raw)};}catch{return {raw:null,session:createPatrickSession(),unavailable:true};}}

function App(){
  const initial=useRef(null);if(!initial.current)initial.current=readSession();
  const [session,setSession]=useState(initial.current.session),current=useRef(session),stored=useRef(initial.current.raw);
  const [error,setError]=useState(''),[fieldErrors,setFieldErrors]=useState({}),[durable,setDurable]=useState(!initial.current.unavailable),[capabilities,setCapabilities]=useState(false),[note,setNote]=useState(initial.current.session.questionDraft??PATRICK_QUESTION),[checkIndex,setCheckIndex]=useState(0),[modelOpen,setModelOpen]=useState(false),[mode,setMode]=useState('3d');
  const [phoneLayout,setPhoneLayout]=useState(()=>window.matchMedia('(max-width:760px)').matches);
  useEffect(()=>{const media=window.matchMedia('(max-width:760px)'),changed=()=>setPhoneLayout(media.matches);media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
  const view=patrickView(session),short=session.presentationMode==='short',shortStep=session.shortStep||0;
  const stage=short?['short-inspect','short-inquiry','short-v2','short-complete'][shortStep]:session.stage;
  const chapter=short?(shortStep===0?1:shortStep===1?2:3):view.chapter;
  const title=short?shortTitles[shortStep]:stage==='change'?'Request a change to quote v1.':view.title,role=short?'Presenter':view.role;
  const finished=['complete','short-complete'].includes(stage);
  const inspectionQuestion=useRef(null),inspectionModel=useRef(null),pendingInspectionFocus=useRef(null);
  function showInspectionModel(open){pendingInspectionFocus.current=open?'model':'question';setModelOpen(open);}
  useEffect(()=>{
    if(!phoneLayout||!pendingInspectionFocus.current)return;
    const target=pendingInspectionFocus.current==='model'?inspectionModel.current:inspectionQuestion.current;
    pendingInspectionFocus.current=null;
    if(!target)return;
    const frame=requestAnimationFrame(()=>{target.scrollIntoView({block:'start',behavior:'instant'});target.focus({preventScroll:true});});
    return()=>cancelAnimationFrame(frame);
  },[modelOpen,phoneLayout,stage]);
  const q=view.quote,rfq=view.rfq,question=view.question;
  function commit(next,{quiet=false}={}){
    try{
      if(localStorage.getItem(PATRICK_KEY)!==stored.current){setError('This presentation changed in another tab. Reload before continuing. Your current records have not been replaced.');return false;}
      if(initial.current.invalid){setError('A saved presentation could not be read. Export it from Guide before starting another run.');return false;}
      const raw=JSON.stringify(next);localStorage.setItem(PATRICK_KEY,raw);stored.current=raw;setDurable(true);
    }catch{setDurable(false);}
    current.current=next;setSession(next);setError('');setFieldErrors({});
    if(!quiet)requestAnimationFrame(()=>{window.scrollTo({top:0,behavior:'instant'});document.getElementById('page-title')?.focus({preventScroll:true});});
    return true;
  }
  function act(action,payload={},quiet=false){
    const result=patrickTransition(current.current,action,payload);
    if(result.error){setError(result.error);setFieldErrors(result.errors||{});requestAnimationFrame(()=>document.querySelector('[aria-invalid=true]')?.focus());return false;}
    return commit(result.session,{quiet});
  }
  function archive(){
    const old=current.current;
    if(old.stage==='opening'&&!old.state.rfqs.length)return true;
    try{const list=JSON.parse(localStorage.getItem(ARCHIVE_KEY)||'[]');if(!Array.isArray(list))throw Error();list.push({savedAt:new Date().toISOString(),session:old});localStorage.setItem(ARCHIVE_KEY,JSON.stringify(list));return true;}
    catch{setError('The current presentation could not be archived. Export this run before starting another.');return false;}
  }
  function begin(kind){
    if(initial.current.invalid){setError('A saved presentation could not be read. Export it from Guide before starting another run.');return;}
    try{if(localStorage.getItem(PATRICK_KEY)!==stored.current){setError('This presentation changed in another tab. Reload before continuing. Your current records have not been replaced.');return;}}catch{}
    if(!archive())return;
    const fresh=kind==='short'?{...preparedPatrickSession('complete'),presentationMode:'short',shortStep:0}:{...createPatrickSession(),presentationMode:'long'};
    if(commit(kind==='long'?patrickTransition(fresh,'start').session:fresh)){
      setCheckIndex(0);setMode('3d');setModelOpen(false);setNote(PATRICK_QUESTION);setCapabilities(false);
      document.querySelector('.p-guide')?.removeAttribute('open');
    }
  }
  function mainAction(){
    if(short){if(shortStep<3)commit({...current.current,shortStep:shortStep+1});return;}
    if(stage==='opening'){begin('long');return;}
    if(stage==='inspect'&&checkIndex<2){setCheckIndex(i=>i+1);return;}
    if(stage==='complete')return;
    act(view.action,stage==='question'?{note}:{});
  }
  const primaryLabel=short?shortActions[shortStep]:stage==='inspect'&&checkIndex<2?`Next: ${checks[checkIndex+1].label.toLowerCase()}`:view.actionLabel;
  const editAction={'inquiry-review':'edit-inquiry','change-review':'edit-change','seller-review-v1':'edit-v1','seller-review-v2':'edit-v2','plan-review':'edit-plan','ack-review':'edit-ack'}[stage];
  const quoteForReview=session.review?.draft?.quote;
  const draft=session.state.draft;
  const original=question?.note||PATRICK_QUESTION;
  const packet=['seller-v1','inquiry-review','short-inquiry'].includes(stage)?(rfq?.requirements||draft):draft;
  useEffect(()=>{if(capabilities)requestAnimationFrame(()=>{document.querySelector('.p-guide')?.removeAttribute('open');window.scrollTo({top:0,behavior:'instant'});document.getElementById('p-cap-title')?.focus({preventScroll:true});});},[capabilities]);
  const onCapabilitiesReturn=()=>{setCapabilities(false);requestAnimationFrame(()=>document.getElementById('page-title')?.focus());};
  return <div className="nhi-ui p-shell" data-visual-system="silver" data-stage={stage}>
    <header className="p-header"><a href="./patrick.html" aria-label="NHI Patrick demo home" onClick={e=>{e.preventDefault();begin('overview');}}><img src={window.NHI_LOGO} alt="NHI · Mechanical Motion Parts & Assemblies"/></a><span className="p-header-label">Pulley demonstration</span><EvidenceLabel kind="example">Local example</EvidenceLabel><details className="p-guide"><summary>Guide</summary><div>
      <strong>Patrick's presentation</strong><p>One F-4412 case. Existing workspaces are separate.</p>
      <Button variant="text" onClick={()=>begin('overview')}>Return to presentation opening</Button><Button variant="text" onClick={()=>begin('long')}>Start a new 7-minute run</Button><Button variant="text" onClick={()=>begin('short')}>Open the 3-minute prepared replay</Button>
      <Button variant="text" onClick={()=>setCapabilities(true)}>Optional Annora capability preview</Button>
      <Button variant="text" onClick={()=>download(current.current,'NHI-Patrick-presentation.json')}>Export this presentation</Button>
      <Button variant="text" onClick={()=>{try{download(JSON.parse(localStorage.getItem(ARCHIVE_KEY)||'[]'),'NHI-Patrick-saved-runs.json');}catch{setError('Saved runs are unavailable.');}}}>Export earlier presentation runs</Button>
      {initial.current.invalid&&<Button variant="text" onClick={()=>download(initial.current.raw,'NHI-Patrick-unread-saved-data.json')}>Export unread saved data</Button>}
      <a href="./presentation-kit/backup.html" target="_blank" rel="noreferrer">Offline six-scene backup</a><a href="./presentation-kit/NHI-Patrick-offline-kit.zip" download>Download the offline kit</a><a href="./docs/presentation/patrick-talk-track.md" target="_blank">English talk track</a><a href="./?sample=1#quote" target="_blank" rel="noreferrer">Open existing NHI records</a>
    </div></details></header>
    {capabilities?<main className="p-main p-capability-main"><PatrickCapabilities onReturn={onCapabilitiesReturn}/></main>:<>
      {stage!=='opening'&&<div className="p-progress"><span><b>0{chapter}</b> / 03 · {['Understand the pulley','Build the inquiry','Move the case forward'][chapter-1]}</span><span>{short?'Prepared replay':`Demo role: ${role}`}</span></div>}
      <main className="p-main" id="main">
        <div className="p-page-heading"><p className="n-eyebrow">{stage==='opening'?'NHI · F-4412':short?'THREE-MINUTE REPLAY · PREPARED SAME-CASE RECORDS':`${role.toUpperCase()} · F-4412`}</p><h1 id="page-title" tabIndex={-1}>{title}</h1>{short&&<p className="p-prepared-note">These records were prepared together. Moving between scenes does not execute the skipped actions.</p>}</div>
        {error&&<Notice kind="error" role="alert" title="This action did not complete">{error}</Notice>}
        {!durable&&<Notice role="status" title="Session only">Browser storage is unavailable. Export this presentation before leaving.</Notice>}
        {stage==='opening'&&<div className="p-opening"><div><p className="p-lead">Help a buyer understand the pulley, ask a useful question and continue the same conversation through a revised quotation.</p><ol className="p-opening-acts"><li><span>01</span><div><strong>Understand the pulley</strong><p>Three checks. One useful engineering question.</p></div></li><li><span>02</span><div><strong>Build the inquiry</strong><p>The original question and reference stay together.</p></div></li><li><span>03</span><div><strong>Move the case forward</strong><p>Seller response, quote v2 and an explicit next step.</p></div></li></ol><p className="p-caption">Fictional Fieldwork Equipment case · 200 units, revised to 250 · All prices are examples.</p></div><div className="p-opening-model"><PulleyStage product={product('F-4412')} unit="in" mode={mode} onModeChange={setMode} focus="overview" compact embedded/></div></div>}
        {['inspect','short-inspect'].includes(stage)&&<div className="p-inspection"><section className="p-inspect-copy" ref={inspectionQuestion} tabIndex={-1} aria-label="Current inspection question"><p className="p-check-position">{short?'Mounting check':`${checkIndex+1} of 3 · ${checks[checkIndex].label}`}</p><h2>{checks[short?2:checkIndex].title}</h2><p>{checks[short?2:checkIndex].text}</p><p className="p-catalog-fact">{checks[short?2:checkIndex].facts}</p>{short&&<Question note={original} source="Saved mounting question · Prepared F-4412 case"/>}{!short&&checkIndex>0&&<Button variant="text" onClick={()=>setCheckIndex(i=>i-1)}>Previous check</Button>}</section><div className="p-inspect-scene" data-model-open={modelOpen}><Button variant="secondary" className="p-model-toggle" aria-expanded={modelOpen} onClick={()=>showInspectionModel(!modelOpen)}>{modelOpen?'Close model':'Open illustrative 3D'}</Button><section className="p-model-wrap" ref={inspectionModel} tabIndex={-1} aria-label="F-4412 3D inspection">{(!phoneLayout||modelOpen)&&<PulleyStage product={product('F-4412')} unit="in" mode={mode} onModeChange={setMode} focus={checks[short?2:checkIndex].id} compact embedded autoplayInspection/>}</section></div></div>}
        {stage==='question'&&<div className="p-two-column"><section className="p-paper"><p className="p-section-label">FROM THE MOUNTING CHECK</p><Field label="Question for engineering" textarea rows={4} value={note} onChange={e=>{setNote(e.target.value);commit({...current.current,questionDraft:e.target.value},{quiet:true});}} error={fieldErrors.note}/><p className="n-help">Save explicitly to include this question in the inquiry. Viewing the model alone does not save a requirement.</p></section><aside className="p-context"><h2>Known and still open</h2><p>F-4412 is the candidate. Catalog A, B and D are known.</p><p>Shaft fit, offsets and spacers need review. The example sketch does not supply mounting dimensions.</p></aside></div>}
        {stage==='inquiry'&&<div className="p-two-column"><section className="p-paper"><div className="p-form-grid"><Field label="Requested quantity" unit="units" inputMode="numeric" value={draft.quantity} error={fieldErrors.quantity} onChange={e=>act('update-inquiry',{quantity:e.target.value},true)}/><Field label="Requested delivery" value={draft.timing} error={fieldErrors.timing} onChange={e=>act('update-inquiry',{timing:e.target.value},true)}/><Field label="Finish request" options={Object.entries(FINISHES)} value={draft.finish} onChange={e=>act('update-inquiry',{finish:e.target.value},true)}/><Field label="Application" value={draft.application} error={fieldErrors.application} onChange={e=>act('update-inquiry',{application:e.target.value},true)}/></div><details className="p-details"><summary>Prepared contact and application data</summary><p>{draft.name} · {draft.company} · {draft.email}</p><p>Annual demand: {draft.annual} units. Operating speed and radial load remain unknown.</p></details></section><aside><Question note={original}/><Files files={draft.attachments}/></aside></div>}
        {['inquiry-review','seller-v1','short-inquiry'].includes(stage)&&<div className="p-two-column"><Packet requirements={packet} rfq={rfq}/><aside><Question note={original} source={rfq?`${rfq.id} · Original 3D question`:'Saved in the 3D mounting check'}/><Files files={packet.attachments}/>{stage==='seller-v1'&&<p className="p-handoff-note">The seller sees the same saved inquiry. Preparing a private draft does not issue a quotation.</p>}</aside></div>}
        {['seller-review-v1','seller-review-v2','quote-v1','quote-v2','short-v2'].includes(stage)&&<div className="p-quote-layout"><QuoteCard quote={quoteForReview||q} draft={!!quoteForReview} compact={phoneLayout} questionNote={original}/><aside>{!phoneLayout&&<Question note={original} source={`${rfq?.id} · Still awaiting engineering findings`}/>}{['seller-review-v2','quote-v2','short-v2'].includes(stage)&&<Comparison state={session.state} after={quoteForReview||q}/>}</aside></div>}
        {stage==='change'&&<div className="p-two-column"><section className="p-paper"><div className="p-form-grid"><Field label="Requested quantity" unit="units" inputMode="numeric" value={session.state.revisionDraft.quantity} error={fieldErrors.quantity} onChange={e=>act('update-change',{quantity:e.target.value},true)}/><Field label="Requested delivery window" value={session.state.revisionDraft.timing} error={fieldErrors.timing} onChange={e=>act('update-change',{timing:e.target.value},true)}/><Field label="Reason for the change" textarea rows={4} value={session.state.revisionDraft.message} error={fieldErrors.message} onChange={e=>act('update-change',{message:e.target.value},true)}/></div></section><aside className="p-context"><h2>Source quote · v1</h2><p>{q.id} · {q.requirements.quantity} units</p><strong>{money(q.totals.subtotalCents)} priced subtotal</strong><p>The change is a request. This quote stays unchanged.</p><Question note={original}/></aside></div>}
        {['change-review','seller-v2'].includes(stage)&&<div className="p-two-column"><section className="p-paper"><h2>{stage==='change-review'?'Requested changes':'Saved buyer request'}</h2><Changes state={session.state} reviewing={stage==='change-review'}/><p className="p-caption">The existing proposal stays fixed until the seller explicitly issues v2.</p>{stage==='seller-v2'&&<p className="p-handoff-note">Next: review the proposed response before issuing a revised example quotation.</p>}</section><aside><Question note={original} source="Original question · Retained for engineering"/></aside></div>}
        {finished&&<CompletedCase quote={q} rfq={rfq} original={original} acknowledgement={view.acknowledgement}/>}
        {['plan','plan-review','ack','ack-review'].includes(stage)&&<div className="p-next-layout"><section className="p-paper">
          <p className="p-section-label">{q?.id} · v{q?.version} · ENGINEERING REVIEW</p>
          {stage==='plan'?<Field label="Proposed next step" textarea rows={5} value={session.planMessage} onChange={e=>act('update-plan',{message:e.target.value},true)} error={fieldErrors.message}/>:stage==='ack'?<><Question note={original}/><Field label="Seller acknowledgement" textarea rows={5} value={session.ackMessage} onChange={e=>act('update-ack',{message:e.target.value},true)} error={fieldErrors.message}/></>:<p className="p-reviewed-message">{stage==='plan-review'?session.planMessage:session.ackMessage}</p>}
          <p className="p-caption">Review the exact words before confirming. This requests technical follow-up; it does not approve fit or place an order.</p>
        </section><aside className="p-owner-plan"><h2>Who does what next</h2><div><strong>Customer</strong><p>Supply mounting dimensions, operating speed and radial load.</p></div><div><strong>Engineering</strong><p>Assess shaft fit, spacer offset and zinc suitability against that information.</p></div><div><strong>Seller</strong><p>Coordinate the review and respond with findings and updated terms if needed.</p></div></aside></div>}
        {finished&&<section className="p-capability-appendix" aria-label="Optional demonstration appendix"><div><p className="p-section-label">OPTIONAL · PRESENTATION APPENDIX</p><h2>Explore Annora on desktop and phone.</h2><p>A separate crank sample shows authored motion and Studio customer preview. Your F-4412 case stays unchanged.</p></div><Button variant="text" onClick={()=>setCapabilities(true)}>Open optional capability preview</Button></section>}
      </main>
      <footer className="p-actionbar"><div>{finished?<span><strong>Next: prepare application information</strong><br/>{short?'Prepared replay complete':'Review plan acknowledged · Local example'}</span>:short?<span>Prepared replay · Scene {shortStep+1} of 4</span>:view.nextRole?<span>After confirmation: <strong>{view.nextRole}</strong></span>:<span>{durable?'Saved in this browser':'Session only'} · Local demo</span>}</div><div className="p-action-buttons">{short&&shortStep>0&&<Button variant="text" onClick={()=>commit({...current.current,shortStep:shortStep-1})}>Previous scene</Button>}{editAction&&<Button variant="text" onClick={()=>act(editAction)}>Back to edit</Button>}{stage==='opening'&&<Button variant="secondary" onClick={()=>begin('short')}>3-minute prepared replay</Button>}{finished?<Button variant="secondary" onClick={()=>download(current.current,'NHI-F4412-example-case.json')}>Export example case</Button>:modelOpen&&stage.includes('inspect')?<Button onClick={()=>showInspectionModel(false)}>Back to question</Button>:<Button onClick={mainAction}>{primaryLabel}</Button>}</div></footer>
    </>}
    <div className="p-boundary">Fictional customer and commercial data · Nothing sent to NHI · Model is illustrative, not manufacturer CAD.</div>
  </div>;
}
function CompletedCase({quote:q,rfq,original,acknowledgement}){
  return <div className="p-completion-layout">
    <section className="p-business-next" aria-labelledby="business-next-title">
      <div><p className="p-section-label">YOUR NEXT STEP · CUSTOMER</p><h2 id="business-next-title">Prepare application information.</h2><p>Prepare these details so the seller can coordinate the agreed engineering review.</p></div>
      <dl><div><dt>Mounting</dt><dd>Dimensions, offsets and spacers</dd></div><div><dt>Operating speed</dt><dd>RPM or an application reference</dd></div><div><dt>Radial load</dt><dd>Load data or loading conditions</dd></div></dl>
      <p className="p-business-boundary">Nothing is sent by viewing or exporting this example.</p>
    </section>
    <section className="p-paper p-completed-evidence"><p className="p-section-label">REVIEW PLAN ACKNOWLEDGED · LOCAL EXAMPLE</p>
      <div className="p-result-facts"><div><span>Revised proposal</span><strong>{q.requirements.quantity} units</strong></div><div><span>Priced subtotal · USD</span><strong>{money(q.totals.subtotalCents)}</strong></div></div>
      <Question note={original} source={`${rfq.id} · ${q.id} v2 · Retained in the review plan`}/>
      <details className="p-details"><summary>Saved seller acknowledgement</summary><p>{acknowledgement?.message}</p></details>
      <p className="p-caption">Technical findings, delivery approval and final total remain open.</p>
    </section>
    <section className="p-owner-plan p-completed-owners"><h2>After you provide the information</h2><div><strong>Engineering</strong><p>Assess shaft fit, spacer offset and zinc suitability against that information.</p></div><div><strong>Seller</strong><p>Coordinate the review and respond with findings and updated terms if needed.</p></div></section>
  </div>;
}
function Question({note,source='Saved in 3D · Included in this inquiry'}){return <section className="p-question"><p className="p-section-label">THE ORIGINAL QUESTION</p><blockquote>{note}</blockquote><p>{source}</p></section>;}
function Files({files=[]}){return <details className="p-details p-files"><summary>Attachments · {files.length}</summary>{files.map(f=><div key={f.name}><a href={f.data} download={f.name}>{f.name}</a><p>Example reference · Not an engineering drawing</p></div>)}</details>;}
function Packet({requirements:d,rfq}){return <section className="p-paper"><div className="p-paper-heading"><h2>{rfq?.id||'Inquiry review'}</h2><EvidenceLabel kind="example">Example RFQ</EvidenceLabel></div><p className="p-product-line">F-4412 · Double-flange flat idler</p><dl className="p-packet-facts"><div><dt>Requested quantity</dt><dd>{d.quantity} units</dd></div><div><dt>Requested delivery</dt><dd>{d.timing}</dd></div><div><dt>Finish request</dt><dd>{FINISHES[d.finish]}</dd></div><div><dt>Application</dt><dd>{d.application}</dd></div><div><dt>Prepared for</dt><dd>{d.name} · {d.company}</dd></div></dl><p className="p-caption">Operating speed, load and mounting dimensions remain open. Requested timing and finish require supplier review.</p></section>;}
function QuoteCard({quote:q,draft=false,compact=false,questionNote}){if(!q)return null;return <section className="p-paper p-quote-paper"><div className="p-paper-heading"><h2>{q.id} · v{q.version}</h2><EvidenceLabel kind="example">{draft?'Draft · Not issued':'Example · Not an NHI offer'}</EvidenceLabel></div><p className="p-product-line">F-4412 · {q.requirements.company}</p><div className="p-quote-amount"><span>Priced subtotal · USD</span><strong>{money(q.totals.subtotalCents)}</strong><p>For {q.requirements.quantity} units · Final total pending review</p><p className="p-delivery-outcome">Requested: {q.requirements.timing} · Not confirmed<br/>Proposed: {q.lead}</p></div>{compact&&questionNote&&<Question note={questionNote} source={`${q.rfqId} · Still awaiting engineering findings`}/>}<details className="p-quote-lines" open={!compact}><summary>Quote line items · {q.lines.length}</summary><div className="p-table-scroll"><table><caption className="n-sr-only">Example quote line items</caption><thead><tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{q.lines.map((l,i)=><tr key={i}><td>{l.label}</td><td>{l.qty}</td><td>{money(l.unitCents)}</td><td>{money(l.unitCents===null?null:l.qty*l.unitCents)}</td></tr>)}</tbody></table></div></details><p className="p-caption">Freight and tax are unpriced. A priced finish allowance does not confirm suitability.</p></section>;}
function Comparison({state,after}){const before=state.quotes.find(q=>q.version===1);if(!before||!after||after.version<2)return null;return <section className="p-comparison"><h2>What changed in v2</h2><dl><div><dt>Quoted quantity</dt><dd><span>v1 · {before.requirements.quantity}</span><strong>v2 · {after.requirements.quantity} units</strong></dd></div><div><dt>Base unit price</dt><dd><span>v1 · {money(before.lines[0].unitCents)}</span><strong>v2 · {money(after.lines[0].unitCents)}</strong></dd></div><div><dt>Priced subtotal</dt><dd><span>v1 · {money(before.totals.subtotalCents)}</span><strong>v2 · {money(after.totals.subtotalCents)}</strong></dd></div></dl><p>Requested: {after.requirements.timing} · Not confirmed. Proposed: {after.lead}.</p><p>Mounting and finish suitability remain open.</p></section>;}
function Changes({state,reviewing}){const q=state.quotes.find(q=>q.version===1),r=state.revisions.at(-1),d=state.revisionDraft;const rows=reviewing?[['Quantity',q.requirements.quantity,d.quantity||q.requirements.quantity],['Requested delivery',q.requirements.timing,d.timing||q.requirements.timing]]:(r?.changes||[]).map(c=>[{quantity:'Quantity',timing:'Requested delivery',finish:'Finish request'}[c.field]||c.field,c.before,c.after]);return <><dl className="p-change-rows">{rows.map(([name,b,a])=><div key={name}><dt>{name}</dt><dd><span>Previous: {b}</span><strong>Requested: {a}</strong></dd></div>)}</dl><p className="p-reviewed-message">{reviewing?d.message:r?.message}</p></>;}

createRoot(document.getElementById('app')).render(<App/>);
