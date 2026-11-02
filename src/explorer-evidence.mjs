import {requirementText} from './journey.mjs';

// Presentation only: a review question belongs to its inspection theme. Its
// retained dimension field identifies the input slot, not the subject of a
// free-text question. Never rewrite the saved record to change this label.
const themeNames={belt:'Belt contact',flange:'Flange & diameter',mount:'Mounting area'};
export function explorerEvidenceText(record){
  return record.kind==='review'
    ? `${themeNames[record.feature]||'Explorer inspection'}: review requested. No measurement confirmed.`
    : requirementText(record);
}
