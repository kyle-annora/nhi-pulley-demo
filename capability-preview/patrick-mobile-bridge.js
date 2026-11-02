/* Presentation-only mobile handoff. The unchanged application owns drafts,
   preview identities, review checks and local publication. No storage writes. */
(function(){
  'use strict';
  var CHANNEL='nhi-patrick-capability-mobile-v1',parameters=new URLSearchParams(window.location.search);
  if(parameters.get('patrickMobile')!=='1'||window.parent===window)return;
  var origin=window.location.origin,enabled=false,pending='',lastPreview='';
  function send(type,fields){window.parent.postMessage(Object.assign({channel:CHANNEL,version:1,type:type},fields||{}),origin);}
  function route(){var parts=window.location.hash.slice(1).split('?');return {page:parts[0],id:new URLSearchParams(parts[1]||'').get('id')};}
  function inspect(){
    if(!enabled||!window.location.pathname.endsWith('/studio/'))return;
    var current=route(),preview=current.page==='preview';
    document.documentElement.classList.toggle('patrick-mobile-studio-preview',preview);
    if(preview){
      var frame=document.querySelector('iframe[title="Buyer preview of the product draft"]');
      if(!frame||!current.id)return;
      var url;try{url=new URL(frame.getAttribute('src'),window.location.href);}catch{return;}
      var expected=new URL('../product-room/',window.location.href);
      if(url.origin!==origin||url.pathname!==expected.pathname||url.searchParams.get('model')!=='kinetic-01'||url.searchParams.get('studioPreview')!==current.id||!/^ROOM-PREVIEW-[a-zA-Z0-9-]{8,100}$/.test(current.id))return;
      var page=url.hash.slice(1)||'overview';if(!['overview','explore','specs','inquiry'].includes(page))return;
      if(lastPreview!==url.href){lastPreview=url.href;send('buyer-preview',{id:current.id,page:page});}
    }else{
      lastPreview='';
      if(pending==='back-editor'&&current.page.startsWith('edit')||pending==='review-release'&&current.page==='release'){
        send('studio-visible',{page:current.page==='release'?'release':'editor'});pending='';
      }
    }
  }
  var style=document.createElement('style');
  style.textContent='.patrick-mobile-studio-preview .studio-preview-stage{display:none!important}.patrick-mobile-studio-preview .studio-preview-toolbar>a{display:inline-flex!important}';
  document.head.appendChild(style);
  window.addEventListener('message',function(event){
    var data=event.data;if(event.origin!==origin||event.source!==window.parent||!data||data.channel!==CHANNEL||data.version!==1)return;
    if(data.type==='configure-mobile'){
      enabled=data.enabled===true;if(!enabled)document.documentElement.classList.remove('patrick-mobile-studio-preview');inspect();return;
    }
    if(!enabled||!['back-editor','review-release'].includes(data.type)||!window.location.pathname.endsWith('/studio/'))return;
    var label=data.type==='back-editor'?'Back to editor':'Review release';
    var button=Array.from(document.querySelectorAll('.studio-preview-intro button')).find(function(item){var text=item.querySelector('.ar-button-label');return (text?text.textContent:item.textContent).replace(/\s+/g,' ').trim()===label;});
    if(!button||button.disabled){send('command-unavailable');return;}
    pending=data.type;button.click();inspect();
  });
  document.addEventListener('click',function(event){
    if(!enabled||!window.location.pathname.endsWith('/product-room/'))return;
    var link=event.target.closest&&event.target.closest('#room-version-banner a');
    if(!link)return;
    var url;try{url=new URL(link.getAttribute('href'),window.location.href);}catch{return;}
    var expected=new URL('../studio/',window.location.href);
    if(url.origin!==origin||url.pathname!==expected.pathname||!parameters.get('studioPreview'))return;
    event.preventDefault();event.stopImmediatePropagation();send('back-studio');
  },true);
  new MutationObserver(inspect).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',inspect);window.addEventListener('popstate',inspect);window.addEventListener('annora:routechange',inspect);
})();
