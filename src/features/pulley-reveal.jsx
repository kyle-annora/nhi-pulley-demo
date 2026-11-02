import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../components/primitives';

const checks=[
  {id:'belt',label:'Belt contact',title:'The belt runs here.',text:'B is the 2.75 in running diameter; D is the 0.75 in width between the flanges.',next:'See the outside diameter'},
  {id:'flange',label:'Outside diameter',title:'The outside edge needs more room.',text:'A is 3.125 in across the flange edges—larger than the 2.75 in running diameter B.',next:'Inspect the mounting point'},
  {id:'mount',label:'Mounting',title:'This is the question to carry forward.',text:'The hub is illustrative: ask engineering to confirm bore, mounting offsets and spacers for your application.',next:'Use these checks in inquiry'},
];

// Presentation only. The host supplies existing viewer commands and opens the
// normal input form; neither reading nor replaying adds an inquiry requirement.
export function PulleyReveal({ready,transport,onPlay,onStart,onComplete}){
  const [index,setIndex]=useState(-1),[pending,setPending]=useState(false),[issue,setIssue]=useState('');
  const busy=useRef(false),heading=useRef(null),generation=useRef(0),live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;++generation.current;};},[]);
  const check=checks[index],playing=check&&transport?.chapterId===check.id&&transport.status==='playing';
  async function show(next){
    if(busy.current||!ready)return;
    busy.current=true;setPending(true);setIssue('');const turn=++generation.current;
    try{
      if(index<0)onStart?.();
      setIndex(next);
      await onPlay(checks[next].id);
      if(turn===generation.current)heading.current?.focus({preventScroll:true});
    }catch(error){if(turn===generation.current)setIssue(error.message||'This inspection could not open. Try this view again.');}
    finally{if(turn===generation.current){busy.current=false;setPending(false);}}
  }
  async function complete(intent='leave'){
    if(busy.current)return;busy.current=true;setPending(true);setIssue('');
    try{await onComplete?.({theme:check?.id||'belt',intent});}
    catch(error){if(live.current)setIssue(error.message||'Return to the check inputs and continue there.');}
    finally{busy.current=false;if(live.current)setPending(false);}
  }
  return <section className="n-pulley-reveal" aria-label="Guided pulley inspection" data-active={index>=0}>
    <div className="n-reveal-copy">
      <p className="n-reveal-position">{check?`${index+1} / 3 · ${check.label}`:'Three checks · Guided 3D inspection'}</p>
      <h3 ref={heading} tabIndex={-1}>{check?.title||'See what matters for selection.'}</h3>
      <p>{check?.text||'Follow the belt surface, outside edge and mounting point before adding your requirements.'}</p>
      {check&&<p className="n-reveal-state" role="status">{pending?'Opening this view…':playing?'Showing this check…':'Continue when you are ready.'}</p>}
      {issue&&<p className="n-error" role="alert">{issue}</p>}
    </div>
    <div className="n-reveal-actions">
      {index>0&&<Button variant="text" disabled={pending} onClick={()=>show(index-1)}>Previous check</Button>}
      {issue?<Button disabled={!ready} pending={pending} onClick={()=>show(Math.max(0,index))}>Retry this view</Button>:<Button disabled={!ready} pending={pending} pendingLabel="Opening view…" onClick={()=>index===checks.length-1?complete('use'):show(index+1)}>{check?.next||'See what matters for selection'}</Button>}
      {(index<checks.length-1||issue)&&<Button variant="text" disabled={pending} onClick={()=>complete('leave')}>{index<0?'Open check inputs':'Leave guide & open inputs'}</Button>}
    </div>
    {check&&<p className="n-reveal-boundary">Viewing does not save a requirement. Review or edit each check before including it.</p>}
  </section>;
}
