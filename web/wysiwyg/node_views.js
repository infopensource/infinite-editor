import { openMathEditor, renderMath } from "./math_editor.js";
import { resolveResource } from "../resource_path.js";

class ImageNodeView {
  constructor(node, resources) {
    this.node = node;
    this.resources = resources;
    this.dom = document.createElement("img");
    this.dom.className = "infinite-pm-image";
    this.dom.draggable = true;
    this.update(node);
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.dom.src = resolveResource(this.resources(), node.attrs.src);
    this.dom.alt = node.attrs.alt ?? "";
    this.dom.title = node.attrs.title ?? "";
    this.dom.dataset.markdownSrc = node.attrs.src;
    return true;
  }
}

class MathNodeView {
  constructor(node, displayMode, view, getPos) {
    this.node = node;
    this.displayMode = displayMode;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement(displayMode ? "div" : "span");
    this.dom.className = `infinite-math ${displayMode ? "math-display" : "math-inline"}`;
    this.dom.dataset.mathSource = node.attrs.value;
    this.dom.setAttribute("role", "math");
    this.dom.setAttribute("aria-label", `${displayMode ? "独立" : "行内"}公式，双击或按 Enter 编辑`);
    this.dom.title = "双击编辑 LaTeX 公式";
    this.dom.tabIndex = 0;
    const edit = () => {
      openMathEditor({
        value: this.node.attrs.value,
        displayMode: this.displayMode,
        onSave: (value) => {
          if (value !== this.node.attrs.value) {
            const position = this.getPos();
            if (Number.isInteger(position)) {
              this.view.dispatch(this.view.state.tr.setNodeMarkup(position, undefined, {
                ...this.node.attrs,
                value,
              }));
            }
          }
          this.view.focus();
        },
        onClose: () => this.view.focus(),
      });
    };
    this.dom.addEventListener("dblclick", (event) => {
      event.preventDefault();
      edit();
    });
    this.dom.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      edit();
    });
    renderMath(this.dom, node.attrs.value, displayMode);
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.dom.dataset.mathSource = node.attrs.value;
    renderMath(this.dom, node.attrs.value, this.displayMode);
    return true;
  }

  ignoreMutation() {
    return true;
  }
}

class TaskListItemNodeView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.dom = document.createElement("li");
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "infinite-task-content";
    this.checkbox = document.createElement("input");
    this.checkbox.type = "checkbox";
    this.checkbox.className = "infinite-task-checkbox";
    this.checkbox.contentEditable = "false";
    this.checkbox.addEventListener("change", () => {
      const position = this.getPos();
      if (!Number.isInteger(position)) return;
      this.view.dispatch(this.view.state.tr.setNodeMarkup(position, undefined, {
        ...this.node.attrs,
        checked: this.checkbox.checked,
      }));
      this.view.focus();
    });
    this.update(node);
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.dom.replaceChildren();
    if (node.attrs.checked !== null) {
      this.checkbox.checked = node.attrs.checked;
      this.dom.dataset.taskChecked = String(node.attrs.checked);
      this.dom.append(this.checkbox, this.contentDOM);
    } else {
      delete this.dom.dataset.taskChecked;
      this.dom.append(this.contentDOM);
    }
    return true;
  }

  stopEvent(event) {
    return event.target === this.checkbox;
  }
}

export function createNodeViews(resourceProvider = () => ({})) {
  return {
    image: (node) => new ImageNodeView(node, resourceProvider),
    math_inline: (node, view, getPos) => new MathNodeView(node, false, view, getPos),
    math_block: (node, view, getPos) => new MathNodeView(node, true, view, getPos),
    list_item: (node, view, getPos) => new TaskListItemNodeView(node, view, getPos),
  };
}
