import {parseDimension,product} from './domain.mjs';
import {chooseCandidate} from './journey.mjs';

const dimensions=['od','flat','width'];
const present=value=>String(value??'').trim()!=='';
const validUnit=unit=>unit==='in'||unit==='mm';

export function validateSelectionDimensions(context){
  const errors={};
  for(const key of dimensions){
    if(present(context[key])&&!Number.isFinite(parseDimension(context[key])))errors[key]='Enter a positive dimension, or leave it unknown.';
  }
  return errors;
}

// Convert only working comparison fields. The original context and saved evidence are untouched.
export function convertSelectionDimensions(context,unit){
  const errors=validateSelectionDimensions(context);
  if(Object.keys(errors).length)return {context,errors,error:'Correct or clear the highlighted dimensions before changing units.'};
  if(!validUnit(unit)||!validUnit(context.unit))return {context,errors,error:'Choose inches or millimeters before comparing dimensions.'};
  const next=structuredClone(context);
  if(context.unit!==unit){
    const factor=unit==='mm'?25.4:1/25.4;
    for(const key of dimensions){
      if(!present(context[key]))continue;
      const converted=parseDimension(context[key])*factor;
      if(!Number.isFinite(converted)||converted<=0)errors[key]='Use a dimension that can be represented in the selected unit.';
      else next[key]=String(Number(converted.toPrecision(12)));
    }
  }
  if(Object.keys(errors).length)return {context,errors,error:'Correct the highlighted dimensions before changing units.'};
  next.unit=unit;
  return {context:next};
}

function equivalentComparison(a,b){
  if(!a||!b||!validUnit(a.unit)||!validUnit(b.unit))return false;
  if((a.purpose||'')!==(b.purpose||'')||(a.belt||'')!==(b.belt||''))return false;
  return dimensions.every(key=>{
    if(!present(a[key])||!present(b[key]))return !present(a[key])&&!present(b[key]);
    const x=parseDimension(a[key])/(a.unit==='mm'?25.4:1),y=parseDimension(b[key])/(b.unit==='mm'?25.4:1);
    // Account only for decimal representation after conversion, not an engineering tolerance.
    return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=Math.max(1,Math.abs(x),Math.abs(y))*1e-10;
  });
}

export function selectForInquiry(state,id,method,context=state.discovery){
  if(!product(id))return {state,errors:{},error:'Choose a catalog candidate.'};
  const guided=method==='guided';
  const errors=guided?validateSelectionDimensions(context):{};
  if(Object.keys(errors).length)return {state,errors,error:'Correct or clear the highlighted dimensions before continuing.'};
  if(guided&&!validUnit(context.unit))return {state,errors,error:'Choose inches or millimeters before comparing dimensions.'};
  const next=structuredClone(state);
  next.discovery=structuredClone(context);
  const basis=state.draft.selectionBasis;
  const unchanged=guided&&state.selected===id&&basis?.productId===id&&equivalentComparison(basis.context,context);
  // Reopening the same physical comparison must not rewrite the original requirement units.
  try{return {state:chooseCandidate(next,id,guided&&!unchanged)};}
  catch(error){return {state,errors,error:error.message};}
}
