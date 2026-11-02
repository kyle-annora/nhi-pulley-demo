import React,{useEffect,useState} from 'react';
import {Button,ActionLink,EvidenceLabel} from './primitives';
import {useUtilityDialogs} from '../features/utility-dialogs';
import {navigationState} from '../workflow-adapter.mjs';

const caseRoutes=['quote','quote-document','revision','response','next','seller','history'];
function NavLink({href,current,api,children}){return href?<a href={href} aria-current={current?'page':undefined} onClick={event=>{event.preventDefault();api.navigate(href);}}>{children}</a>:<span aria-disabled="true">{children}</span>;}
function CaseNavigation({state,api,context}){
  const hrefs=context.hrefs||{},section=state.step==='history'?'history':state.step==='quote-document'?'quote':'work';
  const entries=[{key:'work',label:'Current work',href:hrefs.work},{key:'quote',label:'Quote',href:hrefs.quote},{key:'history',label:'Records',href:hrefs.history}];
  return <div className="n-case-navigation n-shell-width" aria-label="Case context">
    <div className="n-case-identity"><strong>{context.productId||state.selected}<span aria-hidden="true"> / </span>{context.rfq.id}</strong><span>{state.step==='seller'?'Seller simulation':context.quote&&context.latestQuote?.version>context.quote.version?`Reading quote v${context.quote.version} · current v${context.latestQuote.version}`:'Saved inquiry · Local example'}</span></div>
    <nav className="n-case-tabs" aria-label="Case sections">{entries.map(entry=><NavLink key={entry.key} {...entry} api={api} current={section===entry.key}>{entry.label}</NavLink>)}</nav>
    <select className="n-case-section-select" aria-label="Case section" value={section} onChange={event=>{const match=entries.find(entry=>entry.key===event.target.value);if(match?.href)api.navigate(match.href);}}>
      {entries.map(entry=><option key={entry.key} value={entry.key} disabled={!entry.href}>{entry.label}</option>)}
    </select>
  </div>;
}
export function WorkspaceShell({state,api,persistent,logo,children,sampleSession,routeParams={},walkthrough}){
  const utility=useUtilityDialogs(api);
  const [status,setStatus]=useState(()=>({steps:navigationState(state),persistent}));
  useEffect(()=>{const update=e=>setStatus(e.detail);window.addEventListener('nhi-workspace-status',update);return()=>window.removeEventListener('nhi-workspace-status',update);},[]);
  const context=api.navigationContext||{hrefs:{product:'#explore',inquiry:'#configure',history:'#history'},isDraft:true},hrefs=context.hrefs||{};
  const inCase=caseRoutes.includes(state.step)||(state.step==='record'&&context.source!=='draft');
  const inProduct=['select','explore'].includes(state.step),inInquiry=['configure','review','rfq'].includes(state.step)||(state.step==='record'&&context.source==='draft');
  const stages=[{label:'Product Room',href:hrefs.product||'#explore',current:inProduct},{label:'Inquiry',href:context.rfq&&!context.isDraft?hrefs.inquiry:'#configure',current:inInquiry},{label:'Case',href:context.rfq?(hrefs.work||hrefs.inquiry):null,current:inCase}];
  const closeTools=event=>{const disclosure=event.currentTarget.closest('details');if(disclosure)disclosure.open=false;};
  return <div className="nhi-ui n-workspace-shell n-room-shell" data-nhi-react data-visual-system={['quote','quote-document','explore'].includes(state.step)?'silver':undefined}>
    <header className="n-room-topbar"><div className="n-shell-width n-room-header-inner">
      <a className="n-workspace-brand" href="#select" aria-label="NHI pulley workspace home" onClick={e=>{e.preventDefault();api.navigate('select');}}><img src={logo} width="335" height="40" alt="NHI · Mechanical Motion Parts & Assemblies"/></a>
      <span className="n-room-brand-title">Pulley workspace</span>
      <span className="n-room-demo-label"><EvidenceLabel kind="example">{sampleSession?'Separate example':'Interactive demo'}</EvidenceLabel></span>
      <details className="n-room-tools"><summary>Menu <span aria-hidden="true">⌄</span></summary><div className="n-room-tools-panel">
        <ActionLink href={hrefs.history||'#history'} onClick={e=>{e.preventDefault();closeTools(e);api.navigate(hrefs.history||'#history');}}>Saved records</ActionLink>
        <ActionLink href="#configure" onClick={e=>{e.preventDefault();closeTools(e);api.navigate('configure');}}>Working inquiry</ActionLink>
        <Button variant="text" onClick={e=>{closeTools(e);utility.open('walkthrough',e.currentTarget);}}>Walkthrough</Button>
        <Button variant="text" onClick={api.exportCase}>Export case</Button>
        <ActionLink href="./patrick.html" target="_blank" rel="noreferrer">Patrick presentation</ActionLink>
        {sampleSession&&<Button variant="text" onClick={api.returnWorkspace}>Original records</Button>}
        <p className="n-help">{sampleSession?'Separate saved example. Original records are preserved.':'Local demonstration. Nothing is sent to NHI.'}</p>
      </div></details>
    </div></header>
    {walkthrough||<div className="n-room-journey n-shell-width"><nav aria-label="Workspace areas"><ol>{stages.map(stage=><li key={stage.label}><NavLink href={stage.href} current={stage.current} api={api}>{stage.label}</NavLink></li>)}</ol></nav><span className="n-help n-room-local-status" role="status">{status.persistent?'Saved in this browser':'Session only · Export to keep your work'}</span></div>}
    {context.rfq&&!context.error&&inCase&&<CaseNavigation state={state} api={api} context={context}/>}
    <main className="n-workspace-main n-shell-width" id="main" data-workspace={state.step}>{children}</main>
    <footer className="n-workspace-footer n-shell-width"><div><p>NHI · Pulley experience by Annora</p><p className={!status.persistent?'n-storage-warning':''}>{status.persistent?'Local demo · No request sent to NHI':'Session only · Export to keep your work'}</p></div><div className="n-footer-actions"><ActionLink href="#components" onClick={e=>{e.preventDefault();api.navigate('components');}}>Components</ActionLink><Button variant="text" onClick={e=>utility.open('reset',e.currentTarget)}>Reset demo</Button></div></footer>
    {utility.dialogs}
  </div>;
}
