import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installDocumentZoom } from './document_zoom.js';

test('document zoom captures shortcuts and gestures, batches input, and leaves normal scroll alone', () => {
  const { window } = new JSDOM('<div class="word-shell"><input class="zoom-slider" type="range" min="50" max="200" step="10" value="100"></div>');
  let callback;
  window.requestAnimationFrame = fn => { callback = fn; return 1; };
  window.cancelAnimationFrame = () => { callback = null; };
  const flush = () => { const fn = callback; callback = null; fn?.(); };
  const dispose = installDocumentZoom(window);
  const input = window.document.querySelector('input');
  let updates = 0;
  input.addEventListener('input', () => updates++);
  const key = value => {
    const event = new window.KeyboardEvent('keydown', { key: value, ctrlKey: true, cancelable: true, bubbles: true });
    input.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  };
  key('-'); key('-'); flush();
  assert.equal(input.value, '80');
  assert.equal(updates, 1);
  key('+'); flush(); assert.equal(input.value, '90');
  key('0'); flush(); assert.equal(input.value, '100');
  const wheel = new window.WheelEvent('wheel', { ctrlKey: true, deltaY: -80, cancelable: true });
  window.dispatchEvent(wheel); flush();
  assert.equal(wheel.defaultPrevented, true);
  assert.equal(input.value, '120');
  const scroll = new window.WheelEvent('wheel', { deltaY: 100, cancelable: true });
  window.dispatchEvent(scroll);
  assert.equal(scroll.defaultPrevented, false);
  for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 2], ['gestureend', 2]]) {
    const event = new window.Event(type, { cancelable: true });
    event.scale = scale;
    window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
  flush(); assert.equal(input.value, '200');
  key('+'); flush(); assert.equal(input.value, '200');
  dispose();
  const event = new window.KeyboardEvent('keydown', { key: '-', ctrlKey: true, cancelable: true });
  window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  window.close();
});

test('source mode ignores document zoom and cancels queued zoom without browser fallback', () => {
  const { window } = new JSDOM('<div class="word-shell"><main class="editor-surface"></main><input class="zoom-slider" value="150"></div>');
  let frame;
  window.requestAnimationFrame = fn => { frame = fn; return 1; };
  window.cancelAnimationFrame = () => {};
  const dispose = installDocumentZoom(window);
  const slider = window.document.querySelector('input');
  const surface = window.document.querySelector('main');
  const key = () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '+', ctrlKey: true, cancelable: true }));
  key();
  surface.classList.add('markdown-mode'); slider.disabled = true;
  frame(); frame = null;
  assert.equal(slider.value, '150');
  key();
  const wheel = new window.WheelEvent('wheel', { ctrlKey: true, deltaY: -80, cancelable: true });
  window.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, true);
  assert.equal(frame, null);
  assert.equal(slider.value, '150');
  surface.classList.remove('markdown-mode'); slider.disabled = false;
  key(); frame();
  assert.equal(slider.value, '160');
  dispose(); window.close();
});
