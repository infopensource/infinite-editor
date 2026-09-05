import { redo, undo } from "prosemirror-history";
import { MinimalWysiwygEditor } from "./editor.js";

const initial = `1. A
   1. A.1
      1. A.1.1
      2. A.1.2
   2. A.2
2. B

- [x] 阶段 2 任务列表
- [ ] 在这里连续输入中文

| 节点 | 状态 |
| :--- | ---: |
| 公式 $x^2$ | ~~旧模型~~ |

<!-- infinite-editor:page-break -->

:::unknown
opaque source
:::`;

const output = document.getElementById("markdown-output");
const composition = document.getElementById("composition-state");
const editor = new MinimalWysiwygEditor(document.getElementById("editor"), initial, {
  onTransaction: ({ getMarkdown }) => { output.value = getMarkdown(); },
  onCompositionChange: (active) => {
    composition.textContent = active ? "IME composing" : "IME idle";
    composition.dataset.active = String(active);
  },
});
output.value = editor.getMarkdown();
document.documentElement.dataset.wysiwygReady = "true";
document.title = "Minimal ProseMirror WYSIWYG Smoke — ready";
document.getElementById("core-state").textContent = "Core ready";

document.getElementById("undo").addEventListener("click", () => {
  undo(editor.state, editor.view.dispatch);
  editor.focus();
});
document.getElementById("redo").addEventListener("click", () => {
  redo(editor.state, editor.view.dispatch);
  editor.focus();
});

window.addEventListener("beforeunload", () => editor.destroy(), { once: true });
