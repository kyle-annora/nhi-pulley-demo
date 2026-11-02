import React from 'react';
import {Button} from '../components/primitives';
import {walkthroughFlow,WALKTHROUGH_CHAPTERS} from '../walkthrough-flow.mjs';

function focusAction(selector){const el=document.querySelector(selector);if(el){el.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});el.focus({preventScroll:true});}}
export function WalkthroughGuide({state,api}){
  const flow=walkthroughFlow(state),step=state.step;
  const currentChapter=['select','explore'].includes(step)?1:['configure','review','rfq'].includes(step)?2:flow.chapter;
  const revisiting=currentChapter<flow.chapter;
  const title=revisiting?(currentChapter===1?'Revisit the three selection checks.':'Revisit the original inquiry.'):flow.title;
  const note=revisiting?(currentChapter===1?'Replay the camera and highlights. Your saved question and quotations stay available.':'This is the saved inquiry context. Continue to the current proposal when ready.'):flow.note;
  function next(){
    if(flow.beat==='inspect'){api.navigate('explore');return;}
    if(flow.beat==='inquiry'){if(step==='review')focusAction('.n-rfq-desktop-action button, .n-rfq-save button, button[type=submit]');else api.navigate('configure');return;}
    if(flow.beat==='seller'||flow.beat==='reply'){if(step==='seller')focusAction('.n-commercial-side button');else api.openSeller(flow.revision?.id);return;}
    if(flow.beat==='change'){if(step==='revision')focusAction('#revision-quantity');else api.newRevision();return;}
    if(flow.beat==='acknowledge'){if(step==='seller')focusAction('.n-next-step button');else api.openSeller();return;}
    if(flow.beat==='complete'){if(step==='quote'&&!revisiting)api.exitWalkthrough();else api.openCurrentWork(flow.q);return;}
    if(step==='quote-document'){api.navigate(`#next?rfq=${encodeURIComponent(flow.q.rfqId)}&quote=${encodeURIComponent(flow.q.id)}&version=${flow.q.version}`);return;}
    api.navigate(`#quote-document?source=quote&id=${encodeURIComponent(flow.q.id)}&version=${flow.q.version}&view=comparison`);
  }
  const inPlace=['select','explore'].includes(step)||(flow.beat==='inquiry'&&['configure','review'].includes(step))||(['seller','reply','acknowledge'].includes(flow.beat)&&step==='seller')||(flow.beat==='change'&&step==='revision')||(flow.beat==='next'&&step==='next');
  const label={inspect:'Open guided inspection',inquiry:'Prepare inquiry',seller:'Continue as seller',reply:'Review change as seller',change:'Request a change',next:step==='quote-document'?'Plan engineering review':'Compare v1 & v2',acknowledge:'Acknowledge as seller',complete:step==='quote'&&!revisiting?'Finish guide':'Return to current work'}[flow.beat];
  return <aside className="n-walkthrough-guide n-shell-width" aria-label="Demo walkthrough">
    <div className="n-wt-top"><span className="n-wt-label">GUIDED EXAMPLE</span><nav aria-label="Demonstration chapters">{WALKTHROUGH_CHAPTERS.map((title,index)=><button key={title} type="button" aria-current={currentChapter===index+1?'step':undefined} disabled={index===1&&!flow.input||index===2&&!flow.q} onClick={()=>index===0?api.navigate('explore?presentation=1'):index===1?api.navigate(flow.rfq?`#rfq?rfq=${encodeURIComponent(flow.rfq.id)}&version=${flow.rfq.version}`:'configure'):api.openCurrentWork(flow.q)}><span>0{index+1}</span>{title}</button>)}</nav><Button variant="text" onClick={api.exitWalkthrough}>Exit guide</Button></div>
    <div className="n-wt-current"><div><strong>{title}</strong><p>{note}</p></div>{!inPlace&&<Button onClick={next}>{label}</Button>}{inPlace&&<span className="n-wt-in-place">{flow.beat==='inspect'?'Start with the 3D guide below':'Continue with the action below'}</span>}</div>
  </aside>;
}

