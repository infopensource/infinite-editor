import './index.js';

const html = `<ul>
<li>
<p>无序列表第一项</p>
</li>
<li>
<p>第二项包含嵌套内容</p>
<ul>
<li>子项目 A</li>
<li>子项目 B</li>
</ul>
</li>
<li>
<p>第三项包含多个段落</p>
<p>这是同一列表项中的第二个段落。</p>
</li>
</ul>
<ol>
<li>有序列表第一项</li>
<li>第二项
<ol>
<li>嵌套编号 2.1</li>
<li>嵌套编号 2.2</li>
</ol>
</li>
</ol>
<p>连续  空格\n软换行</p>`;

try {
  document.body.innerHTML = `<div class="markdown-preview-pane" style="height:auto"><div id="preview" class="markdown-rendered-html"></div></div>
<section id="renderer" class="document-renderer" style="--page-width:210mm;--page-height:297mm;--page-padding-top:15mm;--page-padding-bottom:15mm;--page-padding-left:22mm;--page-padding-right:22mm">
<div class="document-pagination-source markdown-rendered-html">${html}</div><div data-document-pages></div></section><pre id="result"></pre>`;
  const preview = document.getElementById('preview');
  preview.innerHTML = html;
  const offset = root => {
    const li = root.querySelector('li');
    return li.querySelector('p').getBoundingClientRect().top - li.getBoundingClientRect().top;
  };
  const before = offset(preview);
  window.InfiniteDocumentRenderer.updatePreview(preview, html);
  const root = document.getElementById('renderer');
  window.InfiniteDocumentRenderer.paginate(root, false);
  const page = root.querySelector('.document-page-content');
  const after = [preview, page].map(offset);
  const listHeights = [preview, page].map(node => node.querySelector('ul').getBoundingClientRect().height);
  const softBreaks = [preview, page].map(node => {
    const paragraph = node.lastElementChild;
    const lineHeight = parseFloat(getComputedStyle(paragraph).lineHeight);
    return paragraph.textContent === '连续  空格\n软换行'
      && Math.abs(paragraph.getBoundingClientRect().height - lineHeight * 2) < 1;
  });
  const ok = before > 10 && after.every(value => Math.abs(value) < 1)
    && listHeights.every(height => height < 300) && softBreaks.every(Boolean)
    && root.querySelectorAll('.document-page').length === 1;
  document.getElementById('result').textContent = JSON.stringify({ ok, before, after, listHeights, softBreaks });
} catch (error) {
  document.getElementById('result').textContent = JSON.stringify({ ok: false, error: String(error) });
}
