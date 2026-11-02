import {reviewItemsFor,recordReviewItems} from './review-items.mjs';
import {PRODUCTS,FINISHES,product,clone,parseDimension,formatDimension,openItems,quoteTotals,money} from './domain.mjs';

export const DIMENSION_NAMES={od:'A · Outside diameter',flat:'B · Belt-running diameter',width:'D · Belt-running width'};
export function assessCandidate(p,context){
  const dimensions=Object.entries(DIMENSION_NAMES).filter(([key])=>String(context[key]||'').trim()).map(([key,label])=>{
    const value=parseDimension(context[key]),inches=context.unit==='mm'?value/25.4:value;
    const valid=Number.isFinite(value),matches=valid&&Math.abs(inches-p[key])<.0005;
    return {key,label,input:context[key],unit:context.unit,valid,matches,catalog:formatDimension(p,key,context.unit)};
  });
  const mismatches=dimensions.filter(d=>!d.matches),matches=dimensions.filter(d=>d.matches);
  return {dimensions,matches:matches.length,mismatches:mismatches.length,status:!dimensions.length?'Dimensions not supplied':mismatches.length?'Dimensions differ':'Entered dimensions match',fitConfirmed:false};
}
export function rankedCandidates(context){return PRODUCTS.map(p=>({product:p,assessment:assessCandidate(p,context)})).sort((a,b)=>a.assessment.mismatches-b.assessment.mismatches||b.assessment.matches-a.assessment.matches);}
export function chooseCandidate(s,id,guided=false){
  if(!product(id))throw new Error('Choose a catalog candidate.');
  const n=clone(s);if(n.selected!==id){n.interests=[];n.draft.explorerRequirements=[];delete n.draft.selectionBasis;}
  n.selected=id;
  if(guided){
    const assessment=assessCandidate(product(id),n.discovery);
    if(assessment.dimensions.some(d=>!d.valid))throw new Error('Use a positive dimension or leave it unknown.');
    n.draft.selectionBasis={productId:id,context:clone(n.discovery),assessment,source:'Public catalog, page 6; customer-entered dimensions. Application fit is unverified.'};
    if(n.discovery.belt)n.draft.belt=n.discovery.belt;
  }
  return n;
}
export function confirmExplorerRequirement(s,{feature,value='',unit='in',note='',unknown=false},now=new Date().toISOString()){
  if(!['belt','flange','mount'].includes(feature))throw new Error('Choose a detail to confirm.');
  const n=clone(s),key=feature==='belt'?'width':feature==='flange'?'od':null;
  const measured=parseDimension(value),review=unknown||feature==='mount';
  if(!review&&!Number.isFinite(measured))throw new Error('Enter a positive measurement, or request a review.');
  const p=product(s.selected),inches=unit==='mm'?measured/25.4:measured;
  const r={id:`${p.id}:${feature}`,productId:p.id,feature,dimension:key,kind:review?'review':'measurement',value:review?null:measured,unit,note:note.trim(),confirmedAt:now,
    matchesCatalog:review?null:Math.abs(inches-p[key])<.0005,
    source:'Explicit customer entry in Explorer; not a manufacturer validation'};
  n.draft.explorerRequirements=[...(n.draft.explorerRequirements||[]).filter(x=>x.id!==r.id),r];
  if(feature==='mount')n.draft.mounting='Confirm mounting dimensions';
  return n;
}
export function requirementText(r){
  const name=r.dimension?DIMENSION_NAMES[r.dimension]:'Mounting';
  return r.kind==='measurement'?`${name}: customer measured ${r.value} ${r.unit}. ${r.matchesCatalog?'Matches the catalog value; fit is not verified.':'Differs from the catalog value; engineering review required.'}`:`${name}: customer requests review. No measurement confirmed.`;
}
export function quoteOpenItems(q){return openItems(q.requirements).map(item=>q.responseId&&q.requirements.finish==='zinc'&&item==='Requested finish needs feasibility and price review.'?'Zinc is budgeted in this example; suitability and manufacturing approval remain pending.':item);}
export function activeRevision(s){return s.revisions.find(r=>r.id===s.activeRevisionId)||s.revisions.filter(r=>r.quoteId===s.activeQuoteId&&r.quoteVersion===(s.activeQuoteVersion||1)).at(-1)||null;}
export function replyFor(s,revisionId){return (s.replies||[]).find(r=>r.revisionId===revisionId)||null;}

