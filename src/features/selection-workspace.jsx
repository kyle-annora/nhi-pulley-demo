import React,{useEffect,useRef,useState} from 'react';
import {ChoiceGroup,Field,Button,ActionGroup,ActionLink,EvidenceLabel,Notice} from '../components/primitives';
import {product,findProducts,formatDimension,CATALOG,activeRFQ,hasDraftChanges} from '../domain.mjs';
import {DIMENSION_NAMES,assessCandidate,rankedCandidates} from '../journey.mjs';
import {convertSelectionDimensions,validateSelectionDimensions} from '../selection-adapter.mjs';
import {PulleyStage,INSPECTION_THEMES} from './pulley-stage';
import {ExplorerRequirements,inspectionOutcome,inspectionCopy} from './inquiry-workspace';
import {explorerEvidenceText} from '../explorer-evidence.mjs';
import {MOUNTING_QUESTION} from '../walkthrough-flow.mjs';

const taskInstruction={belt:'Compare the D width of your existing pulley or its drawing.',flange:'Compare the outside diameter; note any installation clearance limit.',mount:'Record the bore, spacer or offset question for engineering.'};

export function PulleyDimensions({candidate,unit}){return <dl className="n-pulley-dimensions">{Object.entries(DIMENSION_NAMES).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{formatDimension(candidate,key,unit)}</dd></div>)}</dl>;}
function CandidateReason({candidate,context}){
  const assessment=assessCandidate(candidate,context);
  return <details className="n-room-disclosure n-room-reason"><summary><span>Why consider {candidate.id}?</span><span className="n-help">{assessment.dimensions.length?`${assessment.matches}/${assessment.dimensions.length} dimensions match`:'Catalog candidate'}</span></summary><div><dl className="n-candidate-evidence">{assessment.dimensions.map(d=><div key={d.key}><dt>{d.label}</dt><dd><span>Your input: {d.input} {d.unit}</span><span>Catalog: {d.catalog}</span><strong>{!d.valid?'Check input':d.matches?'Matches catalog':'Differs · review needed'}</strong></dd></div>)}</dl><p className="n-help">{context.purpose||'Sourcing purpose unknown'} · {context.belt||'Belt contact unknown'}. Mounting, speed, load and application fit still need review.</p></div></details>;
}

