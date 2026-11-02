import React,{useEffect,useRef,useState} from 'react';
import {Button,ActionLink,ChoiceGroup,EvidenceLabel} from '../components/primitives';
import {MOBILE_CAPABILITY_CHANNEL,capabilityURL,mobileBuyerURL,readMobileCapabilityMessage} from '../patrick-capability-navigation.mjs';

const previews={
  explorer:{title:'See an authored mechanism in motion.',mobileTitle:'Explorer · Follow the motion',label:'Explorer',
    instruction:'Choose Start guided tour, or open Operation and press Play. The prepared crank explains motion, component focus and restoration.',
    mobileInstruction:'Start the three-step tour to follow the crank and inspect its connections.',
    boundary:'Separate crank mechanism · Authored demonstration, not an NHI pulley or a validated F-4412 operation.'},
  studio:{title:'Maintain the explanation behind the product.',mobileTitle:'Studio · Edit and preview',label:'Studio',
    instruction:'Open the crank product, edit its introduction, save the draft, then Preview. Review release before publishing the local content version.',
    mobileInstruction:'Open the product, edit its introduction and Preview. The customer view opens here.',
    boundary:'Separate crank product · Publishing here creates a browser-local example release. It does not publish to NHI or a live website.'}
};

export function PatrickCapabilities({onReturn}){
  const [mode,setMode]=useState('explorer'),[loaded,setLoaded]=useState(false),[slow,setSlow]=useState(false),[buyerURL,setBuyerURL]=useState(''),[command,setCommand]=useState(''),[error,setError]=useState('');
  const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width:760px)').matches);
  const mainFrame=useRef(null),buyerFrame=useRef(null),heading=useRef(null),mainReady=useRef('');
  const preview=previews[mode],url=capabilityURL(mode,window.location.href),buyer=mode==='studio'&&!!buyerURL;
  const send=(frame,type,fields={})=>frame?.contentWindow?.postMessage({channel:MOBILE_CAPABILITY_CHANNEL,version:1,type,...fields},window.location.origin);
  const configure=frame=>send(frame,'configure-mobile',{enabled:mobile||buyer});
  useEffect(()=>{const media=window.matchMedia('(max-width:760px)'),change=()=>setMobile(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{
    if(!mobile)return;
    const bodyOverflow=document.body.style.overflow,htmlOverflow=document.documentElement.style.overflow;
    document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';document.body.classList.add('nhi-capability-mobile');
    return()=>{document.body.style.overflow=bodyOverflow;document.documentElement.style.overflow=htmlOverflow;document.body.classList.remove('nhi-capability-mobile');};
  },[mobile]);
  useEffect(()=>{configure(mainFrame.current);configure(buyerFrame.current);},[mobile,mode,buyerURL]);
  useEffect(()=>{setLoaded(!buyerURL&&mainReady.current===mode);setSlow(false);const timer=setTimeout(()=>setSlow(true),18000);return()=>clearTimeout(timer);},[mode,buyerURL]);
  useEffect(()=>{
    function receive(event){
      const message=readMobileCapabilityMessage(event,{origin:window.location.origin,studioWindow:mode==='studio'?mainFrame.current?.contentWindow:null,buyerWindow:buyerFrame.current?.contentWindow});
      if(!message)return;
      if(message.type==='buyer-preview'&&mobile){
        const next=mobileBuyerURL(message,window.location.href);if(next){setBuyerURL(next);setCommand('');setError('');requestAnimationFrame(()=>heading.current?.focus({preventScroll:true}));}
      }else if(message.type==='studio-visible'){
        setBuyerURL('');setCommand('');setError('');setLoaded(true);requestAnimationFrame(()=>heading.current?.focus({preventScroll:true}));
      }else if(message.type==='back-studio'){
        setCommand('back-editor');send(mainFrame.current,'back-editor');
      }else if(message.type==='command-unavailable'){
        setCommand('');setError('Studio could not complete that action. Your saved draft is unchanged. Try Back to Studio, or open Studio separately to review it.');
      }
    }
    window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  },[mode,mobile]);
  useEffect(()=>{if(!command)return;const timer=setTimeout(()=>{setCommand('');setError('Studio has not completed the action. Return to the editor and check the draft before trying again.');},12000);return()=>clearTimeout(timer);},[command]);
  function changeMode(next){if(next===mode)return;mainReady.current='';setBuyerURL('');setCommand('');setError('');setMode(next);}
  function studioAction(type){setError('');setCommand(type);send(mainFrame.current,type);}
  return <section className="p-capabilities" data-mobile={mobile} aria-labelledby="p-cap-title">
    <header className="p-cap-header"><div><p className="n-eyebrow">OPTIONAL · ANNORA PLATFORM CAPABILITY</p><h1 id="p-cap-title" tabIndex={-1}>{mobile?'Annora mobile preview':'A separate sample. A reusable platform.'}</h1><p>These are existing Annora capabilities. Your F-4412 case stays where you left it.</p></div><Button variant="secondary" onClick={onReturn}>Return to F-4412</Button></header>
    <div className="p-cap-identity"><EvidenceLabel kind="example">Annora platform preview · Separate crank sample</EvidenceLabel><span>Isolated browser-local example</span></div>
    <div className="p-cap-mode"><ChoiceGroup variant="segmented" label="Platform capability" value={mode} onChange={changeMode} choices={Object.entries(previews).map(([value,item])=>({value,label:item.label}))}/><ActionLink href={buyer?buyerURL:url} target="_blank" rel="noreferrer">Open {buyer?'customer preview':preview.label} separately</ActionLink></div>
    <div className="p-cap-intro"><h2 ref={heading} tabIndex={-1}>{buyer?'Customer preview · Saved Studio draft':mobile?preview.mobileTitle:preview.title}</h2><p>{buyer?'Check the customer experience, then return to the editor or review this draft for a local release.':mobile?preview.mobileInstruction:preview.instruction}</p></div>
    {buyer&&<div className="p-cap-preview-actions"><Button variant="secondary" pending={command==='back-editor'} disabled={!!command&&command!=='back-editor'} pendingLabel="Opening Studio…" onClick={()=>studioAction('back-editor')}>Back to Studio</Button><Button pending={command==='review-release'} disabled={!!command&&command!=='review-release'} pendingLabel="Checking…" onClick={()=>studioAction('review-release')}>Review release</Button></div>}
    {error&&<div className="p-cap-error" role="alert"><p>{error}</p><ActionLink href={url} target="_blank" rel="noreferrer">Open Studio separately</ActionLink></div>}
    <div className="p-cap-frame">
      <iframe ref={mainFrame} key={mode} title={`Annora ${preview.label} · Separate crank sample`} src={url} hidden={buyer} inert={buyer?true:undefined} onLoad={()=>{mainReady.current=mode;configure(mainFrame.current);if(!buyer)setLoaded(true);}} onError={()=>setSlow(true)} allow="fullscreen"/>
      {buyer&&<iframe ref={buyerFrame} title="Annora customer preview · Separate crank sample" src={buyerURL} onLoad={()=>{configure(buyerFrame.current);setLoaded(true);}} onError={()=>setSlow(true)} allow="fullscreen"/>}
      {!loaded&&!slow&&<p className="p-cap-loading" role="status">Opening the separate {buyer?'customer':preview.label} preview…</p>}
    </div>
    {slow&&!loaded&&<div className="p-cap-fallback" role="status"><p>The preview is taking longer to open. Open it separately, or return to F-4412. The NHI case is unchanged.</p><ActionLink href={buyer?buyerURL:url} target="_blank" rel="noreferrer">Open {buyer?'customer preview':preview.label} separately</ActionLink></div>}
    <p className="p-cap-boundary">{mobile?'Separate crank sample · Local example. F-4412 is unchanged.':preview.boundary}</p>
    <p className="p-cap-storage-note">This snapshot uses its own storage namespace. It does not read or replace your NHI records or existing Annora projects.</p>
  </section>;
}
