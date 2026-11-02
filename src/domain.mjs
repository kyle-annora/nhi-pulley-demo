import {explorerReviewItems,reviewItemsFor} from './review-items.mjs';
export const CATALOG = 'https://newhampshireindustries.s3.amazonaws.com/NHI+Idler+%26+Drive+Pulleys+Catalog.pdf#page=6';
export const PRODUCTS = [
  {id:'F-4412', name:'Double-flange flat idler', od:3.125, flat:2.75, width:.75, odLabel:'3-1/8', flatLabel:'2-3/4', widthLabel:'3/4', feature:'Main demo product', model:true},
  {id:'F-4414', name:'Double-flange flat idler', od:3.25, flat:2.75, width:.875, odLabel:'3-1/4', flatLabel:'2-3/4', widthLabel:'7/8', feature:'Wider belt-running surface', model:false},
  {id:'F-4812', name:'Double-flange flat idler', od:3.21875, flat:3, width:.75, odLabel:'3-7/32', flatLabel:'3', widthLabel:'3/4', feature:'20° flared flanges', model:false}
];
export const FINISHES = {'iron-phosphate':'Standard iron phosphate',zinc:'Zinc finish — request for review',powder:'Powder paint — request for review',custom:'Other finish — describe in notes'};
export const product = id => PRODUCTS.find(p=>p.id===id);
export const clone = value => JSON.parse(JSON.stringify(value));
export function initialState(){return {
  schema:1, caseId:'DEMO-4412', selected:'F-4412', step:'select', unit:'in', mode:'3d', interests:[],
  draft:{quantity:'200', annual:'3000', timing:'6 weeks from order', application:'Idler for a compact mower deck; back side of a V-belt.', belt:'Back side of V-belt', finish:'iron-phosphate',mounting:'Confirm mounting dimensions',speed:'',load:'',notes:'',company:'Fieldwork Equipment',name:'Alex Morgan',email:'alex@fieldwork.example',attachments:[]},
  rfqs:[],quotes:[],revisions:[],replies:[],activeRfqId:null,activeQuoteId:null,activeQuoteVersion:1,activeRevisionId:null,
  discovery:{purpose:'',belt:'',od:'',flat:'',width:'',unit:'in'},explorerDrafts:{},
  revisionDraft:{quantity:'',timing:'',finish:'',message:''}
};}
export function parseDimension(value){
  const t=String(value).trim(); if(!t)return null;
  const f=t.match(/^(?:(\d+)[ -])?(\d+)\/(\d+)$/);
  const n=f?Number(f[1]||0)+Number(f[2])/Number(f[3]):Number(t);
  return Number.isFinite(n)&&n>0?n:NaN;
}
export function findProducts({part='',od='',flat='',width='',unit='in'}={}){
  const key=part.toUpperCase().replace(/[\s-]/g,'');
  const fields={od,flat,width};
  return PRODUCTS.filter(p=>p.id.replace(/-/g,'').includes(key)&&Object.entries(fields).every(([k,v])=>{
    if(!String(v).trim())return true;
    const n=parseDimension(v); if(!Number.isFinite(n))return false;
    return Math.abs(p[k]-(unit==='mm'?n/25.4:n))<0.0005;
  }));
}
export function formatDimension(p,key,unit='in'){
  return unit==='mm'?`${+(p[key]*25.4).toFixed(3)} mm`:`${p[key+'Label']}″`;
}
const positiveInt=v=>/^\d+$/.test(String(v))&&Number.isSafeInteger(Number(v))&&Number(v)>0&&Number(v)<=10000000;
export function validateDraft(d){
  const e={};
  if(!positiveInt(d.quantity))e.quantity='Enter a whole number from 1 to 10,000,000.';
  if(d.annual&&!positiveInt(d.annual))e.annual='Enter a whole number, or leave this unknown.';
  if(!d.application.trim())e.application='Describe the application so it can be reviewed.';
  if(!d.timing.trim())e.timing='Enter a requested window, or type “To be discussed”.';
  if(!FINISHES[d.finish])e.finish='Select a finish request.';
  if(d.finish==='custom'&&!d.notes.trim())e.notes='Describe the requested finish in the notes.';
  if(!d.name.trim())e.name='Enter a contact name.';
  if(!d.company.trim())e.company='Enter a company name.';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email))e.email='Enter an email such as alex@company.com.';
  for(const key of ['speed','load'])if(d[key]&&(!Number.isFinite(Number(d[key]))||Number(d[key])<=0))e[key]='Enter a positive value, or leave unknown.';
  return e;
}
export function openItems(d){return [
  !d.speed&&'Operating speed is unknown.',
  !d.load&&'Radial load is unknown.',
  d.mounting!=='Use existing mounting; dimensions attached'&&'Mounting dimensions need review.',
  d.mounting==='Use existing mounting; dimensions attached'&&!d.attachments.length&&'A mounting drawing has not been attached.',
  d.finish!=='iron-phosphate'&&'Requested finish needs feasibility and price review.',
  !d.annual&&'Annual demand is unknown.',
  ...reviewItemsFor(d).filter(r=>r.id==='application:mounting-drawing').map(r=>r.detail),
  ...explorerReviewItems(d).map(r=>`${r.title}: ${r.detail}`)
].filter(Boolean);}
export function requestFingerprint(selected,draft){return JSON.stringify({selected,draft});}
export function activeRFQ(s){return s.rfqs.find(r=>r.id===s.activeRfqId)||null;}
export function activeQuote(s){return s.quotes.find(q=>q.id===s.activeQuoteId&&q.version===(s.activeQuoteVersion||1))||null;}
export function hasDraftChanges(s){const r=activeRFQ(s);return !!r&&requestFingerprint(s.selected,s.draft)!==r.fingerprint;}
export function saveRFQ(s,now=new Date().toISOString()){
  const errors=validateDraft(s.draft); if(Object.keys(errors).length)return {state:s,errors};
  const same=s.rfqs.find(r=>r.fingerprint===requestFingerprint(s.selected,s.draft));
  if(same){const n=clone(s);n.activeRfqId=same.id;const q=s.quotes.filter(q=>q.rfqId===same.id).at(-1);n.activeQuoteId=q?.id||null;n.activeQuoteVersion=q?.version||1;n.step='rfq';return {state:n,rfq:same,duplicate:true};}
  const n=clone(s),version=n.rfqs.length+1;
  const r={id:`RFQ-DEMO-${String(version).padStart(3,'0')}`,version,caseId:s.caseId,createdAt:now,product:clone(product(s.selected)),requirements:clone(s.draft),interests:[...s.interests],openItems:openItems(s.draft),reviewItems:reviewItemsFor(s.draft,{productId:s.selected}),fingerprint:requestFingerprint(s.selected,s.draft)};
  n.rfqs.push(r);n.activeRfqId=r.id;n.activeQuoteId=null;n.step='rfq';return {state:n,rfq:r};
}
export function quoteTotals(lines){
  const priced=lines.filter(l=>l.unitCents!==null);
  const subtotal=priced.reduce((sum,l)=>sum+l.qty*l.unitCents,0);
  return {subtotalCents:subtotal,totalCents:priced.length===lines.length?subtotal:null,pending:lines.filter(l=>l.unitCents===null).map(l=>l.label)};
}
export function prepareQuote(s,now=new Date().toISOString()){
  const r=activeRFQ(s);if(!r)throw new Error('Save an RFQ first.');
  const n=clone(s),existing=n.quotes.filter(q=>q.rfqId===r.id).at(-1);
  if(existing){n.activeQuoteId=existing.id;n.activeQuoteVersion=existing.version;n.step='quote';return n;}
  const lines=[{label:`${r.product.id} · standard iron phosphate`,qty:Number(r.requirements.quantity),unit:'each',unitCents:r.product.id==='F-4412'?860:null},
    {label:'Example packing allowance',qty:1,unit:'lot',unitCents:3500},
    ...(r.requirements.finish==='iron-phosphate'?[]:[{label:`Finish change: ${FINISHES[r.requirements.finish]}`,qty:Number(r.requirements.quantity),unit:'each',unitCents:null}]),
    {label:'Freight',qty:1,unit:'lot',unitCents:null},{label:'Applicable tax',qty:1,unit:'lot',unitCents:null}];
  const q={id:`Q-DEMO-${String(new Set(n.quotes.map(q=>q.id)).size+1).padStart(3,'0')}`,version:1,rfqId:r.id,rfqVersion:r.version,caseId:r.caseId,createdAt:now,product:clone(r.product),requirements:clone(r.requirements),reviewItems:reviewItemsFor(r.requirements,{productId:r.product.id,includeCommercial:true}),lines,totals:quoteTotals(lines),lead:'6–8 weeks after order and technical review',terms:'Example only: Net 30, subject to account approval.',validity:'Example only: 30 days from the displayed quote date.',status:'Example quote · Not an NHI offer'};
  n.quotes.push(q);n.activeQuoteId=q.id;n.activeQuoteVersion=q.version;n.step='quote';return n;
}
export function validateRevision(q,d){
  const e={};if(d.quantity&&!positiveInt(d.quantity))e.quantity='Enter a positive whole number.';
  if(d.finish&&!FINISHES[d.finish])e.finish='Select a finish.';
  const changed=(d.quantity&&Number(d.quantity)!==Number(q.requirements.quantity))||(d.timing&&d.timing!==q.requirements.timing)||(d.finish&&d.finish!==q.requirements.finish)||d.message.trim();
  if(!changed)e.message='Describe a question or change at least one requested value.';
  return e;
}
export function saveRevision(s,now=new Date().toISOString()){
  const q=activeQuote(s);if(!q)throw new Error('Open a quote first.');
  const errors=validateRevision(q,s.revisionDraft);if(Object.keys(errors).length)return {state:s,errors};
  const n=clone(s),d=clone(s.revisionDraft),changes=[];
  for(const key of ['quantity','timing','finish'])if(d[key]&&String(d[key])!==String(q.requirements[key]))changes.push({field:key,before:q.requirements[key],after:d[key]});
  const rev={id:`REV-DEMO-${String(n.revisions.length+1).padStart(3,'0')}`,quoteId:q.id,quoteVersion:q.version,rfqId:q.rfqId,createdAt:now,changes,message:d.message, status:'Demo change request saved'};
  n.revisions.push(rev);n.activeRevisionId=rev.id;n.revisionDraft={quantity:'',timing:'',finish:'',message:''};n.step='revision';return {state:n,revision:rev};
}
export const money=cents=>cents===null?'To be confirmed':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export function restoreState(raw){
  try{const s=JSON.parse(raw);if(s?.schema!==1||!product(s.selected)||!s.draft||!Array.isArray(s.rfqs)||!Array.isArray(s.quotes)||!Array.isArray(s.revisions)||!Array.isArray(s.draft.attachments))return null;return {...initialState(),...s,draft:{...initialState().draft,...s.draft}};}catch{return null;}
}
