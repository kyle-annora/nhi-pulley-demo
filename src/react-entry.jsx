import {activeQuote} from './domain.mjs';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {SellerWorkspace,NextStepPanel} from './features/commercial-workspace';
import {Heading,Button,ActionGroup} from './components/primitives';
import {ComponentCatalog} from './features/component-catalog';
import {QuoteWorkspace,QuoteDocumentWorkspace,RevisionWorkspace} from './features/quote-workspace';
import {ConfigureWorkspace,ExplorerRequirements} from './features/inquiry-workspace';
import {ProductRoomWorkspace} from './features/selection-workspace';
import {WorkspaceShell} from './components/workspace-shell';
import {ResponseWorkspace} from './features/response-workspace';
import {InquiryReview,SavedRFQ} from './features/rfq-workspace';
import {RecordWorkspace} from './features/record-workspace';
import {HistoryWorkspace} from './features/history-workspace';
import {WalkthroughGuide} from './features/walkthrough-guide';
let root=null;
export function unmountReact(){if(root){root.unmount();root=null;}}
export function mountReact(container,props){
  if(!root)root=createRoot(container);
  const View=props.state.step==='record'?RecordWorkspace:props.state.step==='quote-document'?QuoteDocumentWorkspace:props.state.step==='seller'?SellerWorkspace:props.state.step==='next'?NextStepWorkspace:props.state.step==='history'?HistoryWorkspace:props.state.step==='response'?ResponseWorkspace:['select','explore'].includes(props.state.step)?ProductRoomWorkspace:props.state.step==='review'?InquiryReview:props.state.step==='rfq'?SavedRFQ:props.view==='explorer'?ExplorerRequirements:props.state.step==='configure'?ConfigureWorkspace:props.state.step==='components'?ComponentCatalog:props.state.step==='revision'?RevisionWorkspace:QuoteWorkspace;
  flushSync(()=>root.render(<WorkspaceShell {...props} walkthrough={props.api.walkthroughMode?<WalkthroughGuide {...props}/>:null}><View {...props} route={props.state.step}/></WorkspaceShell>));
}

function NextStepWorkspace(props){const quote=activeQuote(props.state);return <><Heading title="Engineering review plan." description={quote?`${quote.product.id} · ${quote.id} v${quote.version}. See the information needed, who reviews it and what happens next.`:"Open a saved quote to review its next actions."}/><NextStepPanel {...props}/><ActionGroup><Button variant="secondary" onClick={()=>props.api.navigate('quote')}>Return to current work</Button><Button variant="text" onClick={()=>props.api.navigate('history')}>View saved records</Button></ActionGroup></>;}
