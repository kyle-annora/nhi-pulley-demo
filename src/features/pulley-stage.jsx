import React,{useEffect,useRef,useState} from 'react';
import {Button,ChoiceGroup,EvidenceLabel,Notice} from '../components/primitives';
import {drawing} from '../explorer';
import {createF4412Explorer,explorerURL} from '../shared-explorer-client';
import {PulleyReveal} from './pulley-reveal';

export const INSPECTION_THEMES=[
  {id:'belt',label:'1 · Belt contact',shortLabel:'Belt contact',next:'Inspect flange & diameter'},
  {id:'flange',label:'2 · Flange & diameter',shortLabel:'Flange & diameter',next:'Inspect mounting area'},
  {id:'mount',label:'3 · Mounting area',shortLabel:'Mounting area',next:null}
];
const themeKeys=new Set(INSPECTION_THEMES.map(theme=>theme.id));
const regionForNode={belt:'belt','belt-surface':'belt',flange:'flange','flange-front':'flange','flange-rear':'flange',mount:'mount','mounting-hub':'mount','seal-front':'mount','seal-rear':'mount'};

// The shared Explorer owns geometry, camera, render loop and tour playback.
// The NHI host owns customer inputs; a camera selection never saves a requirement.
export function PulleyStage({product,unit,mode,focus='overview',onFocus,onModeChange,onFailure,compact=false,embedded=false,guidedReveal=false,onRevealStart,onRevealComplete,autoplayInspection=false}){
  const iframe=useRef(null),viewer=useRef(null),appliedFocus=useRef(null),latestFocus=useRef(focus),commandQueue=useRef(Promise.resolve()),requestNumber=useRef(0),inCommand=useRef(false);
  const revealControl=useRef(false);
  const callbacks=useRef({onFocus,onModeChange,onFailure,onRevealStart,onRevealComplete});callbacks.current={onFocus,onModeChange,onFailure,onRevealStart,onRevealComplete};latestFocus.current=focus;
  const [failedFor,setFailedFor]=useState(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[issue,setIssue]=useState(''),[attempt,setAttempt]=useState(0);
  const [tourTransport,setTourTransport]=useState(null);
  const unavailable=failedFor===product.id,three=Boolean(product.model&&mode==='3d'&&!unavailable);

  useEffect(()=>{
    if(!guidedReveal&&revealControl.current){
      revealControl.current=false;inCommand.current=false;appliedFocus.current=null;
      setAttempt(value=>value+1);
    }
  },[guidedReveal]);

  useEffect(()=>{
    if(!three||!iframe.current){setReady(false);return;}
    let live=true,instance=null,failed=false;
    appliedFocus.current=null;commandQueue.current=Promise.resolve();
    const fail=error=>{
      if(!live||failed)return;failed=true;setReady(false);setBusy(false);
      setIssue(error?.message||'The shared Explorer could not load.');setFailedFor(product.id);
      callbacks.current.onFailure?.();
    };
    try{
      instance=createF4412Explorer({iframe:iframe.current,onError:fail,onState:snapshot=>{
        if(!live)return;
        const tour=snapshot.tour;
        if(tour)setTourTransport(previous=>previous?.status===tour.status&&previous?.chapterId===tour.chapterId&&previous?.reason===tour.reason?previous:{status:tour.status,chapterId:tour.chapterId,reason:tour.reason});
        if(revealControl.current||inCommand.current||appliedFocus.current===null||snapshot.lifecycle!=='ready')return;
        const selected=snapshot.tour?.active?snapshot.tour.chapterId:snapshot.navigation?.selectedId;
        const next=regionForNode[selected]||(selected==='f4412'?'overview':null);
        if(next&&next!==latestFocus.current){appliedFocus.current=next;callbacks.current.onFocus?.(next);}
      }});
      viewer.current=instance;
      instance.ready.then(()=>{if(live&&!failed){setReady(true);setIssue('');}}).catch(fail);
    }catch(error){fail(error);}
    return ()=>{live=false;requestNumber.current++;inCommand.current=false;revealControl.current=false;instance?.dispose();if(viewer.current===instance)viewer.current=null;};
  },[three,product.id]);

  useEffect(()=>{
    if(!three||!ready||!viewer.current||revealControl.current||appliedFocus.current===focus)return;
    const instance=viewer.current,desired=themeKeys.has(focus)?focus:'overview',ticket=++requestNumber.current;
    setBusy(true);inCommand.current=true;
    commandQueue.current=commandQueue.current.catch(()=>{}).then(async()=>{
      if(instance!==viewer.current||ticket!==requestNumber.current)return;
      try{
        await instance.showTheme(desired,{play:autoplayInspection&&desired!=='overview'});
        if(instance===viewer.current&&ticket===requestNumber.current){appliedFocus.current=desired;setIssue('');}
      }catch(error){if(instance===viewer.current&&ticket===requestNumber.current)setIssue(error.message||'This inspection view could not be opened. Choose it again or use the drawing.');}
      finally{if(instance===viewer.current&&ticket===requestNumber.current){inCommand.current=false;setBusy(false);}}
    });
  },[focus,three,ready,attempt,autoplayInspection]);

  const choose=key=>{if(key===focus){appliedFocus.current=null;setAttempt(value=>value+1);}callbacks.current.onFocus?.(key);};
  const switchMode=value=>{if(value==='3d'){setFailedFor(null);setIssue('');}callbacks.current.onModeChange?.(value);};
  const startReveal=()=>{revealControl.current=true;++requestNumber.current;setBusy(false);callbacks.current.onRevealStart?.();};
  const playReveal=async key=>{
    const instance=viewer.current;if(!instance)throw Error('Open the 3D view to start this inspection.');
    revealControl.current=true;
    // Retire a normal check's camera command before the guide takes control.
    await commandQueue.current.catch(()=>{});
    if(instance!==viewer.current)throw Error('The Explorer view changed. Open this check again.');
    const result=await instance.showTheme(key,{play:true});
    if(result?.superseded)throw Error('Another view was selected. Try this check again.');
    if(instance===viewer.current)appliedFocus.current=key;
  };
  const completeReveal=async({theme,intent='leave'})=>{
    const instance=viewer.current;
    // Returning to an input must stay possible if the viewer stops responding.
    // A departed viewer must never trigger a late host callback or draft edit.
    if(instance?.state?.tour?.active)instance.command('pauseTour').catch(()=>{});
    if(instance!==viewer.current)return;
    revealControl.current=false;inCommand.current=false;appliedFocus.current=theme;
    if(callbacks.current.onRevealComplete)await callbacks.current.onRevealComplete({theme,intent});
    else callbacks.current.onFocus?.(theme);
  };
  const chapter=INSPECTION_THEMES.findIndex(theme=>theme.id===focus);
  return <section className={`n-pulley-stage${compact?' n-pulley-stage-compact':''}${embedded?' n-pulley-stage-embedded':''}`} aria-label={`${product.id} product explorer`}>
    <div className="n-pulley-stage-toolbar">
      <div className="n-pulley-stage-title">{embedded?three?<span>3D Explorer</span>:<span>Catalog drawing</span>:<><p className="n-eyebrow">{three?'3D EXPLORER':'PRODUCT VIEW'}</p><span>{product.id} · A Series</span></>}</div>
      {product.model?<ChoiceGroup variant="segmented" className={embedded?'n-room-view-modes':''} label="Product view" value={three?'3d':'static'} onChange={switchMode} choices={[{value:'3d',label:'3D'},{value:'static',label:'Drawing'}]}/>:<EvidenceLabel>Dimension drawing</EvidenceLabel>}
    </div>
    {product.model&&!compact&&<div className="n-inspection-guide" aria-label="Three inspection themes">
      <div className="n-inspection-head"><p className="n-eyebrow">CHOOSE A CHECK</p><span className="n-help" role="status">{chapter<0?'Choose a theme to begin':`Viewing ${chapter+1} of 3${three&&busy?' · Opening view…':''}`}</span></div>
      <ChoiceGroup label="Inspection theme" value={focus} onChange={choose} choices={INSPECTION_THEMES.map(theme=>({value:theme.id,label:theme.label}))}/>
      {three&&issue&&<Notice kind="error" title="Inspection view needs attention" role="alert">{issue}<Button variant="text" onClick={()=>choose(focus)}>Retry this view</Button></Notice>}
    </div>}
    {embedded&&three&&issue&&<div className="n-pulley-fallback"><Notice kind="error" title="Inspection view needs attention" role="alert">{issue}<Button variant="text" onClick={()=>choose(focus)}>Retry this view</Button></Notice></div>}
    {unavailable&&<div className="n-pulley-fallback"><Notice title="3D is unavailable" role="status">Your requirements and catalog drawing remain available. Choose 3D to try again.</Notice></div>}
    {three?<div className="n-pulley-viewport" aria-busy={!ready||busy}>
      <iframe ref={iframe} className="n-shared-explorer" src={explorerURL()} title="Shared F-4412 Explorer · Illustrative model" allow="fullscreen"/>
      {!ready&&<div className="n-stage-loading" role="status"><span className="n-spinner" aria-hidden="true"/><span>Loading F-4412 Explorer…</span></div>}
    </div>:<div className="n-pulley-viewport n-pulley-drawing" dangerouslySetInnerHTML={{__html:drawing(product,unit)}}/>}
    {guidedReveal&&three&&<PulleyReveal ready={ready} transport={tourTransport} onStart={startReveal} onPlay={playReveal} onComplete={completeReveal}/>}
    <div className="n-pulley-stage-caption">
      <EvidenceLabel kind="example">{three?'Illustrative model · Not manufacturer CAD':'Dimension schematic · Other geometry illustrative'}</EvidenceLabel>
      {embedded?<details className="n-room-model-help"><summary>Viewing help</summary><p className="n-help">{three?'Drag to rotate. Scroll or pinch to zoom. Highlighted regions help identify a question; they are not separate quoted parts.':'The schematic carries catalog dimensions. Other geometry is illustrative. Only F-4412 has a 3D model in this demo.'}</p></details>:<p className="n-help">{three?'Drag to rotate · Scroll or pinch to zoom. Inspection regions identify questions, not separate quoted parts.':'Catalog dimensions remain available. F-4412 is the only 3D model in this demonstration.'}</p>}
    </div>
  </section>;
}
