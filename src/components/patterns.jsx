import React from 'react';
import {ChoiceGroup,EvidenceLabel} from './primitives';

export function VersionSelector({quote,versions,onChange}) {
  return <div className="n-version-bar"><span className="n-mono">{quote.id}</span><ChoiceGroup variant="segmented" label="Quote version" value={quote.version} onChange={v=>onChange(Number(v))} choices={versions.map(q=>({value:q.version,label:`v${q.version}`}))}/><span className="n-help">Viewing v{quote.version} · Each version is preserved.</span></div>;
}
export function Comparison({rows,beforeLabel='Original',afterLabel='Requested',caption='Changes',showState=true}) {
  return <div className="n-table-scroll" tabIndex="0" role="region" aria-label={caption}><table className="n-table n-comparison"><caption className="n-sr-only">{caption}</caption><thead><tr><th scope="col">Item</th><th scope="col">{beforeLabel}</th><th scope="col">{afterLabel}</th>{showState&&<th scope="col">Change</th>}</tr></thead><tbody>{rows.map(([label,before,after])=><tr key={label} data-changed={before!==after||undefined}><th scope="row">{label}</th><td>{before}</td><td>{after}</td>{showState&&<td><span className="n-change-label">{before!==after?'Changed':'Unchanged'}</span></td>}</tr>)}</tbody></table></div>;
}
export function EvidenceSet(){return <div className="n-evidence-set"><EvidenceLabel>Catalog data</EvidenceLabel><EvidenceLabel kind="customer">Customer input</EvidenceLabel><EvidenceLabel kind="example">Example commercial data</EvidenceLabel><EvidenceLabel kind="review">Review required</EvidenceLabel></div>;}