// One room owns the physical viewer. Changing between selection and inspection
// changes the adjacent task, not the PulleyStage instance or the saved case.
export function ProductRoomWorkspace({state,api,route=state.step,routeParams={}}){
  const converted=convertSelectionDimensions(state.discovery,state.unit),initial=converted.error?state.discovery:converted.context;
  const [current,setCurrent]=useState(state),[method,setMethod]=useState(state.findMode||'part'),[context,setContext]=useState(()=>({...initial})),[unit,setUnit]=useState(state.unit),[filters,setFilters]=useState({part:'',od:'',flat:'',width:''}),[candidateId,setCandidateId]=useState(state.selected),[mode,setMode]=useState(state.mode),[focus,setFocus]=useState(route==='explore'&&product(state.selected).model?'belt':'overview'),[errors,setErrors]=useState({}),[issue,setIssue]=useState(''),[comparisonOpen,setComparisonOpen]=useState(false),[summaryOpen,setSummaryOpen]=useState(false),[lastSaved,setLastSaved]=useState(''),[mobileModelOpen,setMobileModelOpen]=useState(false);
  const [showReveal,setShowReveal]=useState(()=>!!api.walkthroughMode&&(!state.draft.explorerRequirements?.some(r=>r.feature==='mount')||routeParams.presentation==='1'));
  const finder=useRef(null),taskHeading=useRef(null),savedPanel=useRef(null),themeMenu=useRef(null),previous=useRef({route,selected:state.selected,unit:state.unit});
  const selecting=route==='select',inspecting=!selecting;
  const candidate=product(selecting?candidateId:current.selected),guided=method==='guided',dimensional=method!=='part';
  const results=guided?rankedCandidates(context):findProducts({...filters,part:method==='part'?filters.part:'',od:method==='dimensions'?filters.od:'',flat:method==='dimensions'?filters.flat:'',width:method==='dimensions'?filters.width:'',unit}).map(p=>({product:p}));
  const outcomes=INSPECTION_THEMES.map(theme=>({...theme,...inspectionOutcome(current,theme.id)})),chapter=INSPECTION_THEMES.findIndex(theme=>theme.id===focus),active=outcomes[chapter],saved=outcomes.filter(item=>item.record).length,unsaved=outcomes.filter(item=>item.dirty).length;
  const question=inspectionCopy[focus],rfq=activeRFQ(current),outsideSearch=!results.some(x=>x.product.id===candidateId);

  useEffect(()=>{
    setCurrent(state);setMode(state.mode);
    if(previous.current.selected!==state.selected)setCandidateId(state.selected);
    if(previous.current.unit!==state.unit){
      const previousUnit=previous.current.unit;
      setContext(value=>{const result=convertSelectionDimensions(value,state.unit);return result.error?value:result.context;});
      setFilters(value=>{const result=convertSelectionDimensions({...value,unit:value.unit||previousUnit},state.unit);return result.error?value:result.context;});
    }
    setUnit(state.unit);
    if(previous.current.route!==route&&route==='explore'){
      setSummaryOpen(false);
      if(!INSPECTION_THEMES.some(theme=>theme.id===focus))setFocus(product(state.selected).model?'belt':'overview');
    }
    previous.current={route,selected:state.selected,unit:state.unit};
  },[state,route]);

  useEffect(()=>{if(api.walkthroughMode&&routeParams.presentation==='1')setShowReveal(true);},[routeParams]);

  const focusTask=()=>requestAnimationFrame(()=>{taskHeading.current?.focus({preventScroll:true});if(window.matchMedia('(max-width: 900px)').matches)taskHeading.current?.scrollIntoView({block:'start',behavior:'instant'});});
  const focusError=()=>requestAnimationFrame(()=>{const field=finder.current?.querySelector('[aria-invalid=true]');field?.focus();field?.scrollIntoView({block:'center',behavior:'instant'});});
  const updateContext=(key,value)=>{const next={...context,[key]:value};setContext(next);api.updateDiscovery(next);setErrors(e=>({...e,[key]:undefined}));setIssue('');};
  const chooseMethod=value=>{setMethod(value);api.setFindMode(value);setErrors({});setIssue('');};
  const adoptState=result=>{if(result?.state&&!result.error){setCurrent(result.state);setUnit(result.state.unit);}return result;};
  const prepareComparisonUnit=value=>{
    const discovery=convertSelectionDimensions(context,value),search=convertSelectionDimensions({...filters,unit:filters.unit||unit},value);
    if(!discovery.error&&!search.error)return {discovery,search};
    const failed=discovery.error?discovery:search;
    setComparisonOpen(true);chooseMethod(discovery.error?'guided':'dimensions');setErrors(failed.errors);
    const error='Correct or clear the highlighted dimensions in Product details · Find or compare a pulley before changing units. Your current unit is unchanged.';
    setIssue(error);return {error,errors:failed.errors};
  };
  const switchUnit=value=>{
    const prepared=prepareComparisonUnit(value);if(prepared.error){focusError();return;}
    const {discovery,search}=prepared;
    const result=adoptState(api.changeUnit(value));if(result.error){setIssue(result.error+' Open the inspection to correct the measurement.');return;}
    setContext(discovery.context);api.updateDiscovery(discovery.context);setFilters(search.context);setUnit(value);setIssue('');setErrors({});
  };
  const compare=e=>{e?.preventDefault();const next=validateSelectionDimensions(guided?context:filters);setErrors(next);if(Object.keys(next).length){setIssue('Check the highlighted measurements. Unknown dimensions can stay blank.');focusError();}else setIssue('');};
  const continueInspection=()=>{
    if(dimensional){const next=validateSelectionDimensions(guided?context:filters);if(Object.keys(next).length){setComparisonOpen(true);setErrors(next);setIssue('Check the highlighted measurements before continuing.');focusError();return;}}
    const result=adoptState(api.selectForInquiry(candidateId,method,context));if(result.error){setErrors(result.errors||{});setIssue(result.error);focusError();return;}
    setFocus(candidate.model?'belt':'overview');setSummaryOpen(false);setLastSaved('');api.navigate('explore');
  };
  const setView=value=>{setMode(value);api.setViewerMode(value);};
  const focusFeature=key=>{if(!selecting&&key==='overview')return;setFocus(key);if(!selecting)api.recordViewed(key);};
  const goToTheme=key=>{setCandidateId(current.selected);setMobileModelOpen(false);focusFeature(key);setLastSaved('');if(themeMenu.current)themeMenu.current.open=false;if(selecting)api.navigate('explore');focusTask();};
  const showSummary=()=>{setSummaryOpen(true);setMobileModelOpen(false);requestAnimationFrame(()=>{savedPanel.current?.querySelector('summary')?.focus();savedPanel.current?.scrollIntoView({block:'start',behavior:'instant'});});};
  const advance=()=>{if(chapter>=0&&chapter<2)goToTheme(INSPECTION_THEMES[chapter+1].id);else api.navigate('configure');};
  const explorerApi={...api,focusFeature,changeUnit:value=>{
    const prepared=prepareComparisonUnit(value);if(prepared.error)return prepared;
    const result=adoptState(api.changeUnit(value));
    if(!result.error){setContext(prepared.discovery.context);api.updateDiscovery(prepared.discovery.context);setFilters(prepared.search.context);setIssue('');setErrors({});}
    return result;
  },updateExplorerDraft:(feature,draft)=>{api.updateExplorerDraft(feature,draft);setCurrent(value=>({...value,explorerDrafts:{...value.explorerDrafts,[`${value.selected}:${feature}`]:{...draft,unit:value.unit}}}));},saveExplorer:(...args)=>adoptState(api.saveExplorer(...args))};
  const onSaved=()=>{const name=INSPECTION_THEMES[chapter]?.shortLabel||'Input';advance();setLastSaved(`${name} saved to your inquiry.`);};
  const sample=()=>{const next=convertSelectionDimensions({purpose:'Replace an existing pulley',belt:'Back side of V-belt',od:'3-1/8',flat:'2-3/4',width:'3/4',unit:'in'},unit).context;setContext(next);api.updateDiscovery(next);setErrors({});setIssue('Example measurements loaded · sample customer inputs, not an engineering specification.');};
  const selectTask=()=>{setLastSaved('');setFocus('overview');setMobileModelOpen(false);api.navigate('select');};
  const returnToQuestion=()=>{setMobileModelOpen(false);focusTask();};
  const nextLabel=chapter===0?'diameter':chapter===1?'mounting':null;
  const saveLabel=nextLabel?`Save & check ${nextLabel}`:'Save & prepare inquiry';
  const continueLabel=nextLabel?`Continue to ${nextLabel}`:'Prepare inquiry';

  const leaveReveal=({theme='mount',intent='leave'}={})=>{
    const retained=current.explorerDrafts?.[`${current.selected}:mount`];
    if(intent==='use'&&!retained?.note?.trim())explorerApi.updateExplorerDraft('mount',{mode:'review',value:'',note:MOUNTING_QUESTION,unit});
    setFocus(theme);setShowReveal(false);setMobileModelOpen(false);focusTask();
  };
  if(api.walkthroughMode&&showReveal&&candidate.model)return <div className="n-wt-product-reveal">
    <div className="n-wt-product-title"><h1 id="page-title" tabIndex="-1">F-4412</h1><p>Double-flange flat idler · Guided inspection</p></div>
    <PulleyStage product={candidate} unit={unit} mode={mode} focus="overview" compact embedded guidedReveal onModeChange={setView} onFailure={()=>setView('static')} onRevealComplete={leaveReveal}/>
    {mode!=='3d'&&<div className="n-reveal-drawing-continue"><p>The catalog drawing remains available. You can record a question without 3D.</p><Button onClick={()=>leaveReveal({theme:'mount'})}>Open mounting question</Button></div>}
  </div>;

  return <div className="n-product-room n-room-workspace" data-model-open={mobileModelOpen} data-mobile-model-open={mobileModelOpen}>
    <header className="n-room-header"><div className="n-room-identity"><div className="n-room-title-line"><h1 id="page-title" tabIndex="-1">{candidate.id}</h1><span className="n-room-series">A Series</span>{selecting&&candidateId!==current.selected&&<EvidenceLabel kind="customer">Candidate preview</EvidenceLabel>}</div><p>{candidate.name}</p></div>
      <div className="n-room-utilities">{inspecting&&<Button variant="text" onClick={selectTask}>Product details</Button>}<Button variant="text" onClick={showSummary}>Saved requirements · {saved}</Button></div>
      <p className="n-room-draft-context">Working inquiry{rfq?` · ${hasDraftChanges(current)?`Changes not included in ${rfq.id}`:`Based on ${rfq.id}`}`:' · Not yet saved as an RFQ'}.</p>
    </header>
    <div className="n-room-layout">
      <div className="n-room-task-heading" ref={taskHeading} tabIndex="-1">
        {selecting?<><p className="n-eyebrow">PRODUCT & REQUIREMENTS</p><h2>Is this the right pulley?</h2><p className="n-help">Compare the catalog, then record the fit questions for your application.</p></>:<>
          {candidate.model&&<div className="n-room-check-location"><span>Check {chapter<0?'—':chapter+1} of 3 · {INSPECTION_THEMES[chapter]?.shortLabel||'Whole pulley'}</span><details className="n-room-theme-menu" ref={themeMenu}><summary>Change check</summary><div>{outcomes.map((item,index)=><button type="button" key={item.id} aria-current={focus===item.id?'step':undefined} onClick={()=>goToTheme(item.id)}><span>{index+1}. {item.shortLabel}</span><small>{item.dirty?'Unsaved edits':item.label}</small></button>)}</div></details></div>}
          <h2>{question?.question||'Review this catalog candidate.'}</h2><p className="n-help">{taskInstruction[focus]||'Compare the catalog dimensions and add any application questions to your inquiry.'}</p>
        </>}
        {inspecting&&question?.keys.length>0&&<p className="n-room-catalog-reference">Catalog reference: {question.keys.map(([key,letter,label])=>`${letter} ${label.toLowerCase()} ${formatDimension(candidate,key,unit)}`).join(' · ')}</p>}
        {lastSaved&&<p className="n-room-save-status" role="status">{lastSaved}</p>}
      </div>
      <div className="n-room-scene" data-inspection={true} data-model-open={mobileModelOpen}>
        <div className="n-room-model-toggle"><Button variant="text" aria-expanded={mobileModelOpen} aria-controls="n-room-model-content" onClick={()=>setMobileModelOpen(value=>!value)}>{mobileModelOpen?'Close':'Open'} {candidate.model&&mode==='3d'?'illustrative 3D':'catalog schematic'}</Button></div>
        <div className="n-room-model-content" id="n-room-model-content"><PulleyStage product={candidate} unit={unit} mode={mode} focus={focus} onFocus={focusFeature} onModeChange={setView} onFailure={()=>setView('static')} compact embedded/>
        <div className="n-room-model-context"><ActionLink href={CATALOG} target="_blank" rel="noreferrer">NHI source catalog · page 6</ActionLink></div>
        </div>
      </div>
      {mobileModelOpen&&<div className="n-room-model-return"><Button onClick={returnToQuestion}>{selecting?'Back to product details':'Back to question'}</Button></div>}
      <section className="n-room-task" aria-label={selecting?'Select a pulley':'Current inspection input'}>
        {selecting?<>
          <div className="n-room-reference-head"><EvidenceLabel>Public catalog</EvidenceLabel><ChoiceGroup variant="segmented" label="Selection dimension units" value={unit} onChange={switchUnit} choices={[{value:'in',label:'in'},{value:'mm',label:'mm'}]}/></div><PulleyDimensions candidate={candidate} unit={unit}/>
          <details className="n-room-disclosure n-room-comparison" open={comparisonOpen} onToggle={e=>setComparisonOpen(e.currentTarget.open)}><summary><span>Find or compare a pulley</span><span className="n-help">3 sample candidates</span></summary>
            <div ref={finder}><ChoiceGroup variant="segmented" className="n-room-methods" label="Selection method" value={method} onChange={chooseMethod} choices={[{value:'part',label:'Part no.'},{value:'guided',label:'Guided'},{value:'dimensions',label:'Dimensions'}]}/>
              <form onSubmit={compare} noValidate className="n-room-finder-form">
                {method==='part'?<Field id="selection-part" label="Part number" value={filters.part} placeholder="e.g. F-4412" onChange={e=>setFilters(f=>({...f,part:e.target.value}))} autoComplete="off" spellCheck={false}/>:<>
                  {guided&&<div className="n-selection-context"><Field label="What are you sourcing?" value={context.purpose} options={['Not sure yet','Replace an existing pulley','New application'].map((x,i)=>[i?x:'',x])} onChange={e=>updateContext('purpose',e.target.value)}/><Field label="What contacts the pulley?" value={context.belt} options={['Not sure yet','Back side of V-belt','Flat belt','Poly-V belt','Cog belt'].map((x,i)=>[i?x:'',x])} onChange={e=>updateContext('belt',e.target.value)}/></div>}
                  <p className="n-help">Your drawing or measured dimensions. Unknowns can stay blank.</p><div className="n-room-comparison-fields">{Object.entries(DIMENSION_NAMES).map(([key,label])=><Field key={key} id={`selection-${key}`} label={label} value={(guided?context:filters)[key]} unit={unit} error={errors[key]} inputMode="decimal" placeholder="Unknown" onChange={e=>{if(guided)updateContext(key,e.target.value);else{setFilters(f=>({...f,[key]:e.target.value}));setErrors(v=>({...v,[key]:undefined}));setIssue('');}}}/>)}</div>
                  <ActionGroup><Button type="submit" variant="secondary">Compare</Button>{guided&&<Button variant="text" onClick={sample}>Example inputs</Button>}</ActionGroup>
                </>}
              </form>
              <div className="n-room-results-head"><h3>Catalog candidates</h3><span className="n-help" role="status">{results.length} found</span></div>
              {results.length?<ChoiceGroup className="n-room-candidates" label="Pulley candidate preview" value={candidateId} onChange={id=>{setCandidateId(id);setFocus('overview');}} choices={results.map(({product:p,assessment})=>({value:p.id,label:<span className="n-room-candidate"><span><strong>{p.id}</strong><span>{p.feature}</span></span><span className="n-room-candidate-dimensions">A {formatDimension(p,'od',unit)}<br/>D {formatDimension(p,'width',unit)}</span>{assessment&&<small>{assessment.status}</small>}</span>}))}/>:<Notice title="No exact match"><p>Adjust the search or compare all three candidates.</p><Button variant="text" onClick={()=>{setFilters({part:'',od:'',flat:'',width:''});setErrors({});setIssue('');}}>Clear search</Button></Notice>}
              <p className="n-help n-room-preview-note">Previewing a candidate does not change your inquiry.</p>
            </div>
          </details>
          {guided&&<CandidateReason candidate={candidate} context={context}/>}
          {issue&&<Notice kind={Object.values(errors).some(Boolean)?'error':issue.startsWith('Example')?'example':'neutral'} role={Object.values(errors).some(Boolean)?'alert':'status'}>{issue}</Notice>}
          {candidateId!==current.selected&&<Notice title={`Your inquiry currently uses ${current.selected}`}>Using {candidateId} replaces the draft product measurements and selection reasons. Saved RFQs and quotes remain unchanged.</Notice>}
          <div className="n-room-primary-action">{outsideSearch&&<p className="n-error">Choose a matching candidate or clear the search before continuing.</p>}<div className="n-room-action-button"><Button disabled={outsideSearch} onClick={continueInspection}>{candidateId===current.selected?'Check fit questions':`Use ${candidateId} & check fit`}</Button></div><p className="n-help">Catalog dimensions are a starting point. Application fit needs review.</p></div>
          <ActionLink href="#configure" onClick={e=>{e.preventDefault();api.navigate('configure');}}>Prepare inquiry · {current.selected}</ActionLink>
        </>:<>
          <ExplorerRequirements state={current} api={explorerApi} focus={focus} hideFeatureChoices compact hideQuestion formId="n-room-inspection-form" submitLabel={saveLabel} continueLabel={continueLabel} continueWithoutSave onContinue={advance} onSaved={onSaved}/>
          {candidate.model&&chapter>=0?<div className="n-room-check-footer">{(!active?.record||active?.dirty)&&<Button variant="text" onClick={advance}>{active?.dirty?'Skip without saving':'Skip this check'}</Button>}{chapter<2&&<ActionLink href="#configure" onClick={e=>{e.preventDefault();api.navigate('configure');}}>Prepare inquiry now</ActionLink>}</div>:<div className="n-room-primary-action"><ActionLink variant="primary" href="#configure" onClick={e=>{e.preventDefault();api.navigate('configure');}}>Prepare inquiry</ActionLink></div>}
        </>}
        <details className="n-room-disclosure n-room-saved-disclosure" ref={savedPanel} open={summaryOpen} onToggle={e=>setSummaryOpen(e.currentTarget.open)}>
          <summary><span>Saved requirements for {current.selected}</span><span className="n-help">{saved} saved{unsaved?` · ${unsaved} unsaved`:''}</span></summary>
          <div><p className="n-help">These measurements and questions will be included when you save the inquiry. Saved RFQs and quotes stay unchanged. No engineering response is recorded here.</p>
          <div className="n-room-saved-list">{outcomes.map(item=><div key={item.id} className="n-room-saved-item"><div className="n-room-saved-item-heading"><h3>{item.shortLabel}</h3><Button variant="text" size="compact" aria-label={`Edit ${item.shortLabel}`} onClick={()=>{setSummaryOpen(false);goToTheme(item.id);}}>Edit</Button></div><EvidenceLabel kind={item.record?.kind==='review'?'review':item.record?'customer':'source'}>{item.label}</EvidenceLabel>{item.record?<>{item.record.kind==='measurement'&&<p>{explorerEvidenceText(item.record)}</p>}{item.record.note&&<p className="n-room-original-note">{item.record.note}</p>}</>:<p className="n-help">No input saved. This check can remain open.</p>}{item.dirty&&<p className="n-help">Unsaved edits are retained but are not included.</p>}</div>)}</div>
          {unsaved>0&&<p className="n-help">Continue with the saved inputs, or edit a check to save its latest changes.</p>}</div>
        </details>
      </section>
    </div>
  </div>;
}

// Compatibility exports; the host maps both routes directly to ProductRoomWorkspace.
export function SelectionWorkspace(props){return <ProductRoomWorkspace {...props} route="select"/>;}
export function ExplorerWorkspace(props){return <ProductRoomWorkspace {...props} route="explore"/>;}