// Deliberately bounded demo policy. It never interprets free text or approves fit.
export function simulateReply(s,revisionId,now=new Date().toISOString()){
  const rev=s.revisions.find(r=>r.id===revisionId);if(!rev)throw new Error('Select a saved change request.');
  const base=s.quotes.find(q=>q.id===rev.quoteId&&q.version===rev.quoteVersion);
  if(base?.product.id!=='F-4412')throw new Error('The reply scenario is available for F-4412 only.');
  const n=clone(s);n.replies||=[];n.activeRevisionId=rev.id;n.step='response';
  if(replyFor(n,rev.id))return n;
  const requirements=clone(base.requirements);
  for(const c of rev.changes)requirements[c.field]=c.after;
  const qty=Number(requirements.quantity),unitCents=qty===250?830:860,finishCents=requirements.finish==='zinc'?60:null;
  const lead='6–8 weeks after order and technical review';
  const decisions=[
    {topic:'Quantity & base price',requested:`${qty} units`,response:`${qty} units at ${money(unitCents)} each in the revised example. ${qty===250?'The 250-unit example uses a $0.30 lower base price.':'No quantity discount is assumed.'}`,status:'Included in example'},
    {topic:'Delivery',requested:requirements.timing,response:`Requested timing is not confirmed. Planning alternative: ${lead}. Expedite availability and charges are not assumed.`,status:'Alternative proposed'},
    {topic:'Finish',requested:FINISHES[requirements.finish],response:requirements.finish==='zinc'?'Budget allowance: $0.60 per unit. Zinc suitability and manufacturing approval still need engineering review.':requirements.finish==='iron-phosphate'?'Standard iron phosphate is included in the base example price.':'The requested finish remains unpriced and requires feasibility review.',status:requirements.finish==='zinc'?'Budgeted · conditional':requirements.finish==='iron-phosphate'?'Included in example':'Review required'}
  ];
  const tasks=reviewItemsFor(requirements,{productId:base.product.id,revision:rev,includeCommercial:true});
  // A later quantity / timing change is not an answer to an earlier free-text
  // question. Carry those unresolved questions with their original source IDs.
  const priorReply=(s.replies||[]).find(r=>r.id===base.responseId),priorRevision=(s.revisions||[]).find(r=>r.id===base.revisionId);
  for(const prior of recordReviewItems(base,{reply:priorReply,revision:priorRevision}).filter(t=>t.source?.kind==='revision'&&t.unanswered!==false)){
    if(!tasks.some(t=>t.id===prior.id))tasks.push(clone(prior));
  }
  const reply={id:`REPLY-DEMO-${String(n.replies.length+1).padStart(3,'0')}`,revisionId:rev.id,quoteId:base.id,quoteVersion:base.version,rfqId:base.rfqId,createdAt:now,requirements,unitCents,finishCents,lead,decisions,tasks,reviewItems:clone(tasks),
    status:'Simulated supplier reply · Not sent by NHI',assumption:'Fixed demonstration policy: F-4412 at $8.30 for exactly 250 units, otherwise $8.60; zinc allowance $0.60 each; packing $35. These are invented example prices. Free-text questions are preserved for review, not automatically answered.'};
  n.replies.push(reply);return n;
}
export function issueRevisedQuote(s,replyId,now=new Date().toISOString()){
  const reply=s.replies.find(r=>r.id===replyId);if(!reply)throw new Error('Open a simulated reply first.');
  const n=clone(s),existing=n.quotes.find(q=>q.responseId===replyId);
  if(existing){n.activeQuoteId=existing.id;n.activeQuoteVersion=existing.version;n.activeRfqId=existing.rfqId;n.step='quote';return n;}
  const base=n.quotes.find(q=>q.id===reply.quoteId&&q.version===reply.quoteVersion),qty=Number(reply.requirements.quantity);
  const lines=[{label:'F-4412 · standard iron phosphate',qty,unit:'each',unitCents:reply.unitCents},
    {label:'Example packing allowance',qty:1,unit:'lot',unitCents:3500},
    ...(reply.requirements.finish==='iron-phosphate'?[]:[{label:reply.requirements.finish==='zinc'?'Zinc finish · conditional example allowance':`Finish change: ${FINISHES[reply.requirements.finish]}`,qty,unit:'each',unitCents:reply.finishCents}]),
    {label:'Freight',qty:1,unit:'lot',unitCents:null},{label:'Applicable tax',qty:1,unit:'lot',unitCents:null}];
  const q={...clone(base),version:Math.max(...n.quotes.filter(q=>q.id===base.id).map(q=>q.version))+1,previousVersion:base.version,responseId:reply.id,revisionId:reply.revisionId,createdAt:now,requirements:clone(reply.requirements),reviewItems:recordReviewItems(reply,{includeCommercial:true}),lines,totals:quoteTotals(lines),lead:reply.lead,status:'Example revised quote · Not an NHI offer',assumptions:reply.assumption};
  n.quotes.push(q);n.activeQuoteId=q.id;n.activeQuoteVersion=q.version;n.activeRfqId=q.rfqId;n.activeRevisionId=reply.revisionId;n.step='quote';return n;
}
export function quoteComparison(before,after){
  const finishPrice=q=>q.lines.find(l=>/finish/i.test(l.label)&&!l.label.startsWith('F-'))?.unitCents;
  const finishLabel=q=>q.requirements.finish==='iron-phosphate'?'Included in base price':money(finishPrice(q)??null)+' / unit';
  return [
    ['Quantity',`${before.requirements.quantity} units`,`${after.requirements.quantity} units`],
    ['Base unit price',money(before.lines[0].unitCents),money(after.lines[0].unitCents)],
    ['Finish',FINISHES[before.requirements.finish],FINISHES[after.requirements.finish]],
    ['Finish allowance',finishLabel(before),finishLabel(after)],
    ['Customer requested window',before.requirements.timing,after.requirements.timing],
    ['Example lead time',before.lead,after.lead],
    ['Priced subtotal',money(before.totals.subtotalCents),money(after.totals.subtotalCents)],
    ['Final total',before.totals.totalCents===null?'Pending review':money(before.totals.totalCents),after.totals.totalCents===null?'Pending review':money(after.totals.totalCents)]
  ];
}
