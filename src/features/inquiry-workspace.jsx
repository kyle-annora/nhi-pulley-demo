import React,{useState,useRef} from 'react';
import {Button,ActionGroup,Field,Heading,EvidenceLabel,Notice,ChoiceGroup,ActionLink} from '../components/primitives';
import {product,formatDimension,FINISHES,validateDraft,CATALOG} from '../domain.mjs';
import {explorerEvidenceText} from '../explorer-evidence.mjs';
import {explorerInput,explorerDraftChanged} from '../inquiry-adapter.mjs';
import {inquiryDraftContext} from '../inquiry-context.mjs';

const themeNames={belt:'Belt contact',flange:'Flange & diameter',mount:'Mounting area'};
export function inspectionOutcome(state,feature){
  const record=state.draft.explorerRequirements?.find(r=>r.id===`${state.selected}:${feature}`);
  const dirty=explorerDraftChanged(state,feature,explorerInput(state,feature));
  return {record,dirty,label:record?.kind==='review'?'Question saved':record?'Measurement saved':'Not recorded'};
}
export function InquiryEvidence({draft}){
  const entries=[...(draft.explorerRequirements||[])].sort((a,b)=>['belt','flange','mount'].indexOf(a.feature)-['belt','flange','mount'].indexOf(b.feature));
  return <div className="n-inquiry-evidence">{draft.selectionBasis&&<p className="n-help">Selection reasons retained for {draft.selectionBasis.productId}.</p>}{entries.map(r=><div className="n-retained-input" key={r.id}><div className="n-retained-heading"><strong>{themeNames[r.feature]||'Explorer input'}</strong><EvidenceLabel kind={r.kind==='review'?'review':'customer'}>{r.kind==='review'?'Question saved':'Measurement saved'}</EvidenceLabel></div><p>{explorerEvidenceText(r)}</p>{r.note&&<p>{r.note}</p>}{r.kind==='review'&&<p className="n-help">Saved for engineering review · No answer or technical approval recorded.</p>}{r.explorerContext&&<p className="n-help">{r.productId} · {themeNames[r.explorerContext.theme]||'Inspection'} · Illustrative model context retained</p>}</div>)}{!entries.length&&<p className="n-help">No measurements or questions saved yet. Viewing the model does not add a requirement.</p>}</div>;
}
function CarriedExplorerInputs({draft,productId,api}){
  const entries=[...(draft.explorerRequirements||[])].sort((a,b)=>['belt','flange','mount'].indexOf(a.feature)-['belt','flange','mount'].indexOf(b.feature));
  const dimensionNames={width:'D · Width',flat:'B · Running diameter',od:'A · Outside diameter'};
  return <section className="n-worksheet-context" aria-label="Already included from Explorer">
    <div className="n-worksheet-context-head"><div><h2>Already included</h2><p>{productId} · {entries.length?`${entries.length} saved Explorer input${entries.length===1?'':'s'}`:'No inspection input saved'}</p></div><ActionLink href="#explore" onClick={e=>{e.preventDefault();api.navigate('explore');}}>Edit in Explorer</ActionLink></div>
    {entries.length?<dl className="n-worksheet-carried-facts">{entries.map(r=><div key={r.id}><dt>{themeNames[r.feature]||'Explorer input'}</dt><dd>{r.kind==='measurement'?`${dimensionNames[r.dimension]||'Measurement'}: ${r.value} ${r.unit}`:'Review requested'}{r.kind==='measurement'&&<span className="n-help">{r.matchesCatalog?'Catalog value matches · Fit unverified':'Differs from catalog · Review needed'}</span>}</dd></div>)}</dl>:<p className="n-help">You can continue with unknowns. No measurement or question has been added from viewing the model.</p>}
    {(entries.length>0||draft.selectionBasis)&&<details className="n-disclosure"><summary>View saved details & source</summary><InquiryEvidence draft={draft}/></details>}
  </section>;
}
function Section({number,title,description,children}){return <section className="n-form-section"><div className="n-form-section-head"><span className="n-section-number">{number}</span><div><h2>{title}</h2><p className="n-help">{description}</p></div></div>{children}</section>;}
export function ConfigureWorkspace({state,api,initialErrors={}}){
  const [draft,setDraft]=useState(()=>structuredClone(state.draft)),[errors,setErrors]=useState(initialErrors),[fileErrors,setFileErrors]=useState([]),[busy,setBusy]=useState(false),[dragging,setDragging]=useState(false);
  const busyRef=useRef(false),form=useRef(null),p=product(state.selected),context=inquiryDraftContext({...state,draft});
  const validationCount=Object.keys(validateDraft(draft)).length;
  const pendingQuantity=context.pending.flatMap(request=>request.changes||[]).filter(change=>change.field==='quantity').at(-1);
  const update=(key,value)=>{setDraft(d=>({...d,[key]:value}));api.updateInquiry(key,value);setErrors(e=>({...e,[key]:undefined}));};
  const field=(key,label,props={})=><Field key={key} id={`inquiry-${key}`} label={label} name={key} value={draft[key]??''} error={errors[key]} onChange={e=>update(key,e.target.value)} maxLength={props.textarea?3000:300} {...props}/>;
  const submit=e=>{e.preventDefault();if(busyRef.current)return;const next=validateDraft(draft);setErrors(next);if(Object.keys(next).length){requestAnimationFrame(()=>{const field=form.current?.querySelector('[aria-invalid=true]');field?.focus();field?.scrollIntoView({block:'center',behavior:'instant'});});return;}api.navigate('review');};
  const upload=async files=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setFileErrors([]);try{const result=await api.attachFiles(files);setDraft(d=>({...d,attachments:[...result.files]}));setFileErrors(result.errors);}catch{setFileErrors(['Could not read the files. Please try again.']);}finally{busyRef.current=false;setBusy(false);}};
  return <div className="n-inquiry-worksheet">
    <Heading eyebrow={`${p.id} · WORKING DRAFT`} title="Prepare your inquiry." description="Add details for supplier review."><EvidenceLabel kind="example">Example inquiry</EvidenceLabel></Heading>
    <CarriedExplorerInputs draft={draft} productId={p.id} api={api}/>
    <div className="n-draft-relationship">
      <p>{context.quote?'Edits here prepare an inquiry; they do not update saved quotes.':context.rfq?'Edits remain in this draft until you review and save.':'Working draft · Review the complete inquiry before saving.'}</p>
      {context.rfq&&<details className="n-disclosure"><summary>{context.quote?`How this draft relates to quote v${context.quote.version}`:'View saved inquiry context'}</summary><p>Saved inquiry: {context.rfq.id} v{context.rfq.version}. {context.changed?'This draft has changes that are not in the saved inquiry.':'This draft matches the saved inquiry.'}</p>{context.quote&&<><p>Saved quote v{context.quote.version} covers {Number(context.quote.requirements.quantity).toLocaleString('en-US')} units.{pendingQuantity?` A pending request asks for ${Number(pendingQuantity.after).toLocaleString('en-US')} units.`:context.pending.length?` ${context.pending.length} change request${context.pending.length===1?' is':'s are'} awaiting a revised proposal.`:''}</p><p>To change that quote, open it and use its change-request flow.</p><Button variant="text" size="compact" onClick={()=>api.openBuyerQuote(context.quote)}>Open quote v{context.quote.version}</Button></>}</details>}
    </div>
    <form id="n-inquiry-form" ref={form} onSubmit={submit} noValidate className="n-inquiry-layout">
      <div className="n-form-main">
        {Object.values(errors).some(Boolean)&&<Notice title="Check the highlighted fields" kind="error" role="alert">Your entries are kept. Unknown speed and load can stay blank.</Notice>}
        <Section number="01" title="This inquiry" description="Required unless marked optional.">
          <div className="n-field-grid">
            {field('application','Application',{textarea:true,className:'n-span-all',rows:3,'aria-required':true})}
            {field('quantity','Initial order quantity',{inputMode:'numeric',unit:'units','aria-required':true})}
            {field('timing','Requested delivery window',{hint:'If unknown, enter “To be discussed”.','aria-required':true})}
          </div>
          <div className="n-worksheet-additional">{field('annual','Estimated annual quantity',{inputMode:'numeric',unit:'units',optional:true,placeholder:'Unknown'})}</div>
        </Section>
        <Section number="02" title="Application & technical details" description="Add the information and references you have.">
          <div className="n-worksheet-engineering"><p>Unknown speed, load and mounting dimensions can go to engineering review. They do not block this inquiry.</p></div>
          <div className="n-field-grid">
            {field('belt','Belt contact',{options:['Back side of V-belt','Flat belt','Poly-V belt','Cog belt','To be confirmed'].map(x=>[x,x])})}
            {field('mounting','Mounting requirement',{options:['Confirm mounting dimensions','Use existing mounting; dimensions attached','Modified mounting requested'].map(x=>[x,x])})}
          </div>
          <div className="n-worksheet-attachments">
            <div className="n-attachment-heading"><h3>Drawings & references</h3><Button variant="text" size="compact" disabled={busy} onClick={()=>{setDraft(d=>({...d,attachments:api.addSample()}));}}>Add example sketch</Button></div>
            <div className={`n-file-drop ${dragging?'n-dragging':''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);upload([...e.dataTransfer.files]);}}>
              <label htmlFor="inquiry-files">Choose files or drop them here <span className="n-help">Optional</span></label><input id="inquiry-files" type="file" multiple disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.svg,.step,.stp" aria-describedby="inquiry-files-hint inquiry-files-errors" aria-invalid={fileErrors.length?true:undefined} onChange={e=>{upload([...e.target.files]);e.target.value='';}}/>
              <p className="n-help" id="inquiry-files-hint">PDF, PNG, JPG, SVG, STEP · 750 KB per file / 1.5 MB total. Stored locally.</p><div id="inquiry-files-errors" role="alert">{fileErrors.map((error,i)=><p key={i} className="n-error">{error}</p>)}</div><p className="n-help" role="status">{busy?'Reading attachments…':''}</p>
            </div>
            <div className="n-files">{draft.attachments.map((f,i)=><div className="n-file" key={`${f.name}-${i}`}><div><strong>{f.name}</strong><p className="n-help">{f.sample?'Illustrative application sketch':`${Math.ceil(f.size/1024)} KB · Stored locally`}</p></div><ActionGroup><Button variant="text" size="compact" aria-label={`Download ${f.name}`} onClick={()=>api.downloadAttachment(f)} icon="download">Download</Button><Button variant="text" size="compact" disabled={busy} aria-label={`Remove ${f.name}`} onClick={()=>{const files=draft.attachments.filter((_,n)=>n!==i);update('attachments',files);}}>Remove</Button></ActionGroup></div>)}</div>
          </div>
          <div className="n-field-grid n-worksheet-technical-fields">
            {field('finish','Finish request',{options:Object.entries(FINISHES),className:'n-span-all',hint:'A requested finish remains subject to feasibility and pricing review.','aria-required':true})}
            {field('speed','Operating speed',{inputMode:'decimal',unit:'RPM',optional:true,placeholder:'Unknown',hint:'Leave blank if review is needed.'})}
            {field('load','Radial load',{inputMode:'decimal',unit:'lbf',optional:true,placeholder:'Unknown',hint:'Leave blank if review is needed.'})}
            {field('notes',draft.finish==='custom'?'Describe the requested finish':'Notes or requested changes',{textarea:true,optional:draft.finish!=='custom',className:'n-span-all',rows:3,placeholder:'Environment, mounting changes, or another open question…',hint:draft.finish==='custom'?'Required for “Other finish”.':undefined,'aria-required':draft.finish==='custom'||undefined})}
          </div>
        </Section>
        <Section number="03" title="Contact & review" description="Who should receive follow-up about this inquiry?">
          <div className="n-field-grid">{field('name','Contact name',{autoComplete:'name','aria-required':true})}{field('company','Company',{autoComplete:'organization','aria-required':true})}{field('email','Email address',{type:'email',autoComplete:'email',className:'n-span-all','aria-required':true})}</div>
        </Section>
        <div className="n-form-footer n-worksheet-desktop-back"><ActionGroup><ActionLink variant="secondary" href="#explore" onClick={e=>{e.preventDefault();api.navigate('explore');}}>Back to Explorer</ActionLink></ActionGroup><p className="n-help">The next step shows your complete inquiry before you save it.</p></div>
      </div>
      <aside className="n-inquiry-summary" aria-label="Working inquiry summary">
        <p className="n-eyebrow">WORKING INQUIRY</p><h2>{p.id}</h2><p className="n-help">{p.name}</p>
        <dl className="n-request-data">{[['Quantity',`${draft.quantity||'Not entered'}${draft.quantity?' units':''}`],['Requested delivery',draft.timing||'Not entered']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="n-summary-section n-worksheet-readiness"><h3>{validationCount?`${validationCount} field${validationCount===1?' needs':'s need'} attention before review`:'Ready for inquiry review'}</h3><p className="n-help">{validationCount?'Review inquiry will highlight the fields to check.':'Your saved questions will be included. Technical review remains open.'}</p></div>
        <div className="n-worksheet-desktop-action"><Button type="submit" pending={busy} pendingLabel="Reading files…">Review inquiry</Button><p className="n-help">Local demo · Review before saving. No message is sent.</p></div>
      </aside>
    </form>
    <div className="n-worksheet-mobile-action" aria-label="Next step"><ActionGroup><ActionLink href="#explore" onClick={e=>{e.preventDefault();api.navigate('explore');}}>Back to Explorer</ActionLink><Button type="submit" form="n-inquiry-form" pending={busy} pendingLabel="Reading files…">Review inquiry</Button></ActionGroup><p className="n-help">Local demo · Review before saving. No message sent.</p></div>
  </div>;
}
export const inspectionCopy={
  belt:{question:'Does the running surface match your reference?',instruction:'Measure D across the flat belt-running surface of your existing pulley, or read D from its drawing. This field records pulley width, not belt width.',keys:[['width','D','Belt-running width'],['flat','B','Belt-running diameter']],scope:'B is the running diameter. To request a B check, add a question and choose Request review. This captures a question instead of a D measurement.'},
  flange:{question:'Does the outside diameter match your reference?',instruction:'Measure A across the outer flange edges of your existing pulley, or use its drawing. Describe available space or clearance limits in the note.',keys:[['od','A','Outside diameter'],['flat','B','Belt-running diameter']],scope:'A is the overall flange diameter. A dimensional match does not confirm installation clearance.'},
  mount:{question:'What needs checking at the mounting point?',instruction:'Describe the bore, mounting offsets, spacers or application details engineering should check. Attach your drawing on the inquiry page.',keys:[],scope:'The hub is illustrative. No bore, offset or spacer dimension is verified by this model.'}
};
export function ExplorerRequirements({state,api,focus,hideFeatureChoices=false,compact=false,hideQuestion=false,onSaved,formId,submitLabel,continueLabel,continueWithoutSave=false,onContinue}){
  const p=product(state.selected),[unitError,setUnitError]=useState(''),copy=inspectionCopy[focus],outcome=copy?inspectionOutcome(state,focus):null;
  const switchUnit=unit=>{const result=api.changeUnit(unit);if(result?.error)setUnitError(result.error);else setUnitError('');};
  const dimensionKeys=copy?copy.keys:[['od','A','Outside diameter'],['flat','B','Belt-running diameter'],['width','D','Belt-running width']];
  return <div className={`n-explorer-panel${compact?' n-inspection-task':''}`}>{!hideQuestion&&<div className="n-inspection-question"><p className="n-eyebrow">{copy?`${themeNames[focus]} · Your check`:'YOUR INSPECTION'}</p><h2>{copy?.question||'Start with a question about this candidate.'}</h2>{!compact&&outcome&&<EvidenceLabel kind={outcome.record?.kind==='review'?'review':outcome.record?'customer':'source'}>{outcome.label}</EvidenceLabel>}<p>{copy?.instruction||'Choose a theme, compare your reference and save what you want included in the inquiry.'}</p></div>}
  {!compact&&dimensionKeys.length>0&&<><div className="n-unit-switch"><EvidenceLabel>Catalog reference</EvidenceLabel><ChoiceGroup variant="segmented" label="Dimension units" value={state.unit} onChange={switchUnit} choices={[{value:'in',label:'in'},{value:'mm',label:'mm'}]}/></div>{unitError&&<p className="n-error" role="alert">{unitError}</p>}<dl className="n-catalog-dimensions">{dimensionKeys.map(([key,letter,label])=><div key={key}><dt><b>{letter}</b>{label}</dt><dd>{formatDimension(p,key,state.unit)}</dd></div>)}</dl></>}
  {p.model?<>{!hideFeatureChoices&&<ChoiceGroup className="n-feature-choices" label="Pulley detail" value={focus} onChange={api.focusFeature} choices={[{value:'belt',label:'1 · Belt contact'},{value:'flange',label:'2 · Flange & diameter'},{value:'mount',label:'3 · Mounting area'}]}/>}{copy?<><RequirementCapture key={`${p.id}:${focus}${compact?'':`:${state.unit}`}`} state={state} api={api} feature={focus} compact={compact} onSaved={onSaved} formId={formId} submitLabel={submitLabel} continueLabel={continueLabel} continueWithoutSave={continueWithoutSave} onContinue={onContinue} switchUnit={switchUnit} unitError={unitError}/>{!compact&&<p className="n-help n-inspection-scope">{copy.scope}</p>}</>:<Button variant="secondary" onClick={()=>api.focusFeature('belt')}>Start with belt contact</Button>}</>:<Notice>This candidate uses catalog dimensions. Reconstructed 3D is available for F-4412.</Notice>}
  {!hideFeatureChoices&&<div className="n-explorer-next"><ActionLink variant="primary" icon="arrow" href="#configure" onClick={e=>{e.preventDefault();api.navigate('configure');}}>Configure & inquire</ActionLink></div>}
  </div>;
}
function RequirementCapture({compact=false,...props}){
  return compact?<CompactRequirementCapture {...props}/>:<LegacyRequirementCapture {...props}/>;
}
function CompactRequirementCapture({state,api,feature,onSaved,formId,submitLabel,continueLabel,continueWithoutSave=false,onContinue,switchUnit,unitError}){
  const initial=state.draft.explorerRequirements?.find(r=>r.id===`${state.selected}:${feature}`);
  const [draft,setDraft]=useState(()=>explorerInput(state,feature)),[error,setError]=useState(''),[saved,setSaved]=useState(initial),[mode,setMode]=useState(()=>{const retained=explorerInput(state,feature).mode;return feature==='mount'?'review':['measurement','review'].includes(retained)?retained:initial?.kind==='review'?'review':'measurement';}),root=useRef(null);
  const dimension=feature==='belt'?'width':feature==='flange'?'od':null,p=product(state.selected);
  // Unit conversion remains owned by the existing adapter. Keep the chosen input
  // mode while that adapter updates the working draft and displayed unit.
  const currentDraft=draft.unit===state.unit?draft:explorerInput(state,feature);
  const dirty=explorerDraftChanged({...state,draft:{...state.draft,explorerRequirements:saved?[saved]:[]}},feature,currentDraft);
  const canContinue=Boolean(continueWithoutSave&&saved&&!dirty&&onContinue);
  const update=(key,value)=>{const next={...currentDraft,[key]:value};setDraft(next);setError('');api.updateExplorerDraft(feature,next);};
  const chooseMode=value=>{setMode(value);update('mode',value);};
  const save=e=>{
    e.preventDefault();
    // A clean saved check continues without writing another requirement. Local
    // dirty state remains authoritative if a parent continuation flag is stale.
    if(canContinue){onContinue();return;}
    const unknown=mode==='review',result=api.saveExplorer(feature,currentDraft,unknown);
    if(result.error){setError(result.error);requestAnimationFrame(()=>{const field=root.current?.querySelector('[aria-invalid=true]');field?.focus();field?.scrollIntoView({block:'center',behavior:'instant'});});return;}
    setSaved(result.saved);setDraft({...currentDraft,mode:unknown?'review':'measurement',value:unknown?'':currentDraft.value});setError('');onSaved?.(result);
  };
  const outcome=dirty?'Unsaved changes · save to include in your inquiry.':saved?.kind==='review'?'Question saved to inquiry draft · not sent.':saved?.kind==='measurement'?saved.matchesCatalog?'Measurement saved · catalog match; fit unverified.':'Measurement saved · differs from catalog; review needed.':'Not yet included in your inquiry.';
  const noteHint=mode==='measurement'?'Name the measured part or drawing.':dimension?feature==='belt'?'Ask about D width, B running diameter or belt contact.':'Ask about A diameter or installation clearance.':'Bore, offsets and spacers remain unverified. Add a drawing at inquiry.';
  return <form id={formId} className="n-capture n-inspection-task-form" ref={root} aria-label={`${themeNames[feature]} input`} onSubmit={save} noValidate>
    {dimension&&<ChoiceGroup variant="segmented" className="n-inspection-mode" label="How to record this check" value={mode} onChange={chooseMode} choices={[{value:'measurement',label:'Record measurement'},{value:'review',label:'Ask engineering'}]}/>}
    {mode==='measurement'&&<>
      <div className="n-inspection-reference"><p><span>Catalog reference</span><strong>{dimension==='width'?'D':'A'} · {formatDimension(p,dimension,state.unit)}</strong></p><ChoiceGroup variant="segmented" className="n-inspection-units" label="Dimension units" value={state.unit} onChange={switchUnit} choices={[{value:'in',label:'in'},{value:'mm',label:'mm'}]}/></div>
      {unitError&&<p className="n-error" role="alert">{unitError}</p>}
      <Field id="explorer-measurement" label={dimension==='width'?'Pulley running width · D':'Pulley outside diameter · A'} unit={state.unit} inputMode="decimal" value={currentDraft.value} error={error} onChange={e=>update('value',e.target.value)} hint={dimension==='width'?'Measure the pulley, not the belt. Decimal or fraction.':'Measure outer flange edges. Decimal or fraction.'}/>
    </>}
    <Field id="explorer-note" label={mode==='measurement'?'Measurement source or note':'Review requested'} optional textarea rows={mode==='measurement'?2:3} maxLength={1000} value={currentDraft.note} error={mode==='review'?error:undefined} hint={noteHint} onChange={e=>update('note',e.target.value)}/>
    {mode==='review'&&<p className="n-help n-inspection-review-scope">{dimension&&saved?.kind==='measurement'?'Saving this request replaces the current inquiry’s measurement for this check.':'Unknown dimensions are OK. Saving adds this question to your inquiry draft.'}</p>}
    <p className="n-inspection-save-state" data-state={dirty?'unsaved':saved?'saved':'empty'} role="status">{outcome}</p>
    <div className="n-inspection-submit"><Button type="submit">{canContinue?(continueLabel||'Continue'):(submitLabel||(mode==='measurement'?'Save measurement':'Save question'))}</Button></div>
  </form>;
}
function LegacyRequirementCapture({state,api,feature,onSaved}){
  const [draft,setDraft]=useState(()=>explorerInput(state,feature)),[error,setError]=useState(''),[saved,setSaved]=useState(()=>state.draft.explorerRequirements?.find(r=>r.id===`${state.selected}:${feature}`)),[dirty,setDirty]=useState(()=>explorerDraftChanged(state,feature,explorerInput(state,feature))),root=useRef(null);
  const dimension=feature==='belt'?'width':feature==='flange'?'od':null;
  const update=(key,value)=>{const next={...draft,[key]:value};setDraft(next);setDirty(true);setError('');api.updateExplorerDraft(feature,next);};
  const save=(unknown=false)=>{const result=api.saveExplorer(feature,draft,unknown);if(result.error){setError(result.error);requestAnimationFrame(()=>{const field=root.current?.querySelector('[aria-invalid=true]');field?.focus();field?.scrollIntoView({block:'center',behavior:'instant'});});return;}setSaved(result.saved);if(unknown)setDraft(d=>({...d,value:''}));setDirty(false);setError('');onSaved?.(result);};
  return <section className="n-capture" ref={root} aria-label={`${themeNames[feature]} input`}>
    {dimension&&<Field id="explorer-measurement" label={dimension==='width'?'Your pulley width · D':'Your pulley outside diameter · A'} unit={state.unit} inputMode="decimal" value={draft.value} error={error} onChange={e=>update('value',e.target.value)} hint={`Existing pulley or drawing. Decimal or fraction, e.g. ${dimension==='width'?'3/4':'3-1/8'}. Leave blank to request review.`}/>}
    <Field id="explorer-note" label={dimension?'Measurement source or review question':'What should engineering check?'} optional textarea rows={3} maxLength={1000} value={draft.note} hint={dimension?'Name the drawing or measured part. For a question, choose Not sure · request review below.':'A question is saved even if the mounting dimensions are unknown.'} onChange={e=>update('note',e.target.value)}/>
    {!dimension&&error&&<p className="n-error" role="alert">{error}</p>}
    <ActionGroup stack>{dimension&&<Button onClick={()=>save()}>Save measurement</Button>}<Button variant={dimension?'secondary':'primary'} onClick={()=>save(true)}>{dimension?'Not sure · request review':'Save mounting review request'}</Button></ActionGroup>
    {dirty&&<p className="n-help" role="status">Unsaved edits · Save a measurement or request review to include these changes.</p>}
    {saved&&<Notice kind={saved.kind==='review'?'review':'saved'} title={dirty?'Previously saved input':saved.kind==='review'?'Question saved':'Measurement saved'} role="status"><p>{explorerEvidenceText(saved)}</p>{saved.note&&<p>{saved.note}</p>}<p className="n-help">{saved.kind==='measurement'?'Included in your inquiry · Fit remains unverified.':'Included in your inquiry draft · No request sent.'}</p></Notice>}
  </section>;
}
