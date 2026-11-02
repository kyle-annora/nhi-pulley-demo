import {sellerEntryState,commercialContext,saveSellerDraft,reviewSellerDraft,issueSellerDraft,requestNextStep,acknowledgeNextStep} from './commercial-adapter.mjs';
import {mountReact,unmountReact} from './react-entry.jsx';
import {selectForInquiry} from './selection-adapter.mjs';
import {openHistoryRecord} from './history-adapter.mjs';
import {saveReviewedInquiry} from './rfq-adapter.mjs';
import {changeExplorerUnit,saveExplorerInput} from './inquiry-adapter.mjs';
import {bindRevisionDraft,updateRevisionDraft,commitRevisionFor,selectQuoteVersion} from './quote-adapter.mjs';
import {initialState,validateDraft,activeRFQ,activeQuote,prepareQuote,restoreState} from './domain.mjs';
import {makeQuotePDF} from './quote-pdf.mjs';
import {simulateReply} from './journey.mjs';
import {createResetReview,resetReviewedDemo} from './reset-adapter.mjs';
import {navigationState,openReplyQuote,openReplyRevision} from './workflow-adapter.mjs';
import {parseWorkspaceRoute,recordHref,resolveRecordView} from './record-view.mjs';
import {navigationContext,canonicalWorkspaceRoute,applyWorkspaceRoute} from './navigation-context.mjs';


