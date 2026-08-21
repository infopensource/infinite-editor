import katex from "katex";
import "katex/contrib/mhchem";

function renderInto(element, source, displayMode, throwOnError = false) {
  try {
    katex.render(source, element, {
      displayMode,
      throwOnError,
      errorColor: "#b91c1c",
      strict: "warn",
      trust: false,
      output: "htmlAndMathml",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function render(root) {
  if (!root) return { ok: false, error: "缺少公式渲染根节点" };

  let rendered = 0;
  for (const code of root.querySelectorAll("code.language-math")) {
    if (code.closest(".infinite-math")) continue;
    const displayMode = code.classList.contains("math-display");
    const source = code.textContent ?? "";
    const container = displayMode && code.parentElement?.tagName === "PRE"
      ? code.parentElement
      : code;
    const formula = document.createElement(displayMode ? "div" : "span");
    formula.className = `infinite-math ${displayMode ? "math-display" : "math-inline"}`;
    formula.dataset.mathSource = source;
    formula.dataset.mathDisplay = String(displayMode);
    formula.setAttribute("contenteditable", "false");
    formula.setAttribute("tabindex", "0");
    formula.setAttribute("role", "math");
    formula.setAttribute("aria-label", `${displayMode ? "独立" : "行内"}公式，双击编辑`);

    for (const attribute of [...container.attributes, ...code.attributes]) {
      if (attribute.name.startsWith("data-")) formula.setAttribute(attribute.name, attribute.value);
    }

    renderInto(formula, source, displayMode);
    container.replaceWith(formula);
    rendered += 1;
  }
  return { ok: true, rendered };
}

window.InfiniteMathRenderer = { render };
window.dispatchEvent(new CustomEvent("infinite-math-renderer-ready"));
