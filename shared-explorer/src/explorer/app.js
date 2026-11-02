import { createDisplayUI } from './display-ui.js';
import { PROJECT_CONFIG } from '../generated/project.js';
import { applyProjectBrand, openingTheme, preferenceNamespace } from './project-brand.js';
import { buildHierarchy, ancestors } from './model-state.js';
import { createNavigation, selectNode, enterScope, toggleBranch } from './navigation-state.js';
import { MODEL_CATALOG, resolveModel, validatePackage } from './model-catalog.js';
import { AssemblyScene } from './scene.js';
import { GuidedTour } from './tour-ui.js';
import { ExplorerController } from './controller.js';
import { createPageLifecycle } from './controller/page-lifecycle.js';
import { createEmbedBridge, configuredParentOrigin } from './embed-bridge.js';
import { serializeBenchmark } from './performance.js';
import { createAssemblySearch, inspectionState, inspectionFacts } from './inspection-ui.js';
import { CLIENT_THEMES, resolveTheme, applyThemeTokens, themeRoles } from './themes.js';

const $ = id => document.getElementById(id);
const shellAbort = new AbortController();
let treeAbort = new AbortController(), detailAbort = new AbortController(), overlayObserver, overlayFrame, layoutFrame, disposeBridge;
const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: shellAbort.signal });
const listenTree = (target, type, callback) => target.addEventListener(type, callback, { signal: treeAbort.signal });
const listenDetail = (target, type, callback) => target.addEventListener(type, callback, { signal: detailAbort.signal });
const icon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); const use = document.createElementNS(svg.namespaceURI,'use'); use.setAttribute('href',`#i-${name}`); svg.append(use); return svg; };
const textNode = (tag,text) => { const node=document.createElement(tag);node.textContent=text;return node; };
const params = new URLSearchParams(location.search);
const model = resolveModel(params.get('model'));
const policy=model.allowedCapabilities, themeStorageKey=preferenceNamespace(PROJECT_CONFIG);
const allowedStyles=policy.renderStyles;
const openingStyle=allowedStyles.includes(params.get('render'))?params.get('render'):allowedStyles.includes('engineering')?'engineering':allowedStyles[0];
applyProjectBrand(PROJECT_CONFIG,document);
let explorer, hierarchy, navigation=createNavigation(model.rootId), renderStyle='engineering', mode='explore';
let displayUI;
const closeDisplay=(restore=false)=>displayUI?.close(restore);
let performanceReport,lastProgress=-1,lastFocus,operationState,guidedTour;
let searchAssembly, treeQuery='', treeSearchResult=null, lastDetailId;
let requestSequence = 0;
const controller = new ExplorerController({ model, port: {
  getScene: () => explorer, getTour: () => guidedTour, getHierarchy: () => hierarchy,
  getTheme: () => ({ id: clientTheme.id, revision: clientTheme.accent }),
  setTheme: id => chooseTheme(resolveTheme(id)), sync: () => { if (explorer?.ready && !shellAbort.signal.aborted) syncPresentationUI(); },
  focus: () => { closeTree(); if (mobileLayout.matches) setDetailsCollapsed(true); },
  dispose: () => { shellAbort.abort(); treeAbort.abort(); detailAbort.abort(); overlayObserver?.disconnect(); cancelAnimationFrame(overlayFrame); cancelAnimationFrame(layoutFrame); guidedTour?.dispose(); explorer?.dispose(); },
} });
function command(method, params = {}) {
  return controller.request({ requestId: `shell-${++requestSequence}`, method, params }).then(event => {
    if (event.payload.status === 'failed' && !shellAbort.signal.aborted) $('status-message').textContent = event.payload.error.message;
    return event;
  });
}
const mobileLayout=matchMedia('(max-width:980px)');
const shortLandscape=matchMedia('(max-width:980px) and (max-height:520px) and (orientation:landscape)');
let storedTheme;
try { storedTheme=JSON.parse(localStorage.getItem(themeStorageKey)||'null'); } catch {}
let clientTheme=openingTheme(PROJECT_CONFIG,params,storedTheme);
applyThemeTokens(clientTheme);
document.body.dataset.model=model.id;
document.title=model.title+' · '+PROJECT_CONFIG.title;
$('loading-label').textContent=`Preparing ${model.title}…`;
$('breadcrumbs').replaceChildren(textNode('span',model.title));
$('selection-title').textContent=model.title;
$('model-select').replaceChildren(...Object.values(MODEL_CATALOG).map(item=>{const option=textNode('option',item.shortTitle);option.value=item.id;return option;}));
$('model-select').value=model.id;
listen($('model-select'),'change',event=>{const url=new URL(location.href);url.searchParams.set('model',event.target.value);url.hash='';location.assign(url);});
$('scene').setAttribute('aria-label',`Interactive ${model.title}. Drag to orbit, scroll to zoom, click to select. Use the assembly index to explore individual parts.`);
$('view-front').textContent=model.viewLabels[0];$('view-rear').textContent=model.viewLabels[1];
$('source-title').textContent=model.title;
const sourceDialog=$('source-dialog');
sourceDialog.querySelector('p:not(.source-note)').textContent=model.sourceDescription;
sourceDialog.querySelector('.source-note').textContent=model.sourceNote;
const sourceLink=sourceDialog.querySelector('a');sourceLink.hidden=!model.sourceUrl;if(model.sourceUrl)sourceLink.href=model.sourceUrl;sourceLink.replaceChildren(document.createTextNode(model.sourceLabel),icon('external'));
if(model.licenseUrl){const license=textNode('a','Read model license');license.href=model.licenseUrl;license.target='_blank';license.rel='noopener noreferrer';sourceDialog.append(license);}
$('open-sources').querySelector('span').textContent=model.attribution;
$('theme-trigger').hidden=!PROJECT_CONFIG.features.themes;
$('mode-explode').hidden=!PROJECT_CONFIG.features.explode;
$('mode-operate').hidden=!PROJECT_CONFIG.features.operation;
$('tour-start').hidden=!policy.tours.length;
$('perf-toggle').hidden=!PROJECT_CONFIG.features.quality;
$('perf-run').hidden=!PROJECT_CONFIG.features.explode;
document.querySelector('.benchmark-description').hidden=!PROJECT_CONFIG.features.explode;
for(const option of $('render-mode').options){option.hidden=!allowedStyles.includes(option.value);option.disabled=option.hidden;}
$('render-mode').hidden=true;


