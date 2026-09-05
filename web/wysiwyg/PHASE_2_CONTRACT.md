# WYSIWYG 阶段 2 业务节点合同

阶段 2 仍是独立 ProseMirror 内核，不接分页、Dioxus bridge、资源解析或原生图片剪贴板。

## 解析边界

编辑器业务层只依赖 `backend.parse(markdown) -> Markdown AST`。独立 smoke 和 golden tests 使用 `remarkReferenceBackend`；生产集成必须由 Rust `markdown-rs` 适配器输出相同 AST 契约，不能让 Remark 成为应用解析后端。

## 节点行为

| Markdown | Schema | 初始化/导出 | 命令 | Clipboard |
| --- | --- | --- | --- | --- |
| GFM task item | `list_item.checked` | 规范化为 `* [x]` / `* [ ]` | 勾选事务；Enter 新项默认未勾选 | 复制为 Markdown 文本 |
| GFM table | `table/row/header/cell` | 保留列对齐，二次往返稳定 | 可插入最小表格；单元格编辑命令留待扩展 | DOM 表格 + Markdown 纯文本 |
| 删除线 | `strike` mark | `~~text~~` | toggle mark | 保留 mark/Markdown |
| 图片 | `image` atom | 保留 Markdown src/alt/title | 原子插入、单次选中删除 | 复制为 `![alt](src)`；原生图片粘贴属阶段 4 |
| 行内/块公式 | `math_inline/math_block` atom | `$...$` / `$$...$$` | 原子插入 | 复制为公式 Markdown；渲染 NodeView 属阶段 4 |
| 分隔线 | `horizontal_rule` atom | 稳定规范化为 `---` | 原子插入 | 复制为 Markdown |
| 显式分页符 | `page_break` atom | 保留显式注释源码 | 原子插入 | 复制显式注释；不产生自动分页 |
| 未知 HTML/指令 | `opaque_block/opaque_inline` atom | 保存原始 source，禁止内部富文本编辑 | 无修改命令 | 复制原始 source |
| 引用式链接 | `link` mark + 隐藏的 `link_definition` atom | 正文转为普通链接，定义不参与 WYSIWYG 排版但保留源码；二次往返稳定 | 普通链接 mark | 复制为规范化链接 Markdown |

纯文本粘贴继续走 ProseMirror 原生文本流程，不会把用户粘贴的任意文本自动解释成 Markdown。结构化 Markdown 导入通过显式 `setMarkdown`/AST 初始化完成，以避免粘贴普通文本时意外创建业务节点。

## WebKitGTK 验证状态

- WebKitGTK 2.52.6 的系统 MiniBrowser 已在 Wayland 中请求 `smoke.html` 和阶段 2 bundle，证明真实引擎可加载独立入口。
- WebKitWebDriver 状态端点正常，但 MiniBrowser automation handshake 创建会话超时，未能执行自动 DOM/键盘断言。
- 中文 IME、拖选和真实键盘列表操作仍必须在 smoke 页面人工完成；不得用 jsdom composition 测试代替这一结论。
