import {reviewItemsFor} from './review-items.mjs';
import {activeRFQ,product,openItems,requestFingerprint,saveRFQ} from './domain.mjs';

// Both screens use the same document shape; a saved view never reads the working draft.
export function inquiryDocument(state,source='draft'){
  if(source==='saved'){
    const record=activeRFQ(state);
    return record?structuredClone(record):null;
  }
  return {id:null,version:null,createdAt:null,product:structuredClone(product(state.selected)),requirements:structuredClone(state.draft),interests:[...state.interests],openItems:openItems(state.draft),reviewItems:reviewItemsFor(state.draft,{productId:state.selected}),fingerprint:requestFingerprint(state.selected,state.draft)};
}
export function saveReviewedInquiry(state,fingerprint,now){
  if(fingerprint!==requestFingerprint(state.selected,state.draft))return {state,error:'Your draft changed after this review opened. Review the current requirements before saving.'};
  return saveRFQ(state,now);
}
export function rfqStatus({persistent=true,draftChanged=false,duplicate=false}={}){
  return {
    title:persistent?'RFQ saved in this browser':'RFQ kept in this session only',
    detail:persistent?'This is a local demo record. No request has been sent to NHI.':'Browser storage is unavailable or full. Export the case before leaving; no request has been sent to NHI.',
    kind:persistent?'saved':'error',
    draftChanged,
    duplicate:duplicate?'This exact request was already saved. Its existing record has been reopened.':''
  };
}
