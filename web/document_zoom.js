// Capture browser zoom before editor keymaps/native page zoom handle it.
// The existing slider remains the single bridge to the Dioxus zoom signal.
export function installDocumentZoom(target = window) {
  let frame = 0;
  let pending = null;
  let wheelDelta = 0;
  let lastWheel = 0;
  let gestureStart = null;
  const slider = () => target.document.querySelector('.word-shell .zoom-slider');
  const current = input => pending ?? Number(input.value);
  const setZoom = (input, value) => {
    pending = Math.max(50, Math.min(200, value));
    if (frame) return;
    frame = target.requestAnimationFrame(() => {
      frame = 0;
      const value = pending;
      pending = null;
      if (!input.isConnected || Number(input.value) === value) return;
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
    setZoom(input, key === '0' ? 100 : current(input) + (key === '-' || key === '_' ? -10 : 10));
  };
  const wheel = event => {
    const input = slider();
    if (!input || !event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
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
    if (event.type === 'gesturestart') gestureStart = current(input);
    else if (event.type === 'gestureend') gestureStart = null;
    else if (gestureStart !== null && Number.isFinite(event.scale)) {
      setZoom(input, Math.round(gestureStart * event.scale / 10) * 10);
    }
  };
  target.addEventListener('keydown', keydown, true);
  target.addEventListener('wheel', wheel, { capture: true, passive: false });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(type, gesture, { capture: true, passive: false });
  }
  return () => {
    target.cancelAnimationFrame(frame);
    target.removeEventListener('keydown', keydown, true);
    target.removeEventListener('wheel', wheel, true);
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) target.removeEventListener(type, gesture, true);
  };
}
