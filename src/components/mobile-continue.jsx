import React from 'react';
import {ActionGroup} from './primitives';

// A second placement of the page's existing actions, never a separate workflow.
export function MobileContinue({title,detail,note,children}){
  return <section className="n-mobile-continue" aria-label="Next step"><div className="n-mobile-context"><strong>{title}</strong>{detail&&<span>{detail}</span>}</div>{note&&<p className="n-help">{note}</p>}<ActionGroup stack>{children}</ActionGroup></section>;
}
