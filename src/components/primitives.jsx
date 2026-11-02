import React, {useId} from 'react';
import {Button as ShadcnButton} from './ui/button';
import {Input} from './ui/input';
import {Textarea} from './ui/textarea';
import {Toggle} from '@base-ui/react/toggle';
import {Radio} from '@base-ui/react/radio';
import {RadioGroup} from '@base-ui/react/radio-group';

export function Glyph({name='arrow',...props}) {
  const paths={arrow:'M4 12h16m-6-6 6 6-6 6',back:'M20 12H4m6-6-6 6 6 6',check:'m5 12 4 4L19 6',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',plus:'M12 5v14M5 12h14',info:'M12 11v6M12 7v1',close:'m6 6 12 12M6 18 18 6'};
  return <svg {...props} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name==='info'&&<circle cx="12" cy="12" r="9"/>}<path d={paths[name]||paths.arrow}/></svg>;
}
export function Button({variant='primary',size='regular',pending=false,pendingLabel='Working…',children,icon,disabled,className='',...props}) {
  return <ShadcnButton {...props} type={props.type||'button'} variant={variant==='primary'?'default':variant==='secondary'?'outline':variant==='danger'?'destructive':'ghost'}
    disabled={disabled||pending} focusableWhenDisabled={pending} aria-busy={pending||undefined}
    data-variant={variant} data-size={size} data-pending={pending||undefined} className={`n-control ${className}`}>
    <span className="n-control-body"><span className="n-control-label" aria-hidden={pending||undefined} style={{visibility:pending?'hidden':'visible'}}>{children}</span><span className="n-pending-label" aria-hidden={!pending} style={{visibility:pending?'visible':'hidden'}}><span className="n-spinner" aria-hidden="true"/>{pendingLabel}</span></span>{icon&&<Glyph name={icon} style={{visibility:pending?'hidden':'visible'}}/>}
  </ShadcnButton>;
}
export function ActionLink({children,href,variant='text',icon,...props}) {
  return <a {...props} href={href} className="n-control" data-variant={variant}><span className="n-control-label">{children}</span>{icon&&<Glyph name={icon}/>}</a>;
}
export function ActionGroup({children,stack=false}) {return <div className={`n-actions ${stack?'n-actions-stack':''}`}>{children}</div>;}
export function ToggleButton({children,pressed,onPressedChange,...props}) {
  return <Toggle {...props} pressed={pressed} onPressedChange={onPressedChange} className="n-control n-toggle" data-variant="secondary"><span className="n-control-label">{children}</span></Toggle>;
}
export function ChoiceGroup({label,value,onChange,choices,variant='choice',className=''}) {
  const segmented=variant==='segmented';
  return <RadioGroup className={`n-choices ${className}`} data-variant={segmented?'segmented':'choice'} aria-label={label} value={String(value)} onValueChange={onChange}>
    {choices.map(({value:v,label:l,disabled=false})=><Radio.Root key={v} value={String(v)} disabled={disabled} className="n-choice">{!segmented&&<span className="n-choice-slot" aria-hidden="true"><Radio.Indicator className="n-choice-indicator"/></span>}<span className="n-choice-label">{l}</span></Radio.Root>)}
  </RadioGroup>;
}
export function Field({label,hint,error,optional=false,textarea=false,options,unit,className='',id:givenId,...props}) {
  const unique=useId(),id=givenId||unique,description=[hint&&`${id}-hint`,error&&`${id}-error`,unit&&`${id}-unit`].filter(Boolean).join(' ');
  const shared={...props,id,'aria-invalid':error?true:undefined,'aria-describedby':description||undefined,className:'n-input'};
  return <div className={`n-field ${className}`}><label htmlFor={id}>{label}{optional&&<span>Optional</span>}</label>
    <div className="n-input-wrap">{options?<select {...shared}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>:textarea?<Textarea {...shared}/>:<Input {...shared}/>} {unit&&<span className="n-unit" id={`${id}-unit`}>{unit}</span>}</div>
    {hint&&<p id={`${id}-hint`} className="n-help">{hint}</p>}{error&&<p id={`${id}-error`} className="n-error"><Glyph name="info"/>{error}</p>}
  </div>;
}
export function EvidenceLabel({kind='source',children}) {return <span className={`n-evidence n-evidence-${kind}`}>{children}</span>;}
export function Notice({children,title,kind='neutral',role}) {return <div className={`n-notice n-notice-${kind}`} role={role}>{kind==='error'&&<Glyph name="info"/>}<div>{title&&<strong>{title}</strong>}{children}</div></div>;}
export function Heading({eyebrow,title,description,children}) {return <div className="n-heading"><div><p className="n-eyebrow">{eyebrow}</p><h1 id="page-title" tabIndex="-1">{title}</h1><p className="n-lede">{description}</p></div>{children&&<div className="n-heading-tools">{children}</div>}</div>;}
