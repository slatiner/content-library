// Progressive rendering for long grids: only the first PAGE items are rendered,
// and another PAGE is added each time a sentinel element after the grid comes
// within ~2 screens of the viewport. Resets to the first page when `resetOn`
// changes (a new list, filter or search). Without IntersectionObserver
// everything renders at once.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

export const PAGE = 24;

export function useProgressive(items, resetOn) {
  const supported = typeof IntersectionObserver !== 'undefined';
  const count = ref(PAGE);
  const sentinel = ref(null);
  const shown = computed(() => (supported ? items.value.slice(0, count.value) : items.value));
  const more = computed(() => shown.value.length < items.value.length);
  watch(resetOn, () => { count.value = PAGE; }, { deep: true });

  let io = null;
  watch(sentinel, (el) => {
    io?.disconnect();
    io = null;
    if (!el || !supported) return;
    io = new IntersectionObserver((seen) => {
      if (!seen.some((s) => s.isIntersecting)) return;
      count.value += PAGE;
      // Still in range after the new page (a tall screen): observing again fires
      // a fresh callback, so the next page follows without a scroll.
      nextTick(() => { if (io && sentinel.value === el) { io.unobserve(el); io.observe(el); } });
    }, { rootMargin: '1200px 0px' });
    io.observe(el);
  });
  onBeforeUnmount(() => io?.disconnect());

  return { shown, more, sentinel };
}
