import './index.js';
import { MinimalWysiwygEditor } from '../wysiwyg/editor.js';

const markdown = `| 功能 | 语法示例 | 对齐 | 状态 |
| :--- | :---: | ---: | :---: |
| 粗体 | \`**text**\` | 左/中/右 | ✅ |
| 行内公式 | \`$E=mc^2$\` | 右对齐 | ✅ |
| 化学式 | \`\\ce{H2O}\` | 居中 | ✅ |
| 转义竖线 | \`a \\| b\` | 右对齐 | ✅ |`;
const values = [
  ['功能', '语法示例', '对齐', '状态'],
  ['粗体', '**text**', '左/中/右', '✅'],
  ['行内公式', '$E=mc^2$', '右对齐', '✅'],
  ['化学式', '\\ce{H2O}', '居中', '✅'],
  ['转义竖线', 'a | b', '右对齐', '✅'],
];
const align = ['left', 'center', 'right', 'center'];
const row = (values, tag) => `<tr>${values.map((value, i) => `<${tag} align="${align[i]}">${tag === 'td' && i === 1 ? `<code>${value}</code>` : value}</${tag}>`).join('')}</tr>`;
const html = `<table>\n<thead>\n${row(values[0], 'th')}\n</thead>\n<tbody>\n${values.slice(1).map(values => row(values, 'td')).join('\n')}\n</tbody>\n</table>`;

try {
  document.body.innerHTML = `<style>
    body { padding: 16px; background: white; font: 16px/1.8 sans-serif; }
    #preview, #rich, #renderer { width: 640px; }
    .infinite-pm-host { min-height: 0; }
    #renderer { --page-width:640px; --page-height:400px; --page-padding-top:0px; --page-padding-bottom:0px; --page-padding-left:0px; --page-padding-right:0px; --document-font-size:16px; }
  </style><h3>Markdown 预览</h3><div id="preview" class="markdown-rendered-html"></div>
  <h3>所见即所得</h3><div id="rich" class="infinite-pm-host"></div>
  <h3>PDF 分页内容</h3><section id="renderer" class="document-renderer"><div class="document-pagination-source markdown-rendered-html">${html}</div><div data-document-pages></div></section><pre id="result"></pre>`;
  window.InfiniteDocumentRenderer.updatePreview(document.getElementById('preview'), html);
  const editor = new MinimalWysiwygEditor(document.getElementById('rich'), markdown);
  window.InfiniteDocumentRenderer.paginate(document.getElementById('renderer'), false);
  const tables = [document.querySelector('#preview table'), document.querySelector('#rich table'), document.querySelector('.document-page-content table')];
  const checks = [];
  for (const width of [640, 320]) {
    document.getElementById('preview').style.width = `${width}px`;
    document.getElementById('rich').style.width = `${width}px`;
    document.getElementById('renderer').style.setProperty('--page-width', `${width}px`);
    for (const table of tables) {
      const style = getComputedStyle(table);
      const cells = [...table.rows[1].cells];
      checks.push(style.display === 'table' && style.tableLayout === 'fixed' && style.borderCollapse === 'collapse');
      checks.push(cells.every((cell, i) => getComputedStyle(cell).textAlign.replace('-webkit-', '') === align[i]
        && getComputedStyle(cell).borderTopWidth === '1px' && getComputedStyle(cell).paddingLeft === '9px'));
      checks.push(table.rows.length === 5 && cells.length === 4);
      checks.push(cells[1].textContent === '**text**' && table.rows[4].cells[1].textContent === 'a | b');
      checks.push(Math.max(...cells.map(cell => cell.getBoundingClientRect().width)) - Math.min(...cells.map(cell => cell.getBoundingClientRect().width)) < 1);
      checks.push(table.getBoundingClientRect().width <= width + 1);
    }
  }
  document.getElementById('preview').style.width = '640px';
  document.getElementById('rich').style.width = '640px';
  document.getElementById('renderer').style.setProperty('--page-width', '640px');
  document.getElementById('result').textContent = JSON.stringify({ ok: checks.every(Boolean), checks: checks.length, failed: checks.map((ok, i) => ok ? null : i).filter(i => i !== null) });
} catch (error) {
  document.getElementById('result').textContent = JSON.stringify({ ok: false, error: String(error) });
}
