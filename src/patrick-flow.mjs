import {initialState,restoreState,activeQuote,requestFingerprint,validateDraft,validateRevision} from './domain.mjs';
import {saveExplorerInput} from './inquiry-adapter.mjs';
import {saveReviewedInquiry} from './rfq-adapter.mjs';
import {bindRevisionDraft,commitRevisionFor,quoteKey} from './quote-adapter.mjs';
import {saveSellerDraft,reviewSellerDraft,issueSellerDraft,requestNextStep,acknowledgeNextStep} from './commercial-adapter.mjs';

// This is a new, isolated presentation store. It never reads or changes the
// original workspace, separate example, or earlier guided-example keys.
export const PATRICK_KEY='nhi-patrick-demo-v1';
export const PATRICK_QUESTION='Please confirm shaft fit and spacer offset against the attached sketch.';
const PLAN='Please coordinate an engineering review of shaft fit and spacer offset against the attached sketch. We will supply operating speed, radial load and mounting dimensions. Keep the original question and conditional zinc finish open.';
const ACK='The review plan is acknowledged. Engineering will assess the mounting information and zinc finish suitability after the missing application data is supplied. Technical findings and application fit are not yet confirmed.';
const SELLER_NOTE='Example proposal only. The original mounting question, application fit, zinc suitability, freight and tax remain open for review.';
const FIXTURE_TIME='2026-11-01T12:00:00.000Z';
const stage=(id,chapter,role,title,actionLabel,action,nextRole=null)=>({id,chapter,role,title,actionLabel,action,nextRole,reviewing:id.includes('review-')||id.endsWith('-review')});
export const PATRICK_STAGES=Object.freeze([
  stage('opening',1,'Presenter','From a pulley question to a traceable quotation.','Start the NHI demo','start'),
  stage('inspect',1,'Buyer','Understand the pulley.','Open the mounting question','finish-inspection'),
  stage('question',1,'Buyer','Turn the inspection into a useful question.','Save question & prepare inquiry','save-question'),
  stage('inquiry',2,'Buyer','Build the inquiry.','Review inquiry','review-inquiry'),
  stage('inquiry-review',2,'Buyer','Review the exact inquiry.','Confirm & save example RFQ','save-inquiry','Seller'),
  stage('seller-v1',3,'Seller','The seller receives the same context.','Review example quote v1','review-v1'),
  stage('seller-review-v1',3,'Seller','Review the first proposal.','Issue example quote v1','issue-v1','Buyer'),
  stage('quote-v1',3,'Buyer','A proposal the customer can return to.','Request a change','request-change'),
  stage('change',3,'Buyer','Request 250 units and a five-week window.','Review change request','review-change'),
  stage('change-review',3,'Buyer','Review the requested changes.','Confirm & save change request','save-change','Seller'),
  stage('seller-v2',3,'Seller','Respond to the same saved request.','Review revised proposal','review-v2'),
  stage('seller-review-v2',3,'Seller','Review the revised proposal.','Issue example quote v2','issue-v2','Buyer'),
  stage('quote-v2',3,'Buyer','The proposal changed. The question stayed connected.','Plan engineering review','request-review'),
  stage('plan',3,'Buyer','Make the engineering next step explicit.','Review next-step request','review-plan'),
  stage('plan-review',3,'Buyer','Review who does what next.','Confirm review request','save-plan','Seller'),
  stage('ack',3,'Seller','Acknowledge the review plan.','Review acknowledgement','review-ack'),
  stage('ack-review',3,'Seller','Review the acknowledgement.','Confirm review plan','confirm-ack','Buyer'),
  stage('complete',3,'Buyer','One question. One traceable review plan.','Explore Annora capabilities',null)
]);
const byStage=new Map(PATRICK_STAGES.map(s=>[s.id,s]));
const copy=value=>structuredClone(value);
const fail=(session,error,errors)=>({session,error,...(errors?{errors}:{})});
const issueError=result=>result.error||result.errors&&Object.values(result.errors)[0];
const fingerprint=value=>JSON.stringify(value);
const validText=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=3000;
const inquiryFields=new Set(['quantity','annual','timing','application','belt','finish','mounting','speed','load','notes','company','name','email']);
const changeFields=new Set(['quantity','timing','finish','message']);
function editFields(target,payload,allowed){
  const fields=payload.fields||payload;
  for(const [key,value] of Object.entries(fields))if(allowed.has(key)&&typeof value==='string')target[key]=value;
}
function sampleAttachment(){
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 420"><rect width="760" height="420" fill="#f4f5f6"/><g font-family="Arial" fill="#20262b"><text x="32" y="48" font-size="22">EXAMPLE APPLICATION SKETCH</text><text x="32" y="79" font-size="15">Fictional compact mower deck · F-4412 idler candidate</text><text x="32" y="370" font-size="14">Illustrative reference, not an engineering drawing.</text><text x="32" y="395" font-size="14">Mounting dimensions, operating speed and load are not specified.</text></g><g fill="none" stroke="#626b73" stroke-width="3"><circle cx="190" cy="210" r="68"/><circle cx="570" cy="210" r="68"/><path d="M190 142h380M190 278h380"/><circle cx="380" cy="305" r="24"/><path d="M380 329v20"/></g></svg>';
  return {name:'demo-application-sketch.svg',size:svg.length,type:'image/svg+xml',sample:true,data:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`};
}

export function createPatrickSession(){
  const state=initialState();
  state.caseId='NHI-PATRICK-4412';state.step='explore';
  state.draft.finish='zinc';state.draft.attachments=[sampleAttachment()];
  return {schema:1,stage:'opening',state,review:null,prepared:false,planMessage:PLAN,ackMessage:ACK};
}

function validProgress(session){
  const i=PATRICK_STAGES.findIndex(s=>s.id===session.stage),s=session.state;
  if(i>=3&&!s.draft.explorerRequirements?.some(r=>r.productId==='F-4412'&&r.feature==='mount'&&r.note))return false;
  if(i>=5&&!s.rfqs.some(r=>r.id===s.activeRfqId))return false;
  if(i>=7&&!s.quotes.some(q=>q.version===1&&q.rfqId===s.activeRfqId))return false;
  if(i>=10&&!s.revisions.length)return false;
  if(i>=12&&!s.quotes.some(q=>q.version===2&&q.rfqId===s.activeRfqId))return false;
  if(i>=15&&!s.commercial?.nextSteps?.length)return false;
  if(i>=17&&!s.commercial?.acknowledgements?.length)return false;
  return true;
}
export function restorePatrickSession(raw){
  try{
    const value=typeof raw==='string'?JSON.parse(raw):copy(raw);
    if(value?.schema!==1||!byStage.has(value.stage)||typeof value.prepared!=='boolean')return null;
    if(value.presentationMode!=null&&!['long','short'].includes(value.presentationMode))return null;
    if(value.shortStep!=null&&(!Number.isInteger(value.shortStep)||value.shortStep<0||value.shortStep>3))return null;
    const state=restoreState(JSON.stringify(value.state));
    if(!state||state.caseId!=='NHI-PATRICK-4412'||state.selected!=='F-4412')return null;
    const session={...value,state,review:value.review||null,planMessage:typeof value.planMessage==='string'?value.planMessage:PLAN,ackMessage:typeof value.ackMessage==='string'?value.ackMessage:ACK};
    if(!validProgress(session))return null;
    if(session.presentationMode==='short'&&(!session.prepared||!state.quotes.some(q=>q.version===2&&q.rfqId===state.activeRfqId)))return null;
    if(byStage.get(session.stage).reviewing&&!session.review)return null;
    return session;
  }catch{return null;}
}

export function patrickView(session){
  const info=byStage.get(session.stage)||byStage.get('opening');
  const state=session.state,quote=activeQuote(state),rfq=state.rfqs.find(r=>r.id===state.activeRfqId)||null;
  const question=state.draft.explorerRequirements?.find(r=>r.productId==='F-4412'&&r.feature==='mount')||null;
  return copy({...info,stage:info.id,index:PATRICK_STAGES.findIndex(s=>s.id===info.id),total:PATRICK_STAGES.length,prepared:session.prepared,quote,rfq,question,revision:state.revisions.find(r=>r.id===state.activeRevisionId)||null,plan:state.commercial?.nextSteps?.at(-1)||null,acknowledgement:state.commercial?.acknowledgements?.at(-1)||null});
}

// All writes remain explicit stage actions and call the existing domain adapters.
// Merely showing a review, returning to an editor, or creating a short-route
// fixture cannot write to any browser store: the presentation host owns storage.
export function patrickTransition(session,action,payload={},now=new Date().toISOString()){
  if(!session||!byStage.has(session.stage))return fail(session,'This presentation session is unavailable.');
  const allowed={start:'opening','finish-inspection':'inspect','save-question':'question','update-inquiry':'inquiry','review-inquiry':'inquiry','save-inquiry':'inquiry-review','review-v1':'seller-v1','issue-v1':'seller-review-v1','request-change':'quote-v1','update-change':'change','review-change':'change','save-change':'change-review','review-v2':'seller-v2','issue-v2':'seller-review-v2','request-review':'quote-v2','update-plan':'plan','review-plan':'plan','save-plan':'plan-review','update-ack':'ack','review-ack':'ack','confirm-ack':'ack-review'};
  const edits={'edit-inquiry':['inquiry-review','inquiry'],'edit-change':['change-review','change'],'edit-plan':['plan-review','plan'],'edit-ack':['ack-review','ack'],'edit-v1':['seller-review-v1','seller-v1'],'edit-v2':['seller-review-v2','seller-v2']};
  if(edits[action]){
    if(session.stage!==edits[action][0])return fail(session,'That editor is not available at this step.');
    return {session:{...copy(session),stage:edits[action][1],review:null}};
  }
  if(!allowed[action]||session.stage!==allowed[action])return fail(session,'This action is not available at the current step. No records were changed.');
  const n=copy(session),s=n.state;let result,q;
  const advance=(stage,review=null)=>{n.stage=stage;n.review=review;return {session:n};};
  try{
    switch(action){
      case 'start':return advance('inspect');
      case 'finish-inspection':return advance('question');
      case 'save-question':{
        const note=payload.note??PATRICK_QUESTION;
        if(!validText(note))return fail(session,'Write the engineering question in 1–3,000 characters.',{note:'Write a question before saving.'});
        result=saveExplorerInput(s,'mount',{note:note.trim(),value:''},true,now);
        if(result.error)return fail(session,result.error);
        n.state=result.state;n.state.step='configure';return advance('inquiry');
      }
      case 'update-inquiry':editFields(s.draft,payload,inquiryFields);return {session:n};
      case 'review-inquiry':{
        editFields(s.draft,payload,inquiryFields);const errors=validateDraft(s.draft);
        if(Object.keys(errors).length)return fail(session,Object.values(errors)[0],errors);
        s.step='review';return advance('inquiry-review',{kind:'inquiry',fingerprint:requestFingerprint(s.selected,s.draft)});
      }
      case 'save-inquiry':{
        if(n.review?.kind!=='inquiry')return fail(session,'Review the current inquiry before saving.');
        result=saveReviewedInquiry(s,n.review.fingerprint,now);
        if(issueError(result))return fail(session,issueError(result),result.errors);
        n.state=result.state;return advance('seller-v1');
      }
      case 'review-v1':case 'review-v2':{
        const revised=action==='review-v2';
        result=saveSellerDraft(s,{revisionId:revised?s.activeRevisionId:null,sellerNote:payload.sellerNote??SELLER_NOTE},now);
        if(result.error)return fail(session,result.error);
        n.state=result.state;const review=reviewSellerDraft(n.state,result.draft.key);
        if(review.error)return fail(session,review.error);
        return advance(revised?'seller-review-v2':'seller-review-v1',{...review,kind:revised?'seller-v2':'seller-v1'});
      }
      case 'issue-v1':case 'issue-v2':{
        const revised=action==='issue-v2';
        if(n.review?.kind!==(revised?'seller-v2':'seller-v1'))return fail(session,'Review the exact seller draft before issuing.');
        result=issueSellerDraft(s,n.review,now);
        if(result.error)return fail(session,result.error);
        n.state=result.state;return advance(revised?'quote-v2':'quote-v1');
      }
      case 'request-change':{
        n.state=bindRevisionDraft(s);n.state.revisionDraft={quantity:'250',timing:'5 weeks from order',finish:'zinc',message:'Please quote 250 units and advise whether five weeks is feasible. Keep the original mounting question open for engineering.'};
        n.state.step='revision';return advance('change');
      }
      case 'update-change':editFields(s.revisionDraft,payload,changeFields);return {session:n};
      case 'review-change':{
        editFields(s.revisionDraft,payload,changeFields);q=activeQuote(s);
        if(!q)return fail(session,'Open the source quotation before reviewing a change.');
        const errors=validateRevision(q,s.revisionDraft);
        if(Object.keys(errors).length)return fail(session,Object.values(errors)[0],errors);
        return advance('change-review',{kind:'change',key:quoteKey(q),fingerprint:fingerprint({quote:q,draft:s.revisionDraft})});
      }
      case 'save-change':{
        q=activeQuote(s);
        if(n.review?.kind!=='change'||!q||n.review.key!==quoteKey(q)||n.review.fingerprint!==fingerprint({quote:q,draft:s.revisionDraft}))return fail(session,'The change or source quote changed after review. Review it again before saving.');
        result=commitRevisionFor(s,n.review.key,s.revisionDraft,now);
        if(issueError(result))return fail(session,issueError(result),result.errors);
        n.state=result.state;return advance('seller-v2');
      }
      case 'request-review':s.step='next';return advance('plan');
      case 'update-plan':n.planMessage=typeof payload.message==='string'?payload.message:n.planMessage;return {session:n};
      case 'review-plan':{
        n.planMessage=payload.message??n.planMessage;
        if(!validText(n.planMessage))return fail(session,'Describe the engineering next step in 1–3,000 characters.',{message:'Describe the next step.'});
        q=activeQuote(s);if(!q)return fail(session,'Open the exact quotation before requesting review.');
        return advance('plan-review',{kind:'plan',fingerprint:fingerprint({quote:q,message:n.planMessage})});
      }
      case 'save-plan':{
        q=activeQuote(s);
        if(n.review?.kind!=='plan'||!q||n.review.fingerprint!==fingerprint({quote:q,message:n.planMessage}))return fail(session,'The plan changed after review. Review the current plan before saving.');
        result=requestNextStep(s,{quoteId:q.id,quoteVersion:q.version,message:n.planMessage},now);
        if(result.error)return fail(session,result.error);
        n.state=result.state;return advance('ack');
      }
      case 'update-ack':n.ackMessage=typeof payload.message==='string'?payload.message:n.ackMessage;return {session:n};
      case 'review-ack':{
        n.ackMessage=payload.message??n.ackMessage;
        if(!validText(n.ackMessage))return fail(session,'Describe the acknowledgement in 1–3,000 characters.',{message:'Describe the acknowledgement.'});
        const request=s.commercial?.nextSteps?.at(-1);q=activeQuote(s);
        if(!request||!q)return fail(session,'Open the saved review request before acknowledging it.');
        return advance('ack-review',{kind:'ack',fingerprint:fingerprint({quote:q,request,message:n.ackMessage})});
      }
      case 'confirm-ack':{
        const request=s.commercial?.nextSteps?.at(-1);q=activeQuote(s);
        if(n.review?.kind!=='ack'||!request||!q||n.review.fingerprint!==fingerprint({quote:q,request,message:n.ackMessage}))return fail(session,'The acknowledgement context changed after review. Review it again before confirming.');
        result=acknowledgeNextStep(s,{requestId:request.id,message:n.ackMessage},now);
        if(result.error)return fail(session,result.error);
        n.state=result.state;return advance('complete');
      }
    }
  }catch(error){return fail(session,error.message||'This presentation action could not complete. Records are unchanged.');}
}

export function preparedPatrickSession(checkpoint='v2'){
  const targets={question:'question',inquiry:'inquiry-review',v2:'quote-v2',complete:'complete'};
  const target=targets[checkpoint];
  if(!target)throw new Error('Choose a prepared question, inquiry, v2 or complete checkpoint.');
  let session=createPatrickSession(),index=0;
  while(session.stage!==target){
    const view=patrickView(session),action=view.action;
    if(!action)throw new Error('The prepared presentation checkpoint could not be built.');
    const now=new Date(Date.parse(FIXTURE_TIME)+(index++)*60000).toISOString();
    const result=patrickTransition(session,action,action==='save-question'?{note:PATRICK_QUESTION}:{},now);
    if(result.error)throw new Error(result.error);
    session=result.session;
  }
  return {...session,prepared:true,preparedCheckpoint:checkpoint};
}
