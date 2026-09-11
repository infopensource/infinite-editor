import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { defaultPageFurniture, pageGeometry, renderPageFurniture } from './page_furniture.js';

const dom = new JSDOM('<!doctype html>');
globalThis.document = dom.window.document;
let textWidth = 10;
dom.window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: () => ({ width: textWidth }) });

test('furniture retains unchanged regions and invalidates changed inputs', () => {
  const layer = document.createElement('div');
  const settings = defaultPageFurniture();
  settings.header.enabled = settings.footer.enabled = true;
  settings.header.left = [{ kind: 'page' }, { kind: 'text', value: '/' }, { kind: 'pages' }];
  const metrics = { width: 800, height: 1100, top: 80, bottom: 80, left: 80, right: 80 };
  const geometries = [0, 1, 2].map(i => pageGeometry(metrics, i));
  const render = (pages = geometries, total = 3) => renderPageFurniture(layer, settings, pages, metrics, total);
  assert.equal(render(), null);
  const original = [...layer.children];
  const observer = new dom.window.MutationObserver(() => {});
  observer.observe(layer, { childList: true, subtree: true, attributes: true });
  render();
  assert.equal(observer.takeRecords().length, 0);
  assert.deepEqual([...layer.children], original);
  render(geometries.slice(1));
  assert.deepEqual([...layer.children], original.slice(2));
  settings.header.style.color = '#123456';
  render(geometries.slice(1));
  assert.notEqual(layer.children[0], original[2]);
  assert.equal(layer.children[1], original[3]);
  render(geometries.slice(1), 4);
  assert.equal(layer.children[0].textContent, '2/4');
  const oldTop = layer.children[0].style.top;
  render([{ ...geometries[1], top: geometries[1].top + 20 }], 4);
  assert.notEqual(layer.children[0].style.top, oldTop);
  textWidth = 10000; // A newly loaded font must trigger validation again.
  assert.ok(render());
  assert.equal(layer.childElementCount, 0);
  textWidth = 10;
  assert.equal(render(), null);
  assert.equal(layer.childElementCount, 6);
  layer.replaceChildren(); // Seamless mode clears the layer externally.
  render();
  assert.equal(layer.childElementCount, 6);
  settings.header.enabled = settings.footer.enabled = false;
  render();
  assert.equal(layer.childElementCount, 0);
  observer.disconnect();
});
