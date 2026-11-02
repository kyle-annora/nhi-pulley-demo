export const MOBILE_CAPABILITY_CHANNEL='nhi-patrick-capability-mobile-v1';
const previewId=/^ROOM-PREVIEW-[a-zA-Z0-9-]{8,100}$/;

export function capabilityURL(mode,base){
  const url=new URL(mode==='studio'?'./capability-preview/studio/':'./capability-preview/',base);
  if(mode==='studio'){url.searchParams.set('patrickMobile','1');url.hash='products';}
  else{url.searchParams.set('model','kinetic-01');url.searchParams.set('appearance','dark');}
  return url.href;
}

export function mobileBuyerURL({id,page='overview'},base){
  if(typeof id!=='string'||!previewId.test(id))return null;
  if(!['overview','explore','specs','inquiry'].includes(page))return null;
  const url=new URL('./capability-preview/product-room/',base);
  url.searchParams.set('model','kinetic-01');url.searchParams.set('studioPreview',id);url.searchParams.set('patrickMobile','1');url.hash=page;
  return url.href;
}

export function readMobileCapabilityMessage(event,{origin,studioWindow,buyerWindow}){
  if(event.origin!==origin||!event.data||event.data.channel!==MOBILE_CAPABILITY_CHANNEL||event.data.version!==1)return null;
  const {type,id,page}=event.data;
  if(event.source===studioWindow&&studioWindow){
    if(type==='buyer-preview'&&typeof id==='string'&&previewId.test(id)&&['overview','explore','specs','inquiry'].includes(page))return {type,id,page};
    if(type==='studio-visible'&&['editor','release'].includes(page))return {type,page};
    if(type==='command-unavailable')return {type};
  }
  if(event.source===buyerWindow&&buyerWindow&&type==='back-studio')return {type};
  return null;
}
