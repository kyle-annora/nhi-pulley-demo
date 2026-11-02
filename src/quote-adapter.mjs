import {activeQuote, clone, saveRevision} from './domain.mjs';

export const quoteKey = q => `${q.id}:v${q.version}`;
const emptyDraft = () => ({quantity:'',timing:'',finish:'',message:''});

// The host remains the sole state owner. UI drafts are explicitly bound to a version.
export function bindRevisionDraft(s) {
  const q=activeQuote(s); if(!q)throw new Error('Open a saved quote first.');
  const key=quoteKey(q);
  if(s.revisionDraftQuoteKey===key)return s;
  const drafts={...(s.revisionDraftsByQuote||{})};
  if(s.revisionDraftQuoteKey)drafts[s.revisionDraftQuoteKey]=clone(s.revisionDraft);
  // An old, unbound draft belongs to the active quote during this one-time adoption.
  const draft=drafts[key]||(!s.revisionDraftQuoteKey?s.revisionDraft:emptyDraft());
  return {...s,revisionDraftsByQuote:drafts,revisionDraftQuoteKey:key,revisionDraft:clone(draft||emptyDraft())};
}
export function updateRevisionDraft(s,key,draft) {
  if(!activeQuote(s)||quoteKey(activeQuote(s))!==key)throw new Error('The displayed quote changed. Reopen its revision form.');
  const next=bindRevisionDraft(s);
  return {...next,revisionDraft:{...emptyDraft(),...draft}};
}
export function commitRevisionFor(s,key,draft,now) {
  const updated=updateRevisionDraft(s,key,draft);
  const result=saveRevision(updated,now);
  if(result.errors)return result;
  result.state.revisionDraftsByQuote={...result.state.revisionDraftsByQuote,[key]:emptyDraft()};
  return result;
}
export function selectQuoteVersion(s,id,version) {
  const q=s.quotes.find(q=>q.id===id&&q.version===version);
  if(!q)throw new Error('That saved quote version is unavailable.');
  const bound=activeQuote(s)?bindRevisionDraft(s):s;
  return bindRevisionDraft({...bound,activeQuoteId:id,activeQuoteVersion:version,activeRfqId:q.rfqId,step:'quote'});
}
