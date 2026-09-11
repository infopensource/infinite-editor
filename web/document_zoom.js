// Capture browser zoom before editor keymaps/native page zoom handle it.
// The existing slider remains the single bridge to the Dioxus zoom signal.
export function reconcileDocumentScroll(target = window) {
  const viewport = target.document.querySelector('.editor-surface:not(.markdown-mode)');
  if (!viewport) return;
  const page = viewport.querySelector('.infinite-pm-page');
  if (!page) return;
  const style = target.getComputedStyle(viewport);
  const surface = page.closest('.infinite-pm-surface');
  const surfaceStyle = surface ? target.getComputedStyle(surface) : null;
  // Use the new layout geometry, not a potentially stale overflow extent from
  // the previously transformed viewport (notably in desktop WebKit).
  const maximum = Math.max(0, page.offsetWidth
    + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    + (parseFloat(surfaceStyle?.paddingLeft) || 0)
    + (parseFloat(surfaceStyle?.paddingRight) || 0) - viewport.clientWidth);
  viewport.scrollLeft = Math.min(Math.max(0, viewport.scrollLeft), maximum);
}

export function installDocumentZoom(target = window) {
  let frame = 0;
  let pending = null;
  let wheelDelta = 0;
  let lastWheel = 0;
  let gestureStart = null;
  const slider = () => target.document.querySelector('.word-shell .zoom-slider');
  const enabled = input => input && !input.disabled
    && !target.document.querySelector('.editor-surface.markdown-mode');
  const current = input => pending ?? Number(input.value);
  const setZoom = (input, value) => {
    pending = Math.max(50, Math.min(200, value));
    if (frame) return;
    frame = target.requestAnimationFrame(() => {
      frame = 0;
      const value = pending;
      pending = null;
      if (!enabled(input) || !input.isConnected || Number(input.value) === value) return;
      input.value = String(value);
      input.dispatchEvent(new target.Event('input', { bubbles: true }));
    });
  };
  const keydown = event => {
    const input = slider();
    if (!input || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key;
    if (!['+', '=', '-', '_', '0'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!enabled(input)) return;
    setZoom(input, key === '0' ? 100 : current(input) + (key === '-' || key === '_' ? -10 : 10));
  };
  const wheel = event => {
    const input = slider();
    if (!input || !event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (!enabled(input)) { wheelDelta = 0; return; }
    // A WebKit gesture can also emit wheel events; do not apply it twice.
    if (gestureStart !== null) return;
    if (event.timeStamp - lastWheel > 200) wheelDelta = 0;
    lastWheel = event.timeStamp;
    wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.innerHeight : 1);
    const steps = Math.trunc(wheelDelta / 40);
    if (!steps) return;
    wheelDelta -= steps * 40;
    setZoom(input, current(input) - steps * 10);
  };
  const gesture = event => {
    const input = slider();
    if (!input) return;
    event.preventDefault();
    event.stopPropagation();
    if (!enabled(input)) { gestureStart = null; return; }
    if (event.type === 'gesturestart') gestureStart = current(input);
    else if (event.type === 'gestureend') gestureStart = null;
    else if (gestureStart !== null && Number.isFinite(event.scale)) {
      setZoom(input, Math.round(gestureStart * event.scale / 10) * 10);
    }
  };
  target.addEventListener('keydown', keydown, true);
  const reconcile = () => reconcileDocumentScroll(target);
  target.addEventListener('infinite-editor-zoom', reconcile);
  target.addEventListener('wheel', wheel, { capture: true, passive: false });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(type, gesture, { capture: true, passive: false });
  }
  return () => {
    target.cancelAnimationFrame(frame);
    target.removeEventListener('keydown', keydown, true);
    target.removeEventListener('infinite-editor-zoom', reconcile);
    target.removeEventListener('wheel', wheel, true);
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) target.removeEventListener(type, gesture, true);
  };
}
