# Infinite Markdown AST v1

`Infinite AST` 是本项目拥有、带版本号的 Markdown 中间表示。生产路径由 Rust
`markdown-rs` 生成；Remark 适配器只用于隔离原型和跨后端黄金测试。ProseMirror
转换器只接受该契约，不直接依赖任一解析器的私有 mdast 类型。

顶层格式为：

```json
{"version":1,"children":[]}
```

块节点包括 `paragraph`、`heading`、`blockquote`、`code_block`、`math_block`、
`thematic_break`、`list` / `list_item`、`table` / `table_row` / `table_cell`、
`definition`、`page_break` 和 `opaque_block`。行内节点包括 `text`、`emphasis`、
`strong`、`strike`、`code_inline`、`math_inline`、`hard_break`、链接、图片及
`opaque_inline`。

规则：

- `kind` 是稳定的 snake_case 判别字段；新增破坏性字段或改变语义必须提升版本。
- 可空字段在 JSON 中显式为 `null`，避免 Rust/JS 对“缺失”产生不同解释。
- 引用定义和 opaque 节点保存原始 `source`，不得静默丢失未知语法。
- 当前 v1 只承诺语义节点和必须保留的源码；源码位置与跨模式光标映射不属于 v1。
- [infinite_ast_v1.md](./fixtures/infinite_ast_v1.md) 与
  [infinite_ast_v1.json](./fixtures/infinite_ast_v1.json) 是 Rust/JS 共享的黄金契约。

生产接入门槛：Rust 黄金测试和 JS 黄金测试必须同时通过，WYSIWYG bridge 必须拒绝
未知版本，并在中文 IME composition 期间延迟外部文档替换和模式切换。
