import {requestFingerprint} from './domain.mjs';
import {commercialContext} from './commercial-adapter.mjs';

// The inquiry draft is independent of saved quotations. Only describe records
// belonging to its active, same-product RFQ; never synchronize their contents.
export function inquiryDraftContext(state){
  const matches=(state.rfqs||[]).filter(r=>r.id===state.activeRfqId&&r.product?.id===state.selected&&r.caseId===state.caseId);
  if(matches.length!==1)return {rfq:null,quote:null,pending:[],changed:false};
  const rfq=matches[0],changed=requestFingerprint(state.selected,state.draft)!==rfq.fingerprint;
  const context=commercialContext(state,{rfqId:rfq.id});
  if(context.error)return {rfq,quote:null,pending:[],changed};
  return {rfq,quote:context.latestQuote,pending:context.pendingRevisions,changed};
}
