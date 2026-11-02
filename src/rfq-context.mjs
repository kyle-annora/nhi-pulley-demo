import {requestFingerprint} from './domain.mjs';
import {commercialContext} from './commercial-adapter.mjs';
import {recordReviewItems} from './review-items.mjs';

// Review responsibilities belong to the displayed packet. Quote navigation is a
// separate relationship and never replaces its retained requirements or questions.
export function rfqViewContext(state,packet){
  const items=packet?recordReviewItems(packet,{includeCommercial:false}):[];
  const result={
    rfq:null,quote:null,pending:[],
    customerItems:items.filter(item=>item.owner==='Customer'),
    engineeringItems:items.filter(item=>item.owner==='Engineering'),
    otherItems:items.filter(item=>!['Customer','Engineering'].includes(item.owner)),
    error:null,draftChanged:false,isCurrentProduct:!!packet&&packet.product?.id===state.selected
  };
  if(!packet)return result;
  const saved=Boolean(packet.id),id=saved?packet.id:state.activeRfqId;
  const matches=(state.rfqs||[]).filter(r=>r.id===id);
  const rfq=matches.length===1?matches[0]:null;
  if(saved)result.draftChanged=requestFingerprint(state.selected,state.draft)!==packet.fingerprint;
  if(!saved&&(!rfq||rfq.product?.id!==packet.product?.id||rfq.caseId!==state.caseId))return result;
  if(!rfq||rfq.caseId!==state.caseId||rfq.product?.id!==packet.product?.id||(saved&&(rfq.version!==packet.version||rfq.fingerprint!==packet.fingerprint||rfq.caseId!==packet.caseId))){
    return {...result,error:'The saved inquiry reference is unavailable or does not match this packet. Existing records are unchanged.'};
  }
  result.rfq=structuredClone(rfq);
  if(!saved)result.draftChanged=requestFingerprint(packet.product.id,packet.requirements)!==rfq.fingerprint;
  const context=commercialContext(state,{rfqId:rfq.id});
  if(context.error)return {...result,error:context.error};
  return {...result,quote:context.latestQuote,pending:context.pendingRevisions};
}
