// Horizontal swipe on touch screens: onSwipe('left' | 'right').
// Counts only quick, mostly sideways swipes, so scrolling the grid and long
// presses don't trigger it. Swipes that start in a field or slider, or right at
// the screen edge (the iOS back gesture), are ignored.
const MIN_DX = 60;
const MAX_MS = 700;

export function swipeHandlers(onSwipe) {
  let start = null;
  return {
    touchstart(e) {
      const t = e.touches[0];
      const edge = 20;
      if (e.touches.length !== 1 || e.target.closest?.('input, select, textarea, [data-no-swipe]')
        || t.clientX < edge || t.clientX > window.innerWidth - edge) { start = null; return; }
      start = { x: t.clientX, y: t.clientY, at: Date.now() };
    },
    touchend(e) {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const quick = Date.now() - start.at <= MAX_MS;
      start = null;
      if (quick && Math.abs(dx) >= MIN_DX && Math.abs(dx) > 2 * Math.abs(dy)) onSwipe(dx < 0 ? 'left' : 'right');
    },
    touchcancel() { start = null; },
  };
}
