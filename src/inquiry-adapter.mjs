import {F4412_MODEL_META} from './f4412-model-meta.mjs';
import {parseDimension} from './domain.mjs';
import {confirmExplorerRequirement} from './journey.mjs';

export function explorerInput(state,feature){
  const key=`${state.selected}:${feature}`;
  const saved=state.draft.explorerRequirements?.find(r=>r.id===key);
  const draft=state.explorerDrafts[key]||{value:saved?.kind==='measurement'?String(saved.value):'',unit:saved?.unit||state.unit,note:saved?.note||''};
  const n=parseDimension(draft.value);
  return {...draft,value:draft.unit!==state.unit&&Number.isFinite(n)?String(+(n*(state.unit==='mm'?25.4:1/25.4)).toFixed(4)):draft.value,unit:state.unit};
}
export function changeExplorerUnit(state,unit){
  if(!['in','mm'].includes(unit)||unit===state.unit)return {state};
  const next=structuredClone(state);
  for(const [key,draft] of Object.entries(next.explorerDrafts)){
    if(draft.unit===unit)continue;
    const n=parseDimension(draft.value);
    if(String(draft.value||'').trim()&&(!Number.isFinite(n)||n<=0))return {state,error:'Correct or clear the measurement before changing units.',feature:key.split(':')[1]};
    if(Number.isFinite(n))draft.value=String(+(n*(unit==='mm'?25.4:1/25.4)).toFixed(4));
    draft.unit=unit;
  }
  next.unit=unit;
  return {state:next};
}
export function saveExplorerInput(state,feature,draft,unknown=false,now){
  try {
    const next=confirmExplorerRequirement(state,{feature,...draft,unit:state.unit,unknown},now);
    if(state.selected==='F-4412'){const record=next.draft.explorerRequirements.find(r=>r.id===`${state.selected}:${feature}`);if(record)record.explorerContext={...structuredClone(F4412_MODEL_META),theme:feature};}
    const review=unknown||feature==='mount';
    next.explorerDrafts[`${state.selected}:${feature}`]={...draft,mode:review?'review':'measurement',value:review?'':draft.value,unit:state.unit};
    return {state:next};
  }catch(error){return {state,error:error.message};}
}
export function explorerDraftChanged(state,feature,draft){
  const saved=state.draft.explorerRequirements?.find(r=>r.id===`${state.selected}:${feature}`);
  const mode=feature==='mount'?'review':['measurement','review'].includes(draft.mode)?draft.mode:saved?.kind||'measurement';
  if(!saved)return Boolean(String(draft.value||'').trim()||draft.note?.trim()||(feature!=='mount'&&mode==='review'));
  if(mode!==saved.kind)return true;
  if((draft.note||'')!==(saved.note||''))return true;
  if(saved.kind!=='measurement')return Boolean(String(draft.value||'').trim());
  const entered=parseDimension(draft.value),expected=saved.unit===state.unit?saved.value:saved.value*(state.unit==='mm'?25.4:1/25.4);
  return !Number.isFinite(entered)||Math.abs(entered-expected)>0.000051;
}
