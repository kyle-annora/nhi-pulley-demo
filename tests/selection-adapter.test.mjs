import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {restoreState,requestFingerprint} from '../src/domain.mjs';
import {validateSelectionDimensions,convertSelectionDimensions,selectForInquiry} from '../src/selection-adapter.mjs';

const fixture=()=>restoreState(readFileSync(new URL('./fixtures/round5-after-case.json',import.meta.url),'utf8'));
const history=state=>structuredClone(Object.fromEntries(['rfqs','quotes','replies','revisions'].map(key=>[key,state[key]])));

test('comparison units convert fractions and decimals without mutating inputs or relabeling invalid values',()=>{
  const original={purpose:'Replace an existing pulley',belt:'Back side of V-belt',od:'3-1/8',flat:'2.75',width:'3/4',unit:'in'};
  const before=structuredClone(original),metric=convertSelectionDimensions(original,'mm');
  assert.deepEqual(metric.context,{...original,od:'79.375',flat:'69.85',width:'19.05',unit:'mm'});
  assert.deepEqual(original,before);
  assert.deepEqual(convertSelectionDimensions(metric.context,'in').context,{...original,od:'3.125',flat:'2.75',width:'0.75'});
  assert.equal(convertSelectionDimensions({...original,width:''},'mm').context.width,'');
  for(const value of ['0','-1','not a dimension','1/0']){
    const input={...original,width:value},result=convertSelectionDimensions(input,'mm');
    assert.ok(result.errors.width);assert.ok(result.error);assert.strictEqual(result.context,input);
    assert.equal(result.context.unit,'in');assert.equal(result.context.width,value);
  }
  const oversized={...original,width:'1e308'},overflow=convertSelectionDimensions(oversized,'mm');
  assert.ok(overflow.errors.width);assert.strictEqual(overflow.context,oversized);
  assert.deepEqual(validateSelectionDimensions({od:' ',flat:'',width:null}),{});
});

test('equivalent metric selection preserves the exact original inquiry and historical evidence',()=>{
  const state=fixture(),before=structuredClone(state),context=convertSelectionDimensions(state.discovery,'mm').context;
  const result=selectForInquiry(state,state.selected,'guided',context);
  assert.equal(result.error,undefined);
  assert.equal(result.state.discovery.unit,'mm');
  assert.deepEqual(result.state.draft,before.draft);
  assert.deepEqual(result.state.interests,before.interests);
  assert.equal(requestFingerprint(result.state.selected,result.state.draft),requestFingerprint(before.selected,before.draft));
  assert.deepEqual(history(result.state),history(before));
  assert.deepEqual(state,before);
});

test('meaningful comparison changes update current selection reasons while leaving saved RFQs untouched',()=>{
  const state=fixture(),before=structuredClone(state),context={...state.discovery,width:'7/8'};
  const result=selectForInquiry(state,state.selected,'guided',context);
  assert.equal(result.error,undefined);
  assert.equal(result.state.draft.selectionBasis.context.width,'7/8');
  assert.equal(result.state.draft.selectionBasis.assessment.status,'Dimensions differ');
  assert.deepEqual(result.state.draft.explorerRequirements,before.draft.explorerRequirements);
  assert.deepEqual(history(result.state),history(before));
  assert.deepEqual(state,before);
});

test('committing another candidate clears only its working product evidence and keeps saved records and other inquiry fields',()=>{
  const state=fixture(),before=structuredClone(state),result=selectForInquiry(state,'F-4414','part');
  assert.equal(result.error,undefined);assert.equal(result.state.selected,'F-4414');
  assert.deepEqual(result.state.draft.explorerRequirements,[]);
  assert.equal(result.state.draft.selectionBasis,undefined);
  assert.deepEqual(result.state.interests,[]);
  const retained=structuredClone(before.draft);retained.explorerRequirements=[];delete retained.selectionBasis;
  assert.deepEqual(result.state.draft,retained);
  assert.deepEqual(history(result.state),history(before));
  assert.deepEqual(result.state.explorerDrafts,before.explorerDrafts);
  assert.deepEqual(state,before);
});

test('invalid candidates, invalid guided dimensions and unknown units cannot change selection or records',()=>{
  const state=fixture(),before=structuredClone(state);
  for(const args of [
    ['F-9999','part',state.discovery],
    ['F-9999','guided',state.discovery],
    ['F-4414','guided',{...state.discovery,od:'0'}],
    ['F-4414','guided',{...state.discovery,width:'abc'}],
    ['F-4414','guided',{...state.discovery,unit:'cm'}]
  ]){
    const result=selectForInquiry(state,...args);
    assert.ok(result.error);assert.strictEqual(result.state,state);assert.deepEqual(state,before);
  }
  assert.ok(selectForInquiry(state,'F-4414','guided',{...state.discovery,width:'abc'}).errors.width);
  const unitResult=convertSelectionDimensions(state.discovery,'cm');
  assert.ok(unitResult.error);assert.strictEqual(unitResult.context,state.discovery);
});
