// Pure projections of the customer's saved evidence. These items are review work,
// never inferred engineering answers. Legacy records are not rewritten.
const copy=value=>structuredClone(value);
const names={belt:'Belt contact',flange:'Flange & clearance',mount:'Mounting'};
const dimensions={width:'D · Belt-running width',od:'A · Outside diameter',flat:'B · Belt-running diameter'};
const item=(id,title,detail,owner,nextAction,source,state='awaiting-review')=>({id,title,detail,owner,nextAction,source,state,status:state==='awaiting-information'?'Customer information needed':state==='awaiting-reply'?'Awaiting seller reply':'Awaiting engineering review',response:owner==='Customer'?'Additional customer information is still needed.':owner==='Sales'?'No supplier answer recorded.':'No engineering answer or approval recorded.',unanswered:true});

export function explorerReviewItems(requirements={},productId){
  return (requirements.explorerRequirements||[]).filter(r=>r.kind==='review'||r.kind==='measurement'&&!r.matchesCatalog).map(r=>{
    const title=names[r.feature]||'Explorer question';
    const evidence=r.kind==='measurement'?`${dimensions[r.dimension]||'Measurement'}: customer measured ${r.value} ${r.unit}; this differs from the catalog value.`:'Customer requested a review; no measurement was confirmed.';
    const detail=[evidence,r.note?.trim()].filter(Boolean).join(' ');
    return item(`explorer:${r.id}:${r.confirmedAt||'retained'}`,title,detail,'Engineering','Answer this saved question and identify any application information still needed.',{kind:'explorer',theme:r.feature,requirementId:r.id,productId:r.productId||productId,note:r.note||'',measurement:r.kind==='measurement'?{dimension:r.dimension,value:r.value,unit:r.unit}:null,explorerContext:r.explorerContext?copy(r.explorerContext):null});
  });
}

export function reviewItemsFor(requirements={}, {productId,revision=null,includeCommercial=false}={}){
  const d=requirements,items=[];
  if(!d.speed)items.push(item('application:speed','Operating speed','Operating speed is unknown.','Customer','Provide RPM or an application reference; ask engineering if the operating speed is unknown.',{kind:'application',field:'speed'},'awaiting-information'));
  if(!d.load)items.push(item('application:load','Radial load','Radial load is unknown.','Customer','Provide load data or describe the loading conditions for engineering to assess.',{kind:'application',field:'load'},'awaiting-information'));
  const mountingRequested=d.mounting!=='Use existing mounting; dimensions attached',references=d.attachments||[],drawingMissing=!references.length,onlyIllustrative=references.length>0&&references.every(f=>f.sample);
  if(mountingRequested||drawingMissing||onlyIllustrative)items.push(item('application:mounting-drawing','Mounting information',drawingMissing?'No mounting drawing or application reference is attached.':onlyIllustrative?'Only an illustrative reference is attached; it does not supply mounting dimensions.':'Mounting dimensions are still marked for confirmation. Attached files do not establish that this information is complete.','Customer','Provide mounting dimensions, offsets and spacers, or identify where the attached reference supplies them.',{kind:'application',field:'attachments'},'awaiting-information'));
  if(mountingRequested||includeCommercial)items.push(item('application:mounting','Mounting & application fit',mountingRequested?'Mounting dimensions and application fit need review.':'The supplied mounting reference still needs an engineering fit review.','Engineering','Check the mounting drawing, offsets, spacers and operating conditions before release.',{kind:'application',field:'mounting'}));
  if(d.finish&&d.finish!=='iron-phosphate')items.push(item(`application:finish:${d.finish}`,'Finish suitability',`Requested finish: ${d.finish}. Feasibility and suitability remain unconfirmed.`,'Engineering','Review the requested finish for the application; a priced allowance is not approval.',{kind:'application',field:'finish',value:d.finish}));
  if(!d.annual)items.push(item('application:annual','Annual demand','Estimated annual demand is not supplied.','Customer','Provide an estimate if known, or confirm that annual demand is unknown.',{kind:'application',field:'annual'},'awaiting-information'));
  items.push(...explorerReviewItems(d,productId));
  if(includeCommercial)items.push(item('commercial:freight-tax','Freight & tax','Freight and applicable tax remain unpriced.','Sales','Request ship-to details from the customer and complete the freight and tax amounts.',{kind:'commercial'},'awaiting-reply'));
  if(revision?.message?.trim())items.push(item(`revision:${revision.id}:question`,'Customer question',revision.message.trim(),'Sales','Reply to the customer question and obtain engineering input where needed.',{kind:'revision',revisionId:revision.id},'awaiting-reply'));
  return copy(items);
}

const legacyId=task=>({
  'Mounting drawing':'application:mounting-drawing','Mounting information':'application:mounting-drawing','Operating speed':'application:speed','Radial load':'application:load','Mounting & application fit':'application:mounting','Finish suitability':'application:finish','Freight & tax':'commercial:freight-tax'
}[task.title]);

export function recordReviewItems(record={}, {reply=null,revision=null,includeCommercial=true}={}){
  // New snapshots are authoritative. Return copies so UI cannot alter history.
  if(Array.isArray(record.reviewItems))return copy(record.reviewItems);
  const requirements=record.requirements||record.quoteSnapshot?.requirements||{};
  const productId=record.product?.id||record.quoteSnapshot?.product?.id;
  const projected=reviewItemsFor(requirements,{productId,revision,includeCommercial});
  // Old reply / next-step tasks can contain a customer question absent elsewhere.
  // Merge those retained tasks while deriving missing explicit Explorer questions.
  const retained=record.openQuestions||record.tasks||reply?.reviewItems||reply?.tasks||[];
  for(const [index,task] of retained.entries()){
    const matching=projected.find(t=>t.id===task.id||t.title===task.title||t.id===legacyId(task));
    if(matching)continue;
    if(task.title==='Measurement discrepancy'&&projected.some(t=>t.source.kind==='explorer'&&t.detail.includes(String(task.detail||'').split('. ')[0])))continue;
    const owner=task.owner==='Customer'?'Customer':task.owner==='Engineering'?'Engineering':task.owner?.includes('sales')||task.owner?.includes('Sales')?'Sales':task.owner?.includes('Customer')?'Customer':'Engineering';
    projected.push({...item(task.id||`retained:${record.id||reply?.id||'record'}:${index}`,task.title||'Retained question',task.detail||'',owner,task.nextAction||'Review this retained question and record the response.',task.source||{kind:'revision'},task.state||'awaiting-reply'),...copy(task),owner});
  }
  return projected.map(t=>({...t,legacyProjection:true}));
}

export function reviewHandoff(items=[]){
  const customer=items.filter(t=>t.owner==='Customer'),sales=items.filter(t=>t.owner==='Sales'),engineering=items.filter(t=>t.owner==='Engineering');
  return {customer:copy(customer),sales:copy(sales),engineering:copy(engineering),nextActor:customer.length?'Customer + seller':'Seller / engineering',status:customer.length?'Review request acknowledged · customer information needed':'Review request acknowledged · seller review pending',expectedOutcome:'Engineering findings on the saved questions, followed by updated commercial terms where needed. Technical approval and the final quote remain pending.'};
}
