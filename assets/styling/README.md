# 样式目录

`src/styling.rs` 是样式装配入口。应用依次内联 `main.css`、`theme.css`、
`word/` 中的模块、`wysiwyg_core.css` 和 `theme-overrides.css`。PDF 导出复用
同一组 `word/` 模块，因此修改纸张和正文样式会同时影响编辑器与导出。

`word/` 按界面区域拆分。`*-refinements.css`、`title-bar-actions.css` 和
`dialog-themes.css` 保存了原样式后段的覆盖规则，装配顺序不可随意调整；
添加新模块时也要在 `src/styling.rs` 中登记。浏览器分页测试从该清单读取
同一批文件。

定制应用外观时，优先在 `theme-overrides.css` 里覆盖 `theme.css` 定义的
`.word-shell` 变量，例如：

```css
.word-shell {
    --ie-title-background: #28465d;
    --ie-accent: #4479a8;
    --ie-canvas-background: #e8edf2;
}
```

需要整体替换某个控件的外观时，也可在该文件末尾写普通选择器。
这个入口只加载到应用中；它不会改变 PDF 的纸张样式。修改后重新构建应用。
