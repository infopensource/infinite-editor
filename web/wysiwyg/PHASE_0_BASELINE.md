# WYSIWYG 阶段 0 行为基线

记录日期：2026-08-28。

## 工作区保护

执行阶段 0 前已有以下未提交修改，本阶段不修改、不还原这些文件：

- `assets/document_renderer.js`（+2256/-199）
- `assets/styling/word.css`（+8/-0）
- `src/components/word/document_renderer.rs`（+62/-47）
- `web/document_renderer.test.js`（+4442/-1061）

新 ProseMirror 内核只放在 `web/wysiwyg/`，不接分页、不接 Rust 逐键 ACK，也不调用旧 DOM serializer。

## 可复现测试基线

在上述未提交修改上执行 `npm test`：

- Node 20.20.2；npm 12.0.2 给出版本兼容警告，但测试可运行。
- `web/document_renderer.test.js`：通过。
- `web/editor.test.js`：通过。
- Rust：35 通过、0 失败、1 忽略。
- 忽略项：PDF 测试需要本机 Chromium-compatible browser。

## 测试分类

业务行为（迁移后应保留为文档树、选区、历史和 Markdown 结果断言）：

- 列表/引用的 Enter、Backspace、Tab、Shift+Tab 与层级变化。
- undo/redo、IME、剪贴板、快捷键和最后有效选区。
- Markdown 的列表、引用、表格、公式、分页符、图片、链接及标记往返。
- 资源路径、保存/重开、模式切换、原子节点删除和安全过滤。

旧实现内部机制（新内核不应继承；只在旧路径存续期间保留）：

- 物理分页片段 clone/coalesce、continuation 标记和分页 DOM 路径。
- `data-markdown-from/to` 的局部 DOM 反序列化。
- projection snapshot、revision/render ACK、失败后的分页 DOM 回滚。
- 跨物理页面恢复浏览器 Range、页面 host 修复和旧 serializer 的转义细节。

## 最小回归文档集

[`fixtures/regression.md`](fixtures/regression.md) 固定列表、引用、表格、公式、显式分页符、图片和未知 HTML。阶段 1 只支持其中的基础 CommonMark 子集；表格、公式、分页符、图片和未知源码必须留到阶段 2 以业务节点或 opaque/source node 实现，当前不得静默吞掉后宣称支持。

## WebKitGTK 基线限制

jsdom 不能证明真实 IME、Selection、clipboard 或 WebKit 编辑事件顺序。阶段 1 自动化测试只能验证 ProseMirror 的组合期保护和事务结果；完成标准仍要求在真实 WebKitGTK 中手工执行嵌套列表与中文输入冒烟测试。若无法进行人工输入，该项必须明确报告为未执行，不能用 jsdom 结果替代。

手工入口：运行 `npm run build:wysiwyg`，在仓库根目录启动静态服务器，然后用 WebKitGTK 打开 `/web/wysiwyg/smoke.html`。依次验证中文输入、嵌套列表的 Enter/Backspace/Tab/Shift+Tab、快捷键 undo/redo 和右侧 Markdown 输出；这个页面没有分页或 Rust 桥接。
