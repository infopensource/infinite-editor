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

test('region formatting renders text and page fields independently and measures styled fonts', () => {
  const layer = document.createElement('div');
  const settings = defaultPageFurniture();
  settings.header.enabled = settings.footer.enabled = true;
  settings.header.left = [{ kind: 'text', value: '标题 ' }, { kind: 'page' }];
  settings.footer.center = [{ kind: 'pages' }];
  Object.assign(settings.header.style, { bold: true, italic: true, underline: true, strikethrough: true });
  const metrics = { width: 800, height: 1100, top: 80, bottom: 80, left: 80, right: 80 };
  const original = dom.window.HTMLCanvasElement.prototype.getContext;
  const fonts = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    set font(value) { fonts.push(value); },
    measureText: () => ({ width: 10 }),
  });
  try {
    assert.equal(renderPageFurniture(layer, settings, [pageGeometry(metrics, 0)], metrics, 3), null);
    const [header, footer] = layer.children;
    assert.equal(header.firstChild.firstChild.style.fontWeight, 'bold');
    assert.equal(header.firstChild.firstChild.style.fontStyle, 'italic');
    assert.equal(header.firstChild.firstChild.style.textDecoration, 'underline line-through');
    assert.equal(header.textContent, '标题 1');
    assert.equal(footer.style.fontWeight, 'normal');
    assert.equal(footer.style.fontStyle, 'normal');
    assert.equal(footer.children[1].firstChild.style.textDecoration, 'none');
    assert.deepEqual(fonts, ['italic bold 12px system-ui', 'normal normal 12px system-ui']);
    for (const key of ['bold', 'italic', 'underline', 'strikethrough']) delete settings.header.style[key];
    assert.equal(renderPageFurniture(layer, settings, [pageGeometry(metrics, 0)], metrics, 3), null);
    assert.equal(layer.firstChild.style.fontWeight, 'normal');
    assert.equal(layer.firstChild.firstChild.firstChild.style.textDecoration, 'none');
  } finally {
    dom.window.HTMLCanvasElement.prototype.getContext = original;
  }
});

test('mixed marks stay local and width validation includes each styled run', () => {
  const settings = defaultPageFurniture();
  settings.header.enabled = true;
  settings.header.left = [
    { kind: 'text', value: '普通' },
    { kind: 'text', value: '粗体', marks: ['bold'] },
    { kind: 'page', marks: ['italic', 'underline'] },
    { kind: 'pages', marks: ['strikethrough'] },
  ];
  const layer = document.createElement('div');
  const metrics = { width: 800, height: 1100, top: 80, bottom: 80, left: 80, right: 80 };
  assert.equal(renderPageFurniture(layer, settings, [pageGeometry(metrics, 0)], metrics, 12), null);
  const spans = layer.firstChild.firstChild.children;
  assert.deepEqual([...spans].map(span => span.textContent), ['普通', '粗体', '1', '12']);
  assert.deepEqual([...spans].map(span => span.style.fontWeight), ['normal', 'bold', 'normal', 'normal']);
  assert.equal(spans[2].style.fontStyle, 'italic');
  assert.equal(spans[2].style.textDecoration, 'underline');
  assert.equal(spans[3].style.textDecoration, 'line-through');
  const original = dom.window.HTMLCanvasElement.prototype.getContext;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    font: '',
    measureText(text) { return { width: text.length * (this.font.includes('bold') ? 200 : 1) }; },
  });
  try {
    assert.match(renderPageFurniture(layer, settings, [pageGeometry(metrics, 0)], metrics, 12), /左侧放不下/);
    settings.header.left[1].marks = [];
    assert.equal(renderPageFurniture(layer, settings, [pageGeometry(metrics, 0)], metrics, 12), null);
  } finally { dom.window.HTMLCanvasElement.prototype.getContext = original; }
});

test('horizontal offsets use paper edges, with unset values following document margins', () => {
  const layer = document.createElement('div');
  const settings = defaultPageFurniture();
  settings.header.enabled = settings.footer.enabled = true;
  const metrics = { width: 800, height: 1100, top: 80, bottom: 80, left: 91, right: 63 };
  const render = () => renderPageFurniture(layer, settings, [pageGeometry(metrics, 0)], metrics, 1);
  assert.equal(render(), null);
  assert.equal(parseFloat(layer.firstChild.style.left), 91);
  assert.ok(Math.abs(parseFloat(layer.firstChild.style.right) - 63) < 0.001);
  settings.header.style.margin_left_mm = settings.header.style.margin_right_mm = 0;
  assert.equal(render(), null);
  assert.equal(layer.firstChild.style.left, '0px');
  assert.equal(layer.firstChild.style.right, '0px');
  assert.equal(parseFloat(layer.lastChild.style.left), 91);
  metrics.left = 120;
  assert.equal(render(), null);
  assert.equal(layer.firstChild.style.left, '0px');
  assert.equal(parseFloat(layer.lastChild.style.left), 120);
});
