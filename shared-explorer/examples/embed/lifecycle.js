/** A bfcache entry retains its iframe and connection. Closing that connection
 * would leave a restored host with live controls and a disconnected transport.
 */
export function bindHostLifecycle({window:win=globalThis.window,getClient}) {
  const onPageHide=event=>{if(!event.persisted)getClient()?.close();};
  win.addEventListener('pagehide',onPageHide);
  return ()=>win.removeEventListener('pagehide',onPageHide);
}

/** Stacked mobile controls can put a cross-origin WebGL frame offscreen.
 * Reveal the result before requesting visual work, so browsers can schedule
 * the child's animation frames normally. This never touches iframe contents.
 */
export async function revealMobileViewer({window:win=globalThis.window,viewer,onReveal}) {
  if(!viewer||!win.matchMedia('(max-width: 1100px)').matches)return false;
  const rect=viewer.getBoundingClientRect(),height=win.visualViewport?.height||win.innerHeight;
  const visible=Math.max(0,Math.min(rect.bottom,height)-Math.max(rect.top,0));
  if(visible>=Math.min(rect.height,height)*.8)return false;
  viewer.scrollIntoView({block:'start',behavior:'auto'});onReveal?.();
  await new Promise(resolve=>{
    let frame,timer;
    const finish=()=>{clearTimeout(timer);if(frame!==undefined)win.cancelAnimationFrame(frame);resolve();};
    timer=setTimeout(finish,120);
    frame=win.requestAnimationFrame(()=>{frame=win.requestAnimationFrame(finish);});
  });
  return true;
}