const $=(s,root=document)=>root.querySelector(s);
const searchParams=new URLSearchParams(location.search),sampleSession=searchParams.get('sample')==='1',walkthroughMode=searchParams.get('walkthrough')==='1';
const KEY=walkthroughMode?'nhi-pulley-walkthrough-v1':sampleSession?'nhi-pulley-room-sample-v1':'nhi-pulley-demo-v1';let state=initialState(),persistent=true,errors={},showRevForm=false,rfqSaveResult=null,lastStoredSnapshot;
try{lastStoredSnapshot=localStorage.getItem(KEY);state=restoreState(lastStoredSnapshot)||state;}catch{persistent=false;}
const steps=[['select','Select pulley'],['explore','Explore in 3D'],['configure','Configure & inquire'],['quote','Review quote'],['revision','Reply & revisions']];
function notify(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove('visible'),4500);}
function persist(){
  try{if(localStorage.getItem(KEY)!==lastStoredSnapshot){notify('This case changed in another tab. Reload to continue with the latest saved records; your current edits are session-only.');throw new Error('Saved case changed');}const snapshot=JSON.stringify(state);localStorage.setItem(KEY,snapshot);lastStoredSnapshot=snapshot;persistent=true;}catch{persistent=false;}
  window.dispatchEvent(new CustomEvent('nhi-workspace-status',{detail:{steps:navigationState(state),persistent}}));
  return persistent;
}
function allowed(step,context=state){if(['record','quote-document'].includes(step))return true;if(['revision','next'].includes(step))return !!activeQuote(context);return navigationState(context).find(item=>item.route===step)?.available??['review','rfq','response','components','history','seller','next'].includes(step);}
let activeRoute=null;
function navigate(route){const resolved=applyWorkspaceRoute(state,route);if(resolved.error){notify(resolved.error);return {error:resolved.error};}if(!allowed(resolved.step,resolved.state)){notify('Save or open the matching inquiry before continuing.');return {error:'This destination is not available yet.'};}state=resolved.state;errors={};showRevForm=false;if(state.step!=='rfq')rfqSaveResult=null;persist();if(location.hash!==resolved.route)history.pushState(null,'',resolved.route);activeRoute=resolved.route;render();window.scrollTo({top:0,behavior:'instant'});$('#page-title')?.focus({preventScroll:true});return {state};}
function readLocation(){if(location.hash===activeRoute)return;const resolved=applyWorkspaceRoute(state,location.hash);if(resolved.error||!allowed(resolved.step,resolved.state)){notify(resolved.error||'This destination is unavailable. Your saved records are unchanged.');if(activeRoute)history.replaceState(null,'',activeRoute);return;}state=resolved.state;errors={};showRevForm=false;if(state.step!=='rfq')rfqSaveResult=null;persist();if(location.hash!==resolved.route)history.replaceState(null,'',resolved.route);activeRoute=resolved.route;render();$('#page-title')?.focus({preventScroll:true});}
window.addEventListener('popstate',readLocation);
window.addEventListener('hashchange',readLocation);
const initialRoute=applyWorkspaceRoute(state,location.hash||`#${state.step||'select'}`);
if(!initialRoute.error&&allowed(initialRoute.step,initialRoute.state)){state=initialRoute.state;activeRoute=initialRoute.route;}else{activeRoute=canonicalWorkspaceRoute(state,'#history').route;state={...state,step:'history'};queueMicrotask(()=>notify(initialRoute.error||'Open a saved record or continue your working inquiry.'));}
if(location.hash!==activeRoute)history.replaceState(null,'',activeRoute);
function commitCommercial(result,route){if(result.error)return result;try{if(localStorage.getItem(KEY)!==lastStoredSnapshot)return {state,error:'This case changed in another tab. Reload the latest records before saving this action.'};}catch{return {state,error:'Browser storage is unavailable. Export your case before leaving.'};}const previous=state;state=result.state;if(!persist()){state=previous;return {state,error:'Browser storage could not save this action. Your earlier records are retained. Export the case and try again.'};}if(route)navigate(route);return result;}
function openSeller(revisionId){const result=sellerEntryState(state,revisionId||null);if(result.error){notify(result.error);return result;}state=result.state;navigate('seller');return result;}
function openBuyerQuote(q){if(!q)return {error:'Quote unavailable.'};const result=openHistoryRecord(state,{type:'quote',id:q.id,version:q.version});if(result.error)return result;state=result.state;navigate('quote');return result;}
function openQuoteDocument(q){navigate(`quote-document?${new URLSearchParams({source:'quote',id:q.id,version:String(q.version)})}`);return {state};}
function openCurrentWork(q){const context=commercialContext(state,{rfqId:q?.rfqId||state.activeRfqId});if(context.error||!context.latestQuote){notify(context.error||'No quote is available for this request.');return {error:context.error||'Quote unavailable.'};}const latest=context.latestQuote;if(state.activeRfqId===latest.rfqId&&state.activeQuoteId===latest.id&&state.activeQuoteVersion===latest.version){navigate('quote');return {state};}return openBuyerQuote(latest);}
function returnRecord(view,from){if(view.source==='draft'){navigate(from==='configure'?'configure':'review');return;}if(view.source==='quote'){if(from==='quote-document')openQuoteDocument(view.record);else openCurrentWork(view.record);return;}if(state.activeRfqId===view.record.id){navigate('rfq');return;}const result=openHistoryRecord(state,{type:'rfq',id:view.record.id});if(result.error){notify(result.error);return;}state=result.state;navigate('rfq');}
let renderedRoute=null;
function render(){
  // Selection and inspection share one mounted product stage; other workspaces
  // retain their existing fresh-form lifecycle when their record context changes.
  if(!(['select','explore'].includes(renderedRoute)&&['select','explore'].includes(state.step)))unmountReact();
  renderedRoute=state.step;
  if(activeQuote(state))state=bindRevisionDraft(state);
    const api={
      ...inquiryApi(),
      canRevise:!!activeQuote(state)&&commercialContext(state).latestQuote?.version===activeQuote(state)?.version,
      navigate,reviewReset,confirmReset,finishReset,openSeller,openBuyerQuote,openQuoteDocument,openCurrentWork,returnRecord,recordHref,
      navigationContext:navigationContext(state,parseWorkspaceRoute(location.hash)),walkthroughMode,
      openRecord:(source,record,section,extra)=>navigate(recordHref(source,record,section,extra)),
      openNextStepFor:request=>{const matches=(state.commercial?.nextSteps||[]).filter(r=>r.id===request.id&&r.quoteId===request.quoteId&&r.quoteVersion===request.quoteVersion&&r.rfqId===request.rfqId);if(matches.length!==1){notify('This saved review plan is unavailable.');return;}const result=openHistoryRecord(state,{type:'quote',id:request.quoteId,version:request.quoteVersion});if(result.error||result.state.activeRfqId!==request.rfqId){notify(result.error||'This plan does not match its saved inquiry.');return;}state=result.state;navigate('next');},
      startSample:()=>{location.href=location.pathname+'?sample=1&walkthrough=1#explore';},
      exitWalkthrough:()=>{location.href=location.pathname+'?sample=1#explore';},
      returnWorkspace:()=>{location.href=location.pathname+'#history';},
      saveSellerDraft:options=>commitCommercial(saveSellerDraft(state,options)),
      reviewSellerDraft:key=>reviewSellerDraft(state,key),
      issueSellerDraft:review=>commitCommercial(issueSellerDraft(state,review),'quote'),
      requestNextStep:options=>commitCommercial(requestNextStep(state,options),'next'),
      acknowledgeNextStep:options=>commitCommercial(acknowledgeNextStep(state,options),'next'),
      openHistory:target=>{if(target.type==='quote'){const view=resolveRecordView(state,{source:'quote',id:target.id,version:target.version});if(view.error)return {error:view.error};return openQuoteDocument(view.record);}const result=openHistoryRecord(state,target);if(result.error)return result;state=result.state;navigate(state.step);if(target.type==='revision')requestAnimationFrame(()=>{const el=document.getElementById(`request-${target.id}`);el?.focus();el?.scrollIntoView({block:'start',behavior:'instant'});});return result;},
      setFindMode:value=>{state.findMode=value;persist();},
      updateDiscovery:context=>{state.discovery={...context};persist();},
      selectForInquiry:(id,method,context)=>{const result=selectForInquiry(state,id,method,context);if(!result.error){state=result.state;persist();}return result;},
      setViewerMode:mode=>{state.mode=mode;persist();},
      recordViewed:key=>{if(key!=='overview'&&!state.interests.includes(key)){state.interests.push(key);persist();}},
      saveInquiry:fingerprint=>{const result=saveReviewedInquiry(state,fingerprint);if(result.error||result.errors)return result;state=result.state;rfqSaveResult={id:result.rfq.id,duplicate:!!result.duplicate};navigate('rfq');return result;},
      exportRFQ:id=>{const record=state.rfqs.find(r=>r.id===id);if(!record)throw new Error('Saved RFQ not found.');exportJSON(record,`${record.id}-EXAMPLE.json`);},
      correctInquiry:()=>{navigate('configure');errors=validateDraft(state.draft);render();requestAnimationFrame(()=>{const field=$('[aria-invalid="true"]');field?.focus();field?.scrollIntoView({block:'center',behavior:'instant'});});},
      newRevision:()=>{const q=activeQuote(state),latest=commercialContext(state).latestQuote;if(q?.version!==latest?.version){notify('Open the latest quote before requesting a change.');return;}state=bindRevisionDraft(state);state.revisionEditingKey=state.revisionDraftQuoteKey;navigate('revision');showRevForm=true;render();$('#page-title')?.focus();},
      viewRevisions:()=>{delete state.revisionEditingKey;navigate('revision');},
      prepareQuote:()=>openSeller(),
      selectVersion:version=>{state=selectQuoteVersion(state,state.activeQuoteId,version);persist();render();window.scrollTo({top:0,behavior:'instant'});requestAnimationFrame(()=>$('#page-title')?.focus({preventScroll:true}));},
      updateDraft:(key,draft)=>{state=updateRevisionDraft(state,key,draft);persist();},
      saveRevision:(key,draft)=>{const q=activeQuote(state),latest=commercialContext(state).latestQuote;if(!q||q.id!==latest?.id||q.version!==latest?.version)return {errors:{form:'This is an earlier quote. Open the latest version before saving another change request. Your draft is retained.'}};const result=commitRevisionFor(state,key,draft);if(result.errors)return result;state=result.state;delete state.revisionEditingKey;showRevForm=false;persist();render();window.scrollTo({top:0,behavior:'instant'});$('#page-title')?.focus();return result;},
      exportCase:()=>exportJSON(state,'NHI-demo-case.json'),
      pdf:()=>{try{const q=activeQuote(state);makeQuotePDF(q,window.NHI_LOGO).save(`${q.id}-v${q.version}-EXAMPLE.pdf`);notify('Example quote PDF downloaded.');}catch(error){notify(error.message);}},
      pdfQuote:q=>{const view=resolveRecordView(state,{source:'quote',id:q.id,version:q.version});if(view.error){notify(view.error);return;}try{makeQuotePDF(view.record,window.NHI_LOGO).save(`${q.id}-v${q.version}-EXAMPLE.pdf`);notify('Example quote PDF downloaded.');}catch(error){notify(error.message);}},
      showReply:()=>{const reply=state.replies.find(r=>r.id===activeQuote(state).responseId);if(reply){state.activeRevisionId=reply.revisionId;navigate('response');}},
      simulateReply:id=>{const existing=state.replies.find(r=>r.revisionId===id);if(!existing)return openSeller(id);const request=state.revisions.find(r=>r.id===id),quote=activeQuote(state);if(!request||!quote||request.quoteId!==quote.id||request.quoteVersion!==quote.version||request.rfqId!==state.activeRfqId)throw new Error('Reopen the change request from its original quote.');state.activeRevisionId=id;navigate('response');},
      openReplyQuote:id=>{const reply=state.replies.find(r=>r.id===id);if(reply&&!state.quotes.some(q=>q.responseId===id)){openSeller(reply.revisionId);return {state};}const result=openReplyQuote(state,id);if(result.error)return result;return openQuoteDocument(activeQuote(result.state));},
      openReplyRevision:id=>{const result=openReplyRevision(state,id);if(result.error)return result;state=result.state;navigate('revision');return result;}

    };
    mountReact($('#app'),{state,api,sampleSession,logo:window.NHI_LOGO,routeParams:parseWorkspaceRoute(location.hash).params,initialErrors:errors,rfqSaveResult,showForm:showRevForm||state.revisionEditingKey===`${state.activeQuoteId}:v${state.activeQuoteVersion||1}`,persistent});
}
function exportJSON(value,name){download(JSON.stringify(value,null,2),'application/json',name);}
function download(data,type,name){const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function sampleSketch(){const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="#f4f6f2"/><g font-family="Arial" fill="#263125"><text x="40" y="50" font-size="23">EXAMPLE APPLICATION SKETCH</text><text x="40" y="80" font-size="14">Fieldwork Equipment · Fictional compact mower deck · DEMO ONLY</text><text x="40" y="480" font-size="14">Not an engineering drawing. No mounting dimensions, loads or fit are specified.</text></g><g fill="none" stroke="#55664b" stroke-width="3"><circle cx="220" cy="260" r="86"/><circle cx="580" cy="260" r="86"/><path d="M220 174H580M220 346H580"/><circle cx="400" cy="373" r="27"/><path d="M400 400v33"/></g><g font-family="Arial" font-size="16" fill="#263125"><text x="156" y="265">Drive pulley</text><text x="518" y="265">Driven pulley</text><text x="333" y="454">Idler candidate · F-4412</text></g><text x="40" y="112" font-family="Arial" font-size="13" fill="#607059">Belt path is schematic. Mounting, speed and radial load require review.</text></svg>`;return {name:'demo-application-sketch.svg',size:svg.length,sample:true,type:'image/svg+xml',data:'data:image/svg+xml;base64,'+btoa(svg)};}
async function attachFiles(files){
  const fileErrors=[];let changed=false;
  for(const f of files){
    if(!/\.(pdf|png|jpe?g|svg|step|stp)$/i.test(f.name)){fileErrors.push(`${f.name}: choose a PDF, image or STEP file.`);continue;}
    if(f.size>750*1024||state.draft.attachments.reduce((n,x)=>n+x.size,0)+f.size>1500*1024){fileErrors.push(`${f.name}: limit is 750 KB per file and 1.5 MB total.`);continue;}
    const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);}).catch(()=>null);
    if(!data){fileErrors.push(`Could not read ${f.name}. Try another file.`);continue;}
    state.draft.attachments.push({name:f.name,size:f.size,type:f.type||'application/octet-stream',data});changed=true;
  }
  if(changed&&!persist())fileErrors.push('Browser storage is full. Export the case to retain your attachments.');
  return {files:[...state.draft.attachments],errors:fileErrors};
}
function inquiryApi(){return {
  navigate,
  updateInquiry:(key,value)=>{state.draft[key]=value;persist();},
  attachFiles,
  addSample:()=>{if(!state.draft.attachments.some(f=>f.sample))state.draft.attachments.push(sampleSketch());persist();return [...state.draft.attachments];},
  downloadAttachment:file=>{const a=document.createElement('a');a.href=file.data;a.download=file.name;a.click();},
  updateExplorerDraft:(feature,draft)=>{state.explorerDrafts[`${state.selected}:${feature}`]={...draft,unit:state.unit};persist();},
  saveExplorer:(feature,draft,unknown)=>{const result=saveExplorerInput(state,feature,draft,unknown);if(result.error)return result;state=result.state;persist();return {state,saved:state.draft.explorerRequirements.find(r=>r.id===`${state.selected}:${feature}`)};},
  changeUnit
};}
function reviewReset(){
  const review=createResetReview(state);
  try{
    const storedSnapshot=localStorage.getItem(KEY);
    if(storedSnapshot!==lastStoredSnapshot)return {...review,storedSnapshot:lastStoredSnapshot,storageReadable:true,blocked:'This browser has a newer or different saved case than the one shown here. Keep working, then reload to review those records before resetting.'};
    return {...review,storedSnapshot:lastStoredSnapshot,storageReadable:true};
  }catch{return {...review,storageReadable:false,blocked:'Browser storage is unavailable. Nothing can be reset. Export the current case or keep working.'};}
}
function confirmReset(review,acknowledged){
  if(!review||review.fingerprint!==JSON.stringify(state))return {state,code:'stale-review',stale:true,error:'This case changed after the reset review opened. Review the current records and confirm again.'};
  if(review.blocked)return {state,code:'reset-blocked',blocked:true,error:review.blocked};
  try{
    if(!review?.storageReadable)throw new Error('Storage unavailable.');
    if(review.storedSnapshot!==lastStoredSnapshot||localStorage.getItem(KEY)!==lastStoredSnapshot)return {state,code:'reset-blocked',blocked:true,error:'The saved demo changed in another tab. Nothing was reset. Keep working, then reload to review the latest records before resetting.'};
  }catch{return {state,code:'reset-blocked',blocked:true,error:'Browser storage is unavailable. Nothing was reset. Export the current case or keep working.'};}
  const result=resetReviewedDemo(state,review,acknowledged,value=>{localStorage.setItem(KEY,value);lastStoredSnapshot=value;});
  if(result.reset){state=result.state;persistent=true;}
  return result;
}
function finishReset(){errors={};showRevForm=false;rfqSaveResult=null;renderedRoute=null;navigate('select');notify('Demo reset. The original F-4412 example is ready; previous local records were cleared.');}
function changeUnit(unit){const result=changeExplorerUnit(state,unit);if(result.error)return result;state=result.state;persist();return result;}
render();
