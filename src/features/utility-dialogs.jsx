import React,{useRef,useState} from 'react';
import {Checkbox} from '@base-ui/react/checkbox';
import {WorkspaceDialog} from '../components/workspace-dialog';
import {Button,ActionGroup,EvidenceLabel,Glyph,Notice} from '../components/primitives';

const journey=[
  ['Understand the pulley','Follow three short 3D checks: running surface, flange and mounting. Save one question explicitly.','Understand the dimensions before choosing a part.'],
  ['Build the inquiry','Carry the original mounting question into a reviewed RFQ; switch roles to issue example v1.','Give the seller the product context and the exact customer question.'],
  ['Resolve & move forward','Request 250 pieces and a five-week window. Review the seller response and v2, then agree who reviews the open question.','See changed commercial terms and retained technical responsibility in one traceable case.']
];

export function useUtilityDialogs(api){
  const [active,setActive]=useState(null),activeRef=useRef(null),origin=useRef(null),[review,setReview]=useState(null),[checked,setChecked]=useState(false),[feedback,setFeedback]=useState(null);
  const safeAction=useRef(null),tourTitle=useRef(null),errorRef=useRef(null),busy=useRef(false);
  function open(kind,trigger){
    if(!activeRef.current)origin.current=trigger||document.activeElement;
    if(kind==='reset'){const latest=api.reviewReset();setReview(latest);setChecked(false);setFeedback(latest.blocked?{error:true,message:latest.blocked}:null);}
    activeRef.current=kind;setActive(kind);
  }
  function close(){activeRef.current=null;setActive(null);setChecked(false);setFeedback(null);}
  function finalFocus(){if(activeRef.current)return false;return origin.current?.isConnected?origin.current:document.getElementById('page-title');}
  function reportError(message){setFeedback({error:true,message});requestAnimationFrame(()=>{errorRef.current?.focus();errorRef.current?.scrollIntoView({block:'nearest'});});}
  function exportCurrent(){try{api.exportCase();setFeedback({error:false,message:'Download requested. Check that NHI-demo-case.json is saved before resetting. Exporting keeps this demo unchanged.'});}catch{reportError('The download could not be started. Nothing was reset. Try exporting again or keep working.');}}
  function confirmReset(){
    if(busy.current)return;busy.current=true;
    try{
      const result=api.confirmReset(review,checked);
      if(result.error){if(result.stale||result.blocked){setReview(api.reviewReset());setChecked(false);}reportError(result.error);return;}
      close();api.finishReset();
    }catch{reportError('The reset could not be completed. Keep working or try again.');}
    finally{busy.current=false;}
  }
  const dialogs=<>
    <WorkspaceDialog open={active==='walkthrough'} onOpenChange={value=>{if(!value&&activeRef.current==='walkthrough')close();}} title="One part. One continuous case." description="Follow Alex Morgan at fictional Fieldwork Equipment as they source 200 F-4412 pulleys for a compact mower deck." initialFocus={tourTitle} finalFocus={finalFocus}
      footer={<ActionGroup><Button onClick={()=>{close();api.startSample();}}>Open guided F-4412 example</Button><Button variant="secondary" onClick={close}>Keep working here</Button><Button variant="text" onClick={()=>open('reset')}>Reset demo…</Button></ActionGroup>}>
      <p className="n-dialog-context" ref={tourTitle} tabIndex={-1}>Opening the guide leaves your work unchanged. The three-chapter guide uses its own saved case. Your original records and existing sample stay available. Explicit save and issue actions create the guide’s records.</p>
      <ol className="n-walkthrough-steps">{journey.map(([title,action,value],i)=><li key={title}><span className="n-walkthrough-number" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><div><h3>{title}</h3><p>{action}</p><p className="n-walkthrough-value"><strong>Value</strong>{value}</p></div></li>)}</ol>
      <div className="n-walkthrough-evidence"><div><EvidenceLabel kind="source">Catalog-backed</EvidenceLabel><p>A/B/D dimensions and pulley family descriptions.</p></div><div><EvidenceLabel kind="example">Illustrative</EvidenceLabel><p>3D geometry, customer, quantities, prices and terms.</p></div><div><EvidenceLabel kind="review">Still needs review</EvidenceLabel><p>Fit, mounting, speed, load, finish suitability and the final total.</p></div></div>
    </WorkspaceDialog>
    <WorkspaceDialog alert open={active==='reset'} onOpenChange={value=>{if(!value&&activeRef.current==='reset')close();}} title="Reset this browser’s demo?" description="This replaces your current local case with the original F-4412 example. The current records cannot be restored inside this demo." initialFocus={safeAction} finalFocus={finalFocus}
      footer={<ActionGroup><Button ref={safeAction} variant="secondary" onClick={close}>Keep working</Button><Button variant="danger" disabled={!checked||!!review?.blocked} onClick={confirmReset}>Reset demo & clear records</Button></ActionGroup>}>
      {review&&<><section className="n-reset-scope" aria-label="Records that will be cleared"><h3>What will be cleared</h3><dl>{[['RFQs',review.counts.rfqs],['Quote versions',review.counts.quoteVersions],['Change requests',review.counts.revisions],['Simulated replies',review.counts.replies],['Next-step requests',review.counts.nextSteps||0],['Acknowledgements',review.counts.acknowledgements||0]].map(([label,count])=><div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl><p>Also clears the working inquiry, seller and per-version drafts, Explorer inputs and locally attached files. Downloaded files stay on your device.</p></section>
      <div className="n-reset-export"><Button variant="secondary" icon="download" onClick={exportCurrent}>Export current case</Button><p className="n-help">Optional · Keep a JSON copy of your records and attached files.</p></div>
      {feedback&&<div className="n-dialog-feedback" ref={errorRef} tabIndex={-1}><Notice kind={feedback.error?'error':'neutral'} role={feedback.error?'alert':'status'} title={feedback.error?'Action needs attention':'Export requested'}>{feedback.message}</Notice></div>}
      <label className="n-reset-ack"><Checkbox.Root className="n-confirm-checkbox" checked={checked} disabled={!!review.blocked} onCheckedChange={setChecked} aria-describedby="n-reset-confirm-help"><Checkbox.Indicator><Glyph name="check"/></Checkbox.Indicator></Checkbox.Root><span>I understand that these local demo records will be cleared.</span></label>
      <p id="n-reset-confirm-help" className="n-help">{checked?'Ready for your explicit reset action. You can still keep working.':'Select the confirmation to enable reset. No records have been changed.'}</p></>}
    </WorkspaceDialog>
  </>;
  return {open,dialogs};
}
