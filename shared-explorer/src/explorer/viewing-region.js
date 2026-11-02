/** Camera fit region inside a full-viewport canvas, excluding floating controls. */
export function viewingRegion(width, height, insets = {}) {
  const left = Math.max(0,insets.left || 0), right = Math.max(0,insets.right || 0);
  const top = Math.max(0,insets.top || 0), bottom = Math.max(0,insets.bottom || 0);
  return {
    width: Math.max(width * .2,width-left-right),
    height: Math.max(height * .2,height-top-bottom),
    offsetX: (right-left)/2,
    offsetY: (bottom-top)/2
  };
}
