/** Browser history cache keeps the document and its listeners alive. Suspend its
 * clocks without destroying the retained renderer; normal navigation still disposes.
 */
export function createPageLifecycle({ controller, getScene, getTour, disposeBridge, isHidden = () => document.hidden, cancelFrame = cancelAnimationFrame }) {
  return {
    hide(event) {
      if (!event.persisted) { controller.dispose(); disposeBridge?.(); return; }
      const scene = getScene(), tour = getTour();
      tour?.player.setVisibility(true);
      if (tour?.active) tour.pause('visibility');
      if (scene) {
        scene.operationPlayer.setVisibility(true); scene.lastFrame = null;
        // Pausing the tour may invalidate the scene. Cancel after that pause.
        if (scene.raf !== null && scene.raf !== undefined) cancelFrame(scene.raf);
        scene.raf = null;
      }
      controller.setEnvironment({ visible: false });
    },
    show(event) {
      if (!event.persisted || controller.getState().lifecycle === 'disposed') return;
      const hidden = isHidden(), scene = getScene(), tour = getTour();
      tour?.player.setVisibility(hidden);
      if (scene) { scene.operationPlayer.setVisibility(hidden); scene.lastFrame = null; }
      controller.setEnvironment({ visible: !hidden });
      if (!hidden) scene?.invalidate();
      // A paused tour requires its existing explicit Continue action.
    },
  };
}
