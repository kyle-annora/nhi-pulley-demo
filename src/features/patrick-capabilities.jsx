import React,{useEffect,useState} from 'react';
import {Button,ActionLink,ChoiceGroup,EvidenceLabel} from '../components/primitives';

const previews={
  explorer:{title:'See an authored mechanism in motion.',label:'Explorer',path:'?model=kinetic-01&appearance=dark',
    instruction:'Choose Start guided tour, or open Operation and press Play. The prepared crank explains motion, component focus and restoration.',
    boundary:'Separate crank mechanism · Authored demonstration, not an NHI pulley or a validated F-4412 operation.'},
  studio:{title:'Maintain the explanation behind the product.',label:'Studio',path:'studio/#products',
    instruction:'Open the crank product, edit its introduction, save the draft, then Preview. Review release before publishing the local content version.',
    boundary:'Separate crank product · Publishing here creates a browser-local example release. It does not publish to NHI or a live website.'}
};

export function PatrickCapabilities({onReturn}){
  const [mode,setMode]=useState('explorer'),[loaded,setLoaded]=useState(false),[slow,setSlow]=useState(false);
  const preview=previews[mode],url=new URL(`./capability-preview/${preview.path}`,window.location.href).href;
  useEffect(()=>{setLoaded(false);setSlow(false);const timer=setTimeout(()=>setSlow(true),18000);return()=>clearTimeout(timer);},[mode]);
  return <section className="p-capabilities" aria-labelledby="p-cap-title">
    <header className="p-cap-header"><div><p className="n-eyebrow">OPTIONAL · ANNORA PLATFORM CAPABILITY</p><h1 id="p-cap-title" tabIndex={-1}>A separate sample. A reusable platform.</h1><p>These are existing Annora capabilities. Your F-4412 case stays where you left it.</p></div><Button variant="secondary" onClick={onReturn}>Return to F-4412</Button></header>
    <div className="p-cap-identity"><EvidenceLabel kind="example">Annora platform preview · Separate crank sample</EvidenceLabel><span>Isolated browser-local example</span></div>
    <div className="p-cap-mode"><ChoiceGroup variant="segmented" label="Platform capability" value={mode} onChange={setMode} choices={Object.entries(previews).map(([value,item])=>({value,label:item.label}))}/><ActionLink href={url} target="_blank" rel="noreferrer">Open {preview.label} separately</ActionLink></div>
    <div className="p-cap-intro"><h2>{preview.title}</h2><p>{preview.instruction}</p></div>
    <div className="p-cap-frame"><iframe key={mode} title={`Annora ${preview.label} · Separate crank sample`} src={url} onLoad={()=>setLoaded(true)} onError={()=>setSlow(true)} allow="fullscreen"/>
      {!loaded&&!slow&&<p className="p-cap-loading" role="status">Opening the separate {preview.label} preview…</p>}
    </div>
    {slow&&!loaded&&<p className="p-cap-fallback" role="status">The preview is taking longer to open. Use “Open {preview.label} separately” above, or return to F-4412. The NHI case is unchanged.</p>}
    <p className="p-cap-boundary">{preview.boundary}</p>
    <p className="p-cap-storage-note">This snapshot uses its own storage namespace. It does not read or replace your NHI records or existing Annora projects.</p>
  </section>;
}
