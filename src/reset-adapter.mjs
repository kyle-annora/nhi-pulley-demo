import {initialState} from './domain.mjs';

// Opening a review is read-only. The fingerprint includes every field reset will replace,
// including working drafts and record contents, rather than only their visible counts.
export function createResetReview(state){
  return Object.freeze({
    fingerprint:JSON.stringify(state),
    caseId:state.caseId,
    selected:state.selected,
    counts:Object.freeze({
      rfqs:(state.rfqs||[]).length,
      nextSteps:(state.commercial?.nextSteps||[]).length,acknowledgements:(state.commercial?.acknowledgements||[]).length,
      quoteVersions:(state.quotes||[]).length,
      replies:(state.replies||[]).length,
      revisions:(state.revisions||[]).length,
      draftFiles:(state.draft?.attachments||[]).length,
      explorerInputs:(state.draft?.explorerRequirements||[]).length
    })
  });
}

// writeSnapshot must be synchronous and atomic, like localStorage.setItem on the one
// demo key. Commit the replacement to browser storage before the host adopts it.
export function resetReviewedDemo(state,review,acknowledged,writeSnapshot){
  if(acknowledged!==true)return {state,code:'acknowledgement-required',error:'Confirm that you understand which local demo records will be cleared.'};
  if(!review||typeof review.fingerprint!=='string'||review.fingerprint!==JSON.stringify(state))return {state,code:'stale-review',stale:true,error:'This case changed after the reset review opened. Review the current records and confirm again.'};
  const next=initialState();
  try{
    if(typeof writeSnapshot!=='function')throw new Error('Storage writer unavailable.');
    const result=writeSnapshot(JSON.stringify(next));
    if(result===false||result?.then)throw new Error('Storage write did not complete synchronously.');
  }catch{
    return {state,code:'storage-unavailable',error:'The browser could not save the fresh demo. Nothing was reset. Export the current case, or keep working and try again later.'};
  }
  return {state:next,reset:true};
}