function viewportInsets(){
  const width=$('scene').clientWidth,height=$('scene').clientHeight;
  const rect=selector=>{const node=document.querySelector(selector);return node&&!node.hidden&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'?node.getBoundingClientRect():null;};
  const header=rect('.app-header'),heading=rect('.stage-heading'),dock=guidedTour?.active?rect('#tour-panel'):document.body.classList.contains('performance-open')&&mobileLayout.matches?null:rect('.stage-tools');
  const details=document.body.classList.contains('performance-open')?rect('#perf-panel'):guidedTour?.active?null:rect('.detail-panel'),tree=rect('.assembly-panel');
  const top=Math.max(header?.bottom||0,heading?.bottom||0)+12;
  if(shortLandscape.matches)return guidedTour?.active?{left:12,right:width-Math.min(details?.left||width,dock?.left||width)+12,top,bottom:52}:{left:12,right:width-(details?.left||width)+12,top,bottom:height-(dock?.top||height)+12};
  if(mobileLayout.matches)return {left:12,right:12,top,bottom:height-Math.min(dock?.top||height,details?.top||height)+12};
  return {left:(tree?.right||0)+12,right:width-(details?.left||width)+12,top,bottom:height-(dock?.top||height)+12};
}
function syncTreeAccess(){ $('assembly-panel').inert=(mobileLayout.matches||Boolean(guidedTour?.active))&&!document.body.classList.contains('tree-open'); }
function setDetailsCollapsed(collapsed){
  document.body.classList.toggle('details-collapsed',collapsed);
  $('toggle-details').setAttribute('aria-expanded',String(!collapsed));$('toggle-details').setAttribute('aria-label',collapsed?'Show component details':'Collapse component details');$('toggle-details').title=collapsed?'Show component details':'Collapse component details';$('detail-body').inert=collapsed;
  cancelAnimationFrame(layoutFrame); layoutFrame=requestAnimationFrame(()=>{ if (!shellAbort.signal.aborted) explorer?.refitLayout(); });
}
listen(mobileLayout,'change',()=>{closeTree();setDetailsCollapsed(mobileLayout.matches);});
setDetailsCollapsed(mobileLayout.matches);syncTreeAccess();
function closeTree({restoreFocus=false}={}){
  const hadFocus=$('assembly-panel').contains(document.activeElement),wasOpen=document.body.classList.contains('tree-open');
  document.body.classList.remove('tree-open');$('tree-backdrop').hidden=true;$('toggle-tree').setAttribute('aria-expanded','false');$('toggle-tree').setAttribute('aria-label','Open assembly index');syncTreeAccess();
  if((restoreFocus||hadFocus)&&(mobileLayout.matches||guidedTour?.active))$('toggle-tree').focus({preventScroll:true});
  if(wasOpen)explorer?.refitLayout();
}
function closeTheme(restore=false){$('theme-panel').hidden=true;$('theme-trigger').setAttribute('aria-expanded','false');if(restore)$('theme-trigger').focus();}
function closePerformance(){ $('perf-panel').hidden=true;document.body.classList.remove('performance-open');$('perf-toggle').setAttribute('aria-expanded','false');explorer?.refitLayout(); }
function chooseTheme(theme,persist=true){
  clientTheme=theme;explorer?.setTheme(applyThemeTokens(theme));$('theme-label').textContent=theme.name;$('theme-trigger').setAttribute('aria-label',`Accent color: ${theme.name}`);$('custom-accent').value=theme.accent;$('render-flat').textContent=`Flat ${theme.name==='Custom'?'accent':theme.name}`;
  document.querySelectorAll('.theme-option').forEach(button=>{const active=button.dataset.theme===theme.id;button.classList.toggle('is-selected',active);button.setAttribute('aria-pressed',String(active));});
  displayUI?.sync();
  if(persist&&PROJECT_CONFIG.features.themes){try{localStorage.setItem(themeStorageKey,JSON.stringify({id:theme.id,accent:theme.accent}));}catch{}
    const url=new URL(location.href);url.searchParams.set('theme',theme.id);if(theme.id==='custom')url.searchParams.set('accent',theme.accent);else url.searchParams.delete('accent');history.replaceState(null,'',url);}
}
for(const theme of CLIENT_THEMES){
  const button=document.createElement('button');button.type='button';button.className='theme-option';button.dataset.theme=theme.id;
  const swatch=textNode('span','');swatch.className='theme-swatch';swatch.style.background=theme.accent;
  const copy=textNode('span','');copy.className='theme-option-copy';copy.append(textNode('strong',theme.name),textNode('small',theme.description));
  const check=textNode('span','✓');check.className='theme-check';check.setAttribute('aria-hidden','true');button.append(swatch,copy,check);listen(button,'click',()=>command('setTheme',{themeId:theme.id}));$('theme-options').append(button);
}
chooseTheme(clientTheme,false);
listen($('theme-trigger'),'click',()=>{const open=$('theme-panel').hidden;closeDisplay();closePerformance();closeTree();$('theme-panel').hidden=!open;$('theme-trigger').setAttribute('aria-expanded',String(open));if(open)($('theme-options').querySelector('[aria-pressed="true"]')||$('custom-accent')).focus();});
listen($('theme-close'),'click',()=>closeTheme(true));
listen($('custom-accent'),'input',e=>{if(PROJECT_CONFIG.features.themes){chooseTheme(resolveTheme('custom',e.target.value));controller.notify({force:true});}});
listen(document,'pointerdown',e=>{if(!$('theme-panel').hidden&&!$('theme-panel').contains(e.target)&&!$('theme-trigger').contains(e.target))closeTheme();});
listen($('toggle-details'),'click',()=>setDetailsCollapsed(!document.body.classList.contains('details-collapsed')));

function renderTree(){
  if(!hierarchy)return;
  treeAbort.abort(); treeAbort = new AbortController();
  const tree=$('component-tree'), focused=document.activeElement;
  const focusId=focused?.dataset.node,focusRole=focused?.dataset.treeRole;
  treeSearchResult=searchAssembly(treeQuery);
  const search=treeSearchResult;
  $('clear-search').hidden=!treeQuery;
  $('tree-search-status').hidden=!search;
  $('tree-search-status').textContent=search?(search.total?`${search.total} ${search.total===1?'match':'matches'}${search.total>search.shown?` · First ${search.shown}. Refine your search.`:''}`:'No matching parts. Try another name.') : '';
  $('collapse-tree').disabled=Boolean(search);
  tree.replaceChildren();
  const render=(id,parent,depth)=>{
    if(search&&!search.visible.has(id))return;
    const node=hierarchy.nodes.get(id), row=textNode('div','');row.className='tree-row'+(id===hierarchy.root.id?' tree-root':'')+(id===navigation.selectedId?' is-selected':'');row.dataset.inScope=String(id===navigation.scopeId);row.style.setProperty('--depth',depth);
    const expanded=(search?search.expanded:navigation.expanded).has(id);
    if(node.children.length&&!search){const toggle=document.createElement('button');toggle.type='button';toggle.className='tree-toggle';toggle.dataset.node=id;toggle.dataset.treeRole='toggle';toggle.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} ${node.title}`);toggle.setAttribute('aria-expanded',String(expanded));toggle.append(icon('chevron'));listenTree(toggle,'click',()=>{controller.takeover();navigation=toggleBranch(navigation,hierarchy.nodes,id);renderTree();});row.append(toggle);}
    else {const spacer=textNode('span','');spacer.className='tree-toggle-spacer';spacer.setAttribute('aria-hidden','true');row.append(spacer);}
    const button=document.createElement('button');button.type='button';button.className='tree-select';button.dataset.node=id;button.dataset.treeRole='select';button.title=node.title;
    const symbols=model.presentationPolicy.navigationIcons||{};
    const mark=icon(symbols[id]||(node.type==='component'?'cube':'layers'));mark.classList.add('node-icon');const label=textNode('span',id===hierarchy.root.id?(model.shortTitle||model.title||node.title):node.title);label.className='tree-label';button.append(mark,label);
    button.setAttribute('aria-pressed',String(id===navigation.selectedId));
    if(id===navigation.scopeId){const badge=textNode('small','');badge.className='tree-scope-badge';badge.title='Current view';badge.setAttribute('aria-label','Current view');badge.append(icon('focus'));button.append(badge);}
    listenTree(button,'click',()=>select(id));listenTree(button,'pointerenter',event=>{if(event.pointerType!=='touch')explorer?.highlight(id);});listenTree(button,'pointerleave',()=>explorer?.hideHover());listenTree(button,'focus',()=>explorer?.highlight(id));listenTree(button,'blur',()=>explorer?.hideHover());row.append(button);
    if(id===navigation.selectedId&&inspectionState(hierarchy.nodes,id,navigation.scopeId).canInspect){const enter=document.createElement('button');enter.type='button';enter.className='tree-enter';enter.dataset.node=id;enter.dataset.treeRole='enter';enter.setAttribute('aria-label','Inspect '+node.title);enter.title='Inspect '+node.title;enter.append(icon('arrow'));listenTree(enter,'click',()=>inspect(id,{restoreFocus:true}));row.append(enter);}
    parent.append(row);
    if(node.children.length&&expanded){const children=textNode('div','');children.className='tree-children';parent.append(children);node.children.forEach(child=>render(child,children,depth+1));}
  };
  render(hierarchy.root.id,tree,0);
  if(focusId&&focusRole)tree.querySelector(`[data-node="${CSS.escape(focusId)}"][data-tree-role="${focusRole}"]`)?.focus({preventScroll:true});
}
function clearSearch(){treeQuery='';$('assembly-search').value='';renderTree();}
// Arrow navigation changes focus/disclosure only. Enter selects; Inspect enters a scope.
listen($('component-tree'),'keydown',event=>{
  const item=event.target.closest('[data-tree-role="select"]');if(!item)return;
  const items=[...$('component-tree').querySelectorAll('[data-tree-role="select"]')],index=items.indexOf(item),node=hierarchy.nodes.get(item.dataset.node);
  let next;
  if(event.key==='ArrowDown')next=items[Math.min(items.length-1,index+1)];
  else if(event.key==='ArrowUp')next=items[Math.max(0,index-1)];
  else if(event.key==='Home')next=items[0];
  else if(event.key==='End')next=items.at(-1);
  else if(event.key==='ArrowRight'){
    if(node.children.length&&!navigation.expanded.has(node.id)&&!treeQuery){event.preventDefault();navigation=toggleBranch(navigation,hierarchy.nodes,node.id);renderTree();return;}
    if(node.children.length)next=items[index+1];
  }else if(event.key==='ArrowLeft'){
    if(node.children.length&&navigation.expanded.has(node.id)&&!treeQuery){event.preventDefault();navigation=toggleBranch(navigation,hierarchy.nodes,node.id);renderTree();return;}
    next=items.find(button=>button.dataset.node===node.parent);
  }
  if(next){event.preventDefault();next.focus();}
});
listen($('assembly-search'),'input',event=>{treeQuery=event.target.value;renderTree();});
listen($('assembly-search'),'keydown',event=>{if(event.key==='Escape'&&treeQuery){event.preventDefault();event.stopPropagation();clearSearch();}});
listen($('clear-search'),'click',()=>{clearSearch();$('assembly-search').focus();});
listen($('reveal-selection'),'click',()=>{
  treeQuery='';$('assembly-search').value='';navigation=selectNode(navigation,hierarchy.nodes,navigation.selectedId);renderTree();
  const item=$('component-tree').querySelector(`[data-node="${CSS.escape(navigation.selectedId)}"][data-tree-role="select"]`);item?.focus({preventScroll:true});item?.scrollIntoView({block:'nearest'});
});
listen($('collapse-tree'),'click',()=>{navigation={...navigation,expanded:new Set(ancestors(hierarchy.nodes,navigation.scopeId).map(node=>node.id))};renderTree();});
function renderDetails(){
  detailAbort.abort(); detailAbort = new AbortController();
  const state=inspectionState(hierarchy.nodes,navigation.selectedId,navigation.scopeId),{selected}=state,scopePath=ancestors(hierarchy.nodes,navigation.scopeId);
  if(lastDetailId!==selected.id){$('model-details').open=false;lastDetailId=selected.id;}
  $('breadcrumbs').replaceChildren();scopePath.forEach((node,index)=>{if(index){const separator=textNode('span','/');separator.className='separator';separator.setAttribute('aria-hidden','true');$('breadcrumbs').append(separator);}const item=textNode(index===scopePath.length-1?'span':'button',node.title);if(item.tagName==='BUTTON'){item.type='button';listenDetail(item,'click',()=>inspect(node.id));}else item.setAttribute('aria-current','page');$('breadcrumbs').append(item);});
  $('breadcrumbs').scrollLeft=$('breadcrumbs').scrollWidth;
  $('back-scope').hidden=!state.scopeParent;
  if(state.scopeParent){$('back-scope').setAttribute('aria-label',`Back to ${state.scopeParent.title}`);$('back-scope').title=`Back to ${state.scopeParent.title}`;}
  $('selection-title').textContent=selected.title;$('selection-description').textContent=mode==='operate'&&selected.id===model.rootId&&operationState?.stage?operationState.stage.description:selected.id===model.rootId?(model.presentationPolicy?.root?.description||selected.description):selected.description;$('selection-badge').textContent=state.kind;
  const context=$('selection-context');context.hidden=state.within&&!navigation.isolated;context.textContent=navigation.isolated&&selected.id===navigation.scopeId?'Isolated · Surrounding parts hidden.':state.context;context.dataset.outside=String(!state.within);
  $('selection-meta').replaceChildren();for(const[label,value]of inspectionFacts(state,model))$('selection-meta').append(textNode('dt',label),textNode('dd',value));
  const source=[['Source meshes',selected.meshNames.length.toLocaleString()]];
  const finish=explorer?.meshes.get(selected.meshName)?.userData.spec?.label;if(finish)source.push(['Display finish',finish]);
  if(selected.sourceName)source.push(['Source label',selected.sourceName]);
  $('source-meta').replaceChildren();for(const[label,value]of source)$('source-meta').append(textNode('dt',label),textNode('dd',value));
  $('focus-selection').dataset.action=state.canInspect?'inspect':'frame';$('focus-selection').disabled=false;$('focus-selection').querySelector('span').textContent=state.action;$('focus-selection').title=state.canInspect?'Enter this item and bring it into view':'Center this selection without changing the assembly';$('focus-selection').querySelector('use').setAttribute('href',state.canInspect?'#i-arrow':'#i-focus');
  const isolatedSelection=navigation.isolated&&selected.id===navigation.scopeId;
  $('isolate-selection').setAttribute('aria-pressed',String(isolatedSelection));$('isolate-selection').querySelector('span').textContent=isolatedSelection?'Show context':'Isolate';$('isolate-selection').disabled=selected.id===model.rootId;$('isolate-selection').hidden=selected.id===model.rootId;
  $('isolate-selection').title=isolatedSelection?'Show the surrounding assembly':'View only this selection';
  $('status-message').textContent=state.canInspect?'Selected · Inspect to enter':state.context;
  document.body.dataset.selection=selected.id;document.body.dataset.scope=navigation.scopeId;document.body.dataset.depth=String(scopePath.length-1);
  const scope=hierarchy.nodes.get(navigation.scopeId),canSeparate=scope.type!=='component';
  $('mode-explode').disabled=!canSeparate;$('mode-explode').title=canSeparate?'Separate the current assembly':'Return to an assembly to separate its parts';
  $('explode-toggle').disabled=!canSeparate;$('explode-range').disabled=!canSeparate;
}
function select(id){
  if(!explorer?.ready||!hierarchy.nodes.has(id))return;
  command('select',{nodeId:id});
}
function inspect(id,{restoreFocus:requestedFocus=false}={}){
  if(!explorer?.ready||!hierarchy.nodes.has(id))return;
  const pathFocus=$('breadcrumbs').contains(document.activeElement)||document.activeElement===$('back-scope');
  const restoreFocus=(mobileLayout.matches||Boolean(guidedTour?.active))&&(requestedFocus||[$('assembly-panel'),document.querySelector('.detail-panel'),$('breadcrumbs')].some(panel=>panel.contains(document.activeElement)));
  command('focus',{nodeId:id}).then(()=>{if(pathFocus&&!shellAbort.signal.aborted)($('back-scope').hidden?$('model-select'):$('back-scope')).focus({preventScroll:true});});closeTree({restoreFocus});
}
listen($('focus-selection'),'click',()=>{const state=inspectionState(hierarchy.nodes,navigation.selectedId,navigation.scopeId);if(state.canInspect)inspect(navigation.selectedId);else command('frame',{nodeId:navigation.selectedId});});
listen($('back-scope'),'click',()=>{const parent=hierarchy?.nodes.get(navigation.scopeId)?.parent;if(parent)inspect(parent);});
listen($('isolate-selection'),'click',()=>command('isolate',{nodeId:navigation.isolated&&navigation.selectedId===navigation.scopeId?null:navigation.selectedId}));
listen($('toggle-tree'),'click',()=>{
  if(document.body.classList.contains('tree-open')){closeTree();$('toggle-tree').focus({preventScroll:true});return;}
  guidedTour?.closeChapters();controller.takeover();closeDisplay();closePerformance();closeTheme();lastFocus=document.activeElement;
  document.body.classList.add('tree-open');syncTreeAccess();$('tree-backdrop').hidden=!mobileLayout.matches;$('toggle-tree').setAttribute('aria-expanded','true');$('toggle-tree').setAttribute('aria-label','Close assembly index');$('close-tree').focus({preventScroll:true});explorer?.refitLayout();
});
for(const id of ['close-tree','tree-backdrop'])listen($(id),'click',()=>{closeTree();lastFocus?.focus();});
listen(document,'keydown',event=>{
  if(event.key==='Escape'){
    if(sourceDialog.open){event.preventDefault();sourceDialog.close();return;}
    if(!$('perf-panel').hidden){closePerformance();explorer?.cancelBenchmark();$('perf-toggle').focus();return;}
    if(!$('theme-panel').hidden){closeTheme(true);return;}
    if(!$('display-panel').hidden){closeDisplay(true);return;}
    if(guidedTour?.closeChapters(true)){event.preventDefault();return;}
    if(document.body.classList.contains('tree-open')){closeTree();lastFocus?.focus();return;}
    if(guidedTour?.active){event.preventDefault();command('exitTour');return;}
  }
  const panel=mobileLayout.matches&&document.body.classList.contains('tree-open')?$('assembly-panel'):!$('theme-panel').hidden?$('theme-panel'):!$('perf-panel').hidden?$('perf-panel'):!$('display-panel').hidden?$('display-panel'):null;
  if(event.key==='Tab'&&panel){const items=[...panel.querySelectorAll('button:not(:disabled),input,select')].filter(node=>node.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
listen($('open-sources'),'click',()=>{if(guidedTour?.active)command('pauseTour');$('source-dialog').showModal();});listen($('close-sources'),'click',()=>$('source-dialog').close());listen($('source-dialog'),'click',event=>{if(event.target===$('source-dialog'))$('source-dialog').close();});
function setView(reverse=false){if(!explorer?.ready)return;command('frame',{nodeId:navigation.scopeId,view:reverse?'rear':'front'});$('view-front').setAttribute('aria-pressed',String(!reverse));$('view-rear').setAttribute('aria-pressed',String(reverse));}
listen($('reset-view'),'click',()=>setView());listen($('view-front'),'click',()=>setView());listen($('view-rear'),'click',()=>setView(true));

function syncOperation(state){
  if(!state)return;operationState=state;mode=state.mode;document.body.dataset.mode=mode;document.body.dataset.playing=String(state.playing);document.body.dataset.operationProgress=String(state.progress);
  for(const value of ['explore','explode','operate'])$('mode-'+value).setAttribute('aria-pressed',String(mode===value));
  $('mode-operate').disabled=!state.available||!policy.operation;$('operation-availability').hidden=state.available||!PROJECT_CONFIG.features.operation;$('explode-controls').hidden=mode!=='explode'&&!state.separation?.playing&&!(state.separation?.available&&state.separation.progress<1);$('operation-controls').hidden=mode!=='operate';
  const separation=state.separation||{}, resumable=separation.available&&separation.progress>0&&separation.progress<1;
  const separationLabel=separation.playing?'Pause':resumable?'Resume':explorer?.fraction>.001?'Reassemble':'Separate';
  $('explode-toggle').querySelector('span').textContent=separationLabel;$('explode-toggle').setAttribute('aria-label',separationLabel+' assembly');$('explode-toggle').setAttribute('aria-pressed',String(Boolean(separation.playing)));$('explode-toggle').querySelector('use').setAttribute('href',separation.playing?'#i-pause':resumable?'#i-play':'#i-expand');
  $('explode-replay').disabled=!separation.available;
  $('operation-play').querySelector('span').textContent=state.playing?'Pause':state.progress>=1?'Replay cycle':state.progress>0?'Resume':'Run cycle';$('operation-play').querySelector('use').setAttribute('href',state.playing?'#i-pause':'#i-play');$('operation-play').setAttribute('aria-label',state.playing?'Pause operation':'Run one operating cycle');$('operation-play').setAttribute('aria-pressed',String(state.playing));
  $('operation-range').value=String(state.progress*100);$('operation-progress').value=`${state.time.toFixed(1)} / ${state.duration.toFixed(1)} s`;$('operation-range').setAttribute('aria-valuetext',`${Math.round(state.progress*100)} percent · ${state.stage?.title||'Ready'}`);
  $('operation-stage').textContent=state.stage?`${String(state.stage.index+1).padStart(2,'0')} / ${String(state.stage.count).padStart(2,'0')} · ${state.stage.title}`:'Ready to operate';$('operation-stage').title=state.stage?.description||'';$('operation-speed').value=String(state.speed);$('operation-follow').checked=Boolean(state.followCamera);
  if(hierarchy&&state.scopeId&&state.scopeId!==navigation.scopeId){navigation=enterScope(navigation,hierarchy.nodes,state.scopeId);renderTree();renderDetails();}
  if(hierarchy&&state.selectedId&&state.selectedId!==navigation.selectedId){navigation=selectNode(navigation,hierarchy.nodes,state.selectedId);renderTree();renderDetails();}
  if(hierarchy&&navigation.isolated!==state.isolated){navigation={...navigation,isolated:state.isolated};renderDetails();}
  if(hierarchy&&navigation.selectedId===model.rootId)$('selection-description').textContent=state.mode==='operate'&&state.stage?state.stage.description:(model.presentationPolicy?.root?.description||hierarchy.root.description);
}
for(const value of ['explore','explode','operate'])listen($('mode-'+value),'click',()=>command('setMode',{mode:value}));
listen($('operation-play'),'click',()=>command(explorer?.getOperationState().playing?'pauseOperation':'playOperation'));
listen($('operation-reset'),'click',()=>command('replayOperation'));
listen($('operation-speed'),'change',event=>command('setOperationSpeed',{speed:Number(event.target.value)}));
listen($('operation-follow'),'change',event=>command('setFollowCamera',{enabled:event.target.checked}));
listen($('operation-range'),'input',event=>command('seekOperation',{progress:Number(event.target.value)/100}));
listen($('explode-toggle'),'click',()=>{
  const state=explorer?.getSeparationState();
  if(state?.playing)command('pauseExplosion');
  else if(state?.available&&state.progress>0&&state.progress<1)command('resumeExplosion');
  else command('setExplosion',{progress:explorer?.fraction>.001?0:1});
});
listen($('explode-replay'),'click',()=>command('replayExplosion'));
listen($('explode-range'),'pointerdown',()=>{controller.takeover();explorer?.pauseCamera();});
listen($('explode-range'),'input',event=>command('setExplosion',{progress:Number(event.target.value)/100,transition:'immediate'}));
listen($('explode-range'),'change',()=>command('frame',{nodeId:navigation.scopeId}));
displayUI=createDisplayUI({document,command,scene:()=>explorer,styles:allowedStyles,signal:shellAbort.signal,accentName:()=>clientTheme.name==='Custom'?'accent':clientTheme.name,beforeOpen:()=>{closeTheme();closePerformance();closeTree();}});

listen($('perf-toggle'),'click',()=>{const open=$('perf-panel').hidden;if(!open){closePerformance();return;}if(guidedTour?.active)command('pauseTour');closeDisplay();closeTheme();closeTree();$('perf-panel').hidden=false;document.body.classList.add('performance-open');$('perf-toggle').setAttribute('aria-expanded','true');$('perf-close').focus();explorer?.refitLayout();});
listen($('perf-close'),'click',()=>{closePerformance();$('perf-toggle').focus();});listen($('perf-quality'),'change',event=>command('setQuality',{profile:event.target.value}));
listen($('perf-run'),'click',async()=>{if(!explorer?.ready||!PROJECT_CONFIG.features.quality||!PROJECT_CONFIG.features.explode)return;if(guidedTour?.active)await command('exitTour');lastProgress=-1;performanceReport=null;$('perf-run').disabled=true;$('perf-quality').disabled=true;$('perf-cancel').hidden=false;$('perf-download').disabled=true;document.body.dataset.benchmark='running';explorer.startBenchmark();});
listen($('perf-cancel'),'click',()=>explorer?.cancelBenchmark());
listen($('perf-download'),'click',()=>{if(!performanceReport)return;const url=URL.createObjectURL(new Blob([serializeBenchmark(performanceReport)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`${model.id}-${performanceReport.mode}-${performanceReport.quality}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function showReport(report){
  if(!report)return;performanceReport=report;document.body.dataset.benchmark=report.status;$('perf-run').disabled=false;$('perf-quality').disabled=false;$('perf-cancel').hidden=true;$('perf-download').disabled=false;$('perf-status').textContent=report.status==='completed'?'This browser · 12-second motion check':'Check cancelled';
  const dl=document.createElement('dl'),metric=(value,unit='')=>Number.isFinite(value)?`${value}${unit}`:'—';
  for(const[label,value]of [['Median frame rate',metric(report.frames.medianFps,' fps')],['Frame interval · p95',metric(report.frames.frameIntervalMs.p95,' ms')],['Draw calls / frame',metric(report.drawCallsPerRenderedFrame.p50)],['Frames over 50 ms',report.frames.over50Ms],['First linework frame',report.loading.firstTechnicalMs===undefined?'Not measured':report.loading.firstTechnicalMs+' ms']])dl.append(textNode('dt',label),textNode('dd',value));
  const details=document.createElement('details');details.append(textNode('summary','Measurement details'));const pre=textNode('pre',serializeBenchmark(report));pre.id='perf-json';details.append(pre);$('perf-results').replaceChildren(dl,textNode('p','Current browser only. Physical ordinary-device testing remains pending.'),details);
}

function syncPresentationUI(){
  if(!explorer)return;displayUI?.sync();
  const previousStyle=renderStyle;renderStyle=explorer.renderStyle||'engineering';
  if($('render-mode').value!==renderStyle)$('render-mode').value=renderStyle;
  document.body.dataset.technical=String(renderStyle!=='engineering');
  document.body.dataset.renderStyle=renderStyle;
  if(previousStyle!==renderStyle)$('status-message').textContent=$('render-mode').selectedOptions[0].textContent;
  // The scene already emits operation/scope changes; avoid rebuilding DOM at frame rate.
  if(!guidedTour?.active)syncOperation(explorer.getOperationState());
}

async function start(){
  try{
    controller.setLifecycle('loading');
    const response=await fetch(model.metadataUrl,{signal:shellAbort.signal});if(!response.ok)throw new Error('Model metadata could not be loaded.');const metadata=await response.json();validatePackage(metadata,model);if(shellAbort.signal.aborted)return;hierarchy=buildHierarchy(metadata,model.presentationPolicy);searchAssembly=createAssemblySearch(hierarchy.nodes);
    const config={...model,operation:metadata.operation?{...metadata.operation,cameraDirection:model.defaultDirection}:null};
    explorer=new AssemblyScene($('scene'),metadata,hierarchy,{
      select,inspect,operation:syncOperation,insets:viewportInsets,theme:themeRoles(clientTheme),
      tourTick:time=>guidedTour?.tick(time)||false,frame:()=>{guidedTour?.updateAnnotations();controller.notify();},interact:()=>controller.takeover(),
      edgeStatus(state){if(state==='loading')$('status-message').textContent='Preparing technical linework…';},
      quality(requested,effective){$('perf-status').textContent=requested===effective?'Quality: '+requested:'Balanced adapted to Performance for smoother motion';document.body.dataset.quality=effective;},
      benchmarkScope(){navigation=enterScope(navigation,hierarchy.nodes,model.rootId);renderTree();renderDetails();closeTree();},
      benchmarkSelection(id){navigation=selectNode(navigation,hierarchy.nodes,id);renderTree();renderDetails();},report:showReport,
      benchmarkProgress(value){const progress=Math.floor(value*10)*10;if(progress!==lastProgress){lastProgress=progress;$('perf-status').textContent='Motion check · '+progress+'%';}},
      hover(node,position){const label=$('hover-label');label.hidden=!node;if(node){label.textContent=node.title;label.style.left=Math.min(position.x,$('viewport').clientWidth-200)+'px';label.style.top=Math.min(position.y,$('viewport').clientHeight-70)+'px';}},
      explosion(fraction){const percent=Math.round(fraction*100);$('explode-range').value=String(percent);$('explode-value').value=percent+'%';document.body.dataset.explosion=fraction.toFixed(4);},
    },config);
    await explorer.load(model.modelUrl,progress=>{$('loading-progress').style.width=Math.round(progress*100)+'%';$('loading-label').textContent=progress<1?`Loading ${model.shortTitle} · ${Math.round(progress*100)}%`:'Preparing materials and lighting…';});
    if(openingStyle!=='engineering')await explorer.setRenderStyle(openingStyle);
    if(shellAbort.signal.aborted)return;syncPresentationUI();
    if(policy.tours.length)guidedTour=new GuidedTour({scene:explorer,model,command,stateChange:()=>controller.notify(),captureNavigation:()=>({...navigation,expanded:new Set(navigation.expanded)}),restoreNavigation:saved=>{navigation=saved;renderTree();renderDetails();},syncScene:syncPresentationUI,closeOverlays:()=>{closeDisplay();closeTree();closeTheme();closePerformance();},syncLayout:()=>{syncTreeAccess();explorer.refitLayout();}});
    renderTree();renderDetails();syncOperation(explorer.getOperationState());$('assembly-search').disabled=false;$('reveal-selection').disabled=false;$('loading').hidden=true;document.body.dataset.ready='true';$('perf-run').disabled=!PROJECT_CONFIG.features.explode;controller.setLifecycle('ready');
    overlayObserver=new ResizeObserver(()=>{if(!explorer.ready||shellAbort.signal.aborted)return;cancelAnimationFrame(overlayFrame);overlayFrame=requestAnimationFrame(()=>{document.documentElement.style.setProperty('--dock-height',`${document.querySelector('.stage-tools').getBoundingClientRect().height}px`);explorer.refitLayout();$('breadcrumbs').scrollLeft=$('breadcrumbs').scrollWidth;});});
    for(const selector of ['.detail-panel','.assembly-panel','.stage-tools','.stage-heading','#perf-panel','#tour-panel'])overlayObserver.observe(document.querySelector(selector));
    listen($('scene'),'keydown',event=>{
      if(guidedTour?.active){
        if(event.code==='Space'){event.preventDefault();const state=guidedTour.player.state();if(state.status==='playing')command('pauseTour');else if(guidedTour.reducedMotion){const chapter=guidedTour.tour.chapters[state.index+1];command(chapter?'goToTourChapter':'seekTour',chapter?{chapterId:chapter.id}:{seconds:guidedTour.tour.duration});}else command('resumeTour');}
        else if(event.key.toLowerCase()==='r')command('frame',{nodeId:navigation.scopeId});return;
      }
      if(event.key==='Escape'&&navigation.scopeId!==model.rootId)inspect(hierarchy.nodes.get(navigation.scopeId).parent);
      if(event.key.toLowerCase()==='r')command('frame',{nodeId:navigation.scopeId});
      if(event.code==='Space'&&mode==='operate'){event.preventDefault();command(explorer.getOperationState().playing?'pauseOperation':'playOperation');}
    });
  }catch(error){if(shellAbort.signal.aborted)return;controller.setLifecycle('error',error);explorer?.dispose();console.error(error);$('loading-label').textContent='The model could not be loaded. Reload this page to try again.';$('status-message').textContent='Model unavailable';document.body.dataset.error=error.message;}
}
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
controller.setEnvironment({visible:!document.hidden,reducedMotion:reducedMotion.matches});
listen(document,'visibilitychange',()=>controller.setEnvironment({visible:!document.hidden}));
listen(reducedMotion,'change',event=>controller.setEnvironment({reducedMotion:event.matches}));
const parentOrigin=configuredParentOrigin(location);
if(parentOrigin)disposeBridge=createEmbedBridge({controller,parentOrigin,window});
const pageLifecycle=createPageLifecycle({controller,getScene:()=>explorer,getTour:()=>guidedTour,disposeBridge:()=>disposeBridge?.()});
listen(window,'pagehide',event=>pageLifecycle.hide(event));
listen(window,'pageshow',event=>pageLifecycle.show(event));
start();
