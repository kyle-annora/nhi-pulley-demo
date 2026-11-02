import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initialState,restoreState,saveRFQ} from '../src/domain.mjs';
import {changeExplorerUnit,explorerInput,saveExplorerInput,explorerDraftChanged} from '../src/inquiry-adapter.mjs';
const baseline=()=>restoreState(readFileSync(new URL('./fixtures/round3-after-case.json',import.meta.url),'utf8'));
const history=s=>Object.fromEntries(['rfqs','quotes','replies','revisions'].map(k=>[k,s[k]]));
test('units convert the working draft, while saved measurements and every existing record retain their original value and unit',()=>{
  const state=baseline(),before=structuredClone(state);state.unit='mm';state.explorerDrafts['F-4412:belt']={value:'19.05',unit:'mm',note:'Measured'};
  const converted=changeExplorerUnit(state,'in').state;
  assert.equal(converted.explorerDrafts['F-4412:belt'].value,'0.75');
  assert.equal(explorerInput(converted,'belt').unit,'in');
  assert.deepEqual(history(converted),history(before));
  assert.deepEqual(converted.draft.explorerRequirements,before.draft.explorerRequirements);
  assert.equal(changeExplorerUnit(converted,'mm').state.explorerDrafts['F-4412:belt'].value,'19.05');
});
test('invalid or nonpositive draft cannot be silently relabeled with a new unit, or saved as confirmed input',()=>{
  for(const value of ['abc','0','-3','1/0']){
    const s=baseline();s.unit='in';s.explorerDrafts['F-4412:belt']={value,unit:'in',note:''};
    const changed=changeExplorerUnit(s,'mm');assert.ok(changed.error);assert.strictEqual(changed.state,s);
    const saved=saveExplorerInput(s,'belt',{value,note:''});assert.ok(saved.error);assert.strictEqual(saved.state,s);
  }
});
test('explicit measurement appends an immutable inquiry snapshot without modifying historic RFQs, quotes, replies or revisions',()=>{
  const s=baseline();s.unit='mm';const before=structuredClone(s);
  const result=saveExplorerInput(s,'belt',{value:'20',note:'Example differing measurement'},false,'2026-11-01T12:00:00Z');
  assert.equal(result.state.draft.explorerRequirements.find(r=>r.feature==='belt').matchesCatalog,false);
  assert.deepEqual(history(result.state),history(before));
  const saved=saveRFQ(result.state,'2026-11-01T12:01:00Z').state;
  assert.equal(saved.rfqs.length,before.rfqs.length+1);
  assert.deepEqual(saved.rfqs.slice(0,-1),before.rfqs);
  for(const key of ['quotes','replies','revisions'])assert.deepEqual(saved[key],before[key]);
  assert.equal(saved.rfqs.at(-1).requirements.explorerRequirements.find(r=>r.feature==='belt').value,20);
});
test('restored draft differences stay visibly unsaved; unknown review clears a stale measurement without claiming confirmation',()=>{
  const s=baseline();s.unit='mm';const original=explorerInput(s,'belt');
  assert.equal(explorerDraftChanged(s,'belt',original),false);
  const edited={...original,value:'20'};assert.equal(explorerDraftChanged(s,'belt',edited),true);
  const result=saveExplorerInput(s,'belt',edited,true,'2026-11-01T12:00:00Z');
  const restored=restoreState(JSON.stringify(result.state));
  assert.equal(explorerInput(restored,'belt').value,'');
  assert.equal(explorerDraftChanged(restored,'belt',explorerInput(restored,'belt')),false);
  assert.equal(restored.draft.explorerRequirements.find(r=>r.feature==='belt').kind,'review');
});

test('explicit F-4412 capture pins shared model revision and catalog source without rewriting previous snapshots',()=>{
  const before=initialState();
  const saved=saveExplorerInput(before,'belt',{value:'3/4',note:'Measured on existing pulley'},false,'2026-11-01T00:00:00Z');
  assert.equal(saved.error,undefined);
  const context=saved.state.draft.explorerRequirements[0].explorerContext;
  assert.equal(context.modelId,'f4412');assert.match(context.modelRevision,/^sha256:[a-f0-9]{64}$/);
  assert.equal(context.theme,'belt');assert.equal(context.catalogSource.page,6);assert.equal(context.manufacturerCAD,false);assert.equal(context.verifiedBOM,false);
  assert.equal(before.draft.explorerRequirements,undefined);
  const converted=changeExplorerUnit(saved.state,'mm');
  assert.deepEqual(converted.state.draft.explorerRequirements,saved.state.draft.explorerRequirements);
});

test('an unsaved engineering request retains its mode across reopening and unit changes before explicit review save',()=>{
  const original=baseline();original.unit='in';
  const measured=saveExplorerInput(original,'belt',{value:'3/4',note:'Drawing D'},false,'2026-11-01T12:00:00Z').state;
  const before=structuredClone(measured),key='F-4412:belt';
  measured.explorerDrafts[key]={...explorerInput(measured,'belt'),mode:'review',note:'Can engineering check B against our belt?'};
  const reopened=restoreState(JSON.stringify(measured));
  assert.equal(explorerInput(reopened,'belt').mode,'review');
  assert.equal(explorerDraftChanged(reopened,'belt',explorerInput(reopened,'belt')),true);
  assert.deepEqual(reopened.draft.explorerRequirements,before.draft.explorerRequirements);

  const converted=changeExplorerUnit(reopened,'mm').state,draft=explorerInput(converted,'belt');
  assert.equal(draft.mode,'review');assert.equal(draft.value,'19.05');
  assert.equal(explorerDraftChanged(converted,'belt',draft),true);
  const submitted=saveExplorerInput(converted,'belt',draft,draft.mode==='review','2026-11-01T12:01:00Z').state;
  const record=submitted.draft.explorerRequirements.find(r=>r.id===key);
  assert.equal(record.kind,'review');assert.equal(record.value,null);
  assert.equal(record.note,'Can engineering check B against our belt?');
  assert.equal(explorerInput(submitted,'belt').mode,'review');
  assert.equal(explorerDraftChanged(submitted,'belt',explorerInput(submitted,'belt')),false);
  assert.deepEqual(history(submitted),history(before));
});

test('mode-only changes are unsaved while untouched unknown mounting and legacy inputs stay unchanged',()=>{
  const fresh=initialState();
  assert.equal(explorerDraftChanged(fresh,'mount',explorerInput(fresh,'mount')),false);
  assert.equal(explorerDraftChanged(fresh,'belt',{...explorerInput(fresh,'belt'),mode:'review'}),true);
  const measured=saveExplorerInput(fresh,'belt',{value:'3/4',note:''},false,'2026-11-01T12:00:00Z').state;
  assert.equal(explorerDraftChanged(measured,'belt',{...explorerInput(measured,'belt'),mode:'review'}),true);
  const reviewed=saveExplorerInput(measured,'belt',explorerInput(measured,'belt'),true,'2026-11-01T12:01:00Z').state;
  assert.equal(explorerInput(reviewed,'belt').mode,'review');
  assert.equal(explorerDraftChanged(reviewed,'belt',{...explorerInput(reviewed,'belt'),mode:'measurement'}),true);
  const legacy=baseline(),before=JSON.stringify(legacy);
  assert.equal(explorerDraftChanged(legacy,'belt',explorerInput(legacy,'belt')),false);
  assert.equal(JSON.stringify(legacy),before);
});
