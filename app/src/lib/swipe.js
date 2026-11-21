// Horizontal swipe on touch screens.
//   move(dx)       while a sideways drag is under way (the finger's offset in px)
//   end(dir, dx)   on release: dir is 'left' / 'right' for a real swipe, or null
// The first 10px decide the axis: a mostly vertical drag is a scroll and is left
// alone. Drags that start in a field, or right at the screen edge (the iOS back
// gesture), are ignored. The element needs `touch-action: pan-y` so the browser
// doesn't also pan sideways.
const LOCK_PX = 10;
const MIN_DX = 60;    // a release this far out counts as a swipe...
const FLICK_DX = 25;  // ...or a shorter quick flick
const FLICK_MS = 250;

export function swipeHandlers({ move = () => {}, end = () => {} }) {
  let start = null;
  let axis = null; // null until decided, then 'x' or 'y'
  const reset = () => { start = null; axis = null; };
  return {
    touchstart(e) {
      reset();
      const t = e.touches[0];
      const edge = 20;
      if (e.touches.length !== 1 || e.target.closest?.('input, select, textarea, [data-no-swipe]')
        || t.clientX < edge || t.clientX > window.innerWidth - edge) return;
      start = { x: t.clientX, y: t.clientY, at: Date.now() };
    },
    touchmove(e) {
      if (!start) return;
      if (e.touches.length !== 1) { if (axis === 'x') end(null, 0); reset(); return; }
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!axis) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_PX) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (axis === 'x') move(dx);
    },
    touchend(e) {
      if (!start) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      const ms = Date.now() - start.at;
      // No touchmove seen (or too few): decide the axis from the release.
      const sideways = axis === 'x' || (!axis && Math.abs(dx) > 2 * Math.abs(dy));
      reset();
      if (!sideways) return;
      const far = Math.abs(dx) >= MIN_DX || (Math.abs(dx) >= FLICK_DX && ms <= FLICK_MS);
      end(far ? (dx < 0 ? 'left' : 'right') : null, dx);
    },
    touchcancel() { if (axis === 'x') end(null, 0); reset(); },
  };
}
