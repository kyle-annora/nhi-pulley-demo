import { DISPLAY_DEFAULTS, DISPLAY_PROFILES } from './display-profiles.js';

/** A shell surface over the same controller used by embedding clients. */
export function createDisplayUI({ document, command, scene, styles, signal, beforeOpen, accentName }) {
  const $ = id => document.getElementById(id), panel=$('display-panel'), trigger=$('display-trigger');
  const listen=(node,type,fn)=>node.addEventListener(type,fn,{signal});
  let busy=false,lastPresentation='';
  const close=(restore=false)=>{panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(restore)trigger.focus();};
  const buttons=[];
  for(const style of styles) {
    const profile=DISPLAY_PROFILES[style],button=document.createElement('button');button.type='button';button.dataset.style=style;button.className='display-option';
    // Static, locally authored symbols and text. Model packages cannot inject markup.
    button.innerHTML=`<svg aria-hidden="true"><use href="#i-${profile.icon}"/></svg><span><strong></strong><small></small></span><span class="display-check" aria-hidden="true">✓</span>`;
    button.querySelector('strong').textContent=profile.title;button.querySelector('small').textContent=profile.description;
    listen(button,'click',async()=>{if(busy||!scene()?.ready)return;busy=true;sync();
      try {const event=await command('setRenderStyle',{style});if(event.payload.status==='completed'){const url=new URL(location.href);url.searchParams.set('render',style);history.replaceState(null,'',url);}}
      finally {busy=false;sync();if(!panel.hidden&&(document.activeElement===document.body||document.activeElement===button))button.focus({preventScroll:true});}
    });
    $('display-options').append(button);buttons.push(button);
  }
  for(const id of ['grid','ambientOcclusion','featureEdges','hiddenEdges','lineWeight'])listen($('display-'+id),'change',event=>command('setDisplayOptions',{options:{[id]:id==='lineWeight'?event.target.value:event.target.checked}}));
  listen($('display-reset'),'click',()=>command('setDisplayOptions',{options:{...DISPLAY_DEFAULTS}}));
  listen(trigger,'click',()=>{const open=panel.hidden;if(open){beforeOpen();panel.hidden=false;trigger.setAttribute('aria-expanded','true');sync();(buttons.find(button=>button.getAttribute('aria-pressed')==='true')||$('display-close')).focus();}else close(true);});
  listen($('display-close'),'click',()=>close(true));
  listen(document,'pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!trigger.contains(event.target))close();});
  function sync(force=false){
    const current=scene(),style=current?.renderStyle||'engineering',options={...DISPLAY_DEFAULTS,...current?.displayOptions},title=style==='flat'?`Flat ${accentName()}`:DISPLAY_PROFILES[style].title;
    const signature=JSON.stringify([Boolean(current?.ready),busy,style,options,title]);
    if(!force&&signature===lastPresentation)return;lastPresentation=signature;
    $('display-current').textContent=title;trigger.setAttribute('aria-label',`Display settings: ${title}`);
    for(const button of buttons){button.disabled=busy||!current?.ready;button.setAttribute('aria-pressed',String(button.dataset.style===style));if(button.dataset.style==='flat')button.querySelector('strong').textContent=`Flat ${accentName()}`;}
    panel.setAttribute('aria-busy',String(busy));$('display-legend').textContent=busy?'Preparing display…':DISPLAY_PROFILES[style].legend;
    $('display-engineering').hidden=style!=='engineering';$('display-linework').hidden=style==='engineering';
    for(const [id,value] of Object.entries(options)){const input=$('display-'+id);if(id==='lineWeight')input.value=value;else input.checked=value;input.disabled=!current?.ready;}
    $('display-reset').disabled=!current?.ready;
  }
  sync();return {sync,close};
}
