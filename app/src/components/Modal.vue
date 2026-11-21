<script setup>
// The overlay and panel every dialog uses. Behaves as a modal dialog: named by
// its <h2>, Escape and a click outside close it, Tab stays inside, and focus
// returns to where it was when the dialog closes. On phones, pulling it down
// closes it too.
import { nextTick, ref, watch } from 'vue';

const open = defineModel('open', { type: Boolean, default: false });
// drawer: slides in from the right, full height, instead of a centred panel.
defineProps({ drawer: { type: Boolean, default: false } });
const panel = ref(null);
const titleId = `dlg-${Math.random().toString(36).slice(2, 9)}`;
let returnTo = null;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const focusables = () => [...panel.value.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);

watch(open, (isOpen) => {
  if (isOpen) {
    returnTo = document.activeElement;
    // A dialog that focuses its own field (the describe box) keeps that focus.
    nextTick(() => {
      if (!panel.value) return;
      const h = panel.value.querySelector('h2');
      if (h) h.id = titleId;
      if (!panel.value.contains(document.activeElement)) panel.value.focus({ preventScroll: true });
    });
  } else if (returnTo && document.contains(returnTo)) {
    returnTo.focus();
    returnTo = null;
  }
});

// Phones (full-screen sheets): pulling the sheet down from the top closes it,
// like Cancel. The sheet follows the finger and springs back if let go early.
// Only starts when the sheet is scrolled to the top, and not from a field.
const PULL_CLOSE_PX = 120;
const FLICK_PX = 40;
const FLICK_MS = 250;
const overlay = ref(null);
const pull = ref(0);
const pulling = ref(false);
let touch = null; // { x, y, at, axis }
const isPhone = () => !!window.matchMedia?.('(max-width: 640px)').matches;

function onTouchstart(e) {
  touch = null;
  if (e.touches.length !== 1 || !isPhone() || overlay.value.scrollTop > 0
    || e.target.closest?.('input, select, textarea, [data-no-swipe]')) return;
  const t = e.touches[0];
  touch = { x: t.clientX, y: t.clientY, at: Date.now(), axis: null };
}
function onTouchmove(e) {
  if (!touch) return;
  if (e.touches.length !== 1) { endPull(); return; }
  const dx = e.touches[0].clientX - touch.x;
  const dy = e.touches[0].clientY - touch.y;
  if (!touch.axis) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
    touch.axis = dy > 0 && dy > Math.abs(dx) ? 'down' : 'other';
  }
  if (touch.axis !== 'down') { touch = null; return; }
  e.preventDefault(); // the sheet moves, the page doesn't bounce
  pulling.value = true;
  pull.value = Math.max(0, dy);
}
function onTouchend(e) {
  if (!touch) return;
  const dy = e.changedTouches[0].clientY - touch.y;
  const dx = e.changedTouches[0].clientX - touch.x;
  const quick = Date.now() - touch.at <= FLICK_MS;
  const down = touch.axis === 'down' || (!touch.axis && dy > 2 * Math.abs(dx));
  endPull();
  if (down && (dy >= PULL_CLOSE_PX || (quick && dy >= FLICK_PX))) open.value = false;
}
function endPull() { touch = null; pulling.value = false; pull.value = 0; }
watch(open, (isOpen) => { if (!isOpen) endPull(); });

function onKeydown(e) {
  if (e.key === 'Escape') { e.stopPropagation(); open.value = false; return; }
  if (e.key !== 'Tab') return;
  const list = focusables();
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
</script>

<template>
  <div ref="overlay" class="overlay" :class="{ open, drawer }" @click.self="open = false" @keydown="onKeydown"
    @touchstart.passive="onTouchstart" @touchmove="onTouchmove" @touchend.passive="onTouchend" @touchcancel.passive="endPull">
    <div ref="panel" class="form-panel" :class="{ pulling }" :style="pull ? { transform: `translateY(${pull}px)` } : null" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
      <slot />
    </div>
  </div>
</template>
