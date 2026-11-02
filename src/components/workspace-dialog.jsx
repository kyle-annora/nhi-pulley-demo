import React from 'react';
import {Dialog} from '@base-ui/react/dialog';
import {AlertDialog} from '@base-ui/react/alert-dialog';
import {Button,EvidenceLabel} from './primitives';

export function WorkspaceDialog({alert=false,open,onOpenChange,title,description,initialFocus,finalFocus,children,footer}){
  const Parts=alert?AlertDialog:Dialog;
  return <Parts.Root open={open} onOpenChange={onOpenChange}>
    <Parts.Portal className="nhi-ui n-dialog-layer" data-nhi-react>
      <Parts.Backdrop className="n-dialog-backdrop"/>
      <Parts.Viewport className="n-dialog-viewport">
        <Parts.Popup className={`n-dialog-popup ${alert?'n-dialog-reset':'n-dialog-walkthrough'}`} initialFocus={initialFocus} finalFocus={finalFocus}>
          <div className="n-dialog-head"><div className="n-dialog-topline"><EvidenceLabel kind="example">Local demonstration</EvidenceLabel><Parts.Close render={<Button variant="text" icon="close" aria-label={alert?'Close reset confirmation':'Close walkthrough'}/>} className="n-dialog-close"/></div>
            <Parts.Title className="n-dialog-title">{title}</Parts.Title><Parts.Description className="n-dialog-description">{description}</Parts.Description>
          </div>
          <div className="n-dialog-body">{children}</div>
          <div className="n-dialog-footer">{footer}</div>
        </Parts.Popup>
      </Parts.Viewport>
    </Parts.Portal>
  </Parts.Root>;
}
