(function () {
    const instances = new Map();
    const pendingEditorMounts = new Map();
    let waitingForMarkdownEditor = false;
    const PAGE_BREAK_MARKER = "<!-- infinite-editor:page-break -->";
    const BLANK_PARAGRAPH_MARKER = "&nbsp;";
    const RENDER_NONE = 0;
    const RENDER_REFLOW = 1;
    const RENDER_CANONICAL = 2;

    function createPage(pages, seamless) {
        const page = document.createElement("article");
        page.className = seamless
            ? "document-page seamless-page"
            : "document-page paged-page";

        const content = document.createElement("div");
        content.className = "document-page-content markdown-rendered-html";
        page.appendChild(content);
        pages.appendChild(page);
        return { page, content };
    }

    function isOverflowing(content) {
        return content.clientHeight > 0 && content.scrollHeight > content.clientHeight + 1;
    }

    function textPosition(root, offset) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let remaining = offset;
        let node = walker.nextNode();

        while (node) {
            if (remaining <= node.data.length) {
                return { node, offset: remaining };
            }
            remaining -= node.data.length;
            node = walker.nextNode();
        }
        return null;
    }

    function cloneTextRange(element, start, end) {
        const startPosition = textPosition(element, start);
        const endPosition = textPosition(element, end);
        if (!startPosition || !endPosition) return null;

        const range = document.createRange();
        range.setStart(startPosition.node, startPosition.offset);
        range.setEnd(endPosition.node, endPosition.offset);
        const clone = element.cloneNode(false);
        clone.appendChild(range.cloneContents());
        return clone;
    }

    function splitToFit(node, content) {
        const length = node.textContent?.length ?? 0;
        if (
            length < 2 ||
            !node.matches("p, pre, blockquote, ul, ol") ||
            node.querySelector("img, video, iframe, svg, table")
        ) {
            return null;
        }

        let low = 1;
        let high = length - 1;
        let best = 0;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const candidate = cloneTextRange(node, 0, middle);
            if (!candidate) return null;
            content.appendChild(candidate);

            if (isOverflowing(content)) {
                high = middle - 1;
            } else {
                best = middle;
                low = middle + 1;
            }
            candidate.remove();
        }

        if (best === 0 || best >= length) return null;
        const head = cloneTextRange(node, 0, best);
        const tail = cloneTextRange(node, best, length);
        if (tail) tail.dataset.documentFragmentContinuation = "true";
        // An explicit structural boundary belongs to the first logical fragment.
        // Keeping it on a pagination tail would turn one quote into two quotes
        // merely because it crossed a page boundary.
        if (node.dataset.separateBlock === "true" && tail) {
            delete tail.dataset.separateBlock;
        }
        return { head, tail };
    }

    function sourceNodes(source, instance = null) {
        const nodes = [];
        let explicitPageBreak = false;
        let blockIndex = 0;

        for (const sourceNode of source.children) {
            if (sourceNode.classList.contains("infinite-page-break")) {
                explicitPageBreak = true;
                continue;
            }

            const node = sourceNode.cloneNode(true);
            node.dataset.documentBlockId = `block-${blockIndex++}`;
            if (explicitPageBreak) {
                node.dataset.explicitPageBreak = "true";
                explicitPageBreak = false;
            }
            node.querySelectorAll("li").forEach((item, index) => {
                item.dataset.documentListItemId = `${node.dataset.documentBlockId}-item-${index}`;
            });
            nodes.push(node);
        }

        const markdownLength = window.InfiniteMarkdownEditor?.getValue?.()?.length
            ?? instance?.markdownLength
            ?? 0;
        for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index];
            const from = Number(node.dataset.markdownFrom);
            const to = Number(node.dataset.markdownTo);
            if (Number.isFinite(from) && Number.isFinite(to)) continue;
            if (!node.matches(".wysiwyg-empty-paragraph")) continue;

            const previous = nodes.slice(0, index).reverse().find((candidate) =>
                Number.isFinite(Number(candidate.dataset.markdownTo))
            );
            const next = nodes.slice(index + 1).find((candidate) =>
                Number.isFinite(Number(candidate.dataset.markdownFrom))
            );
            const position = previous
                ? (next ? Number(previous.dataset.markdownTo) : markdownLength)
                : 0;
            node.dataset.markdownFrom = String(position);
            node.dataset.markdownTo = String(position);
        }

        return nodes;
    }

    function paginate(root, seamless, instance = null, projectedNodes = null) {
        const source = root.querySelector(".document-pagination-source");
        const pages = root.querySelector("[data-document-pages]");
        if (!source || !pages) {
            return { ok: false, error: "缺少分页源节点或页面容器" };
        }

        const nodes = projectedNodes ?? sourceNodes(source, instance);
        pages.replaceChildren();
        pages.className = seamless ? "document-flow seamless" : "document-flow paged";

        if (seamless) {
            const current = createPage(pages, true);
            for (const node of nodes) current.content.appendChild(node);
            root.dataset.pageCount = "1";
            root.dataset.oversizedBlocks = "0";
            configureEditable(instance);
            if (instance) instance.pageBackup = pages.cloneNode(true);
            return { ok: true, pages: 1, oversized: 0 };
        }

        let current = createPage(pages, false);
        let oversized = 0;
        const queue = [...nodes];

        while (queue.length > 0) {
            const node = queue.shift();
            if (node.dataset.explicitPageBreak === "true") {
                current = createPage(pages, false);
            }

            current.content.appendChild(node);
            if (!isOverflowing(current.content)) continue;

            node.remove();
            if (current.content.childElementCount > 0) {
                const previous = current.content.lastElementChild;
                if (
                    previous?.matches("h1, h2, h3, h4, h5, h6") &&
                    previous.previousElementSibling
                ) {
                    previous.remove();
                    current = createPage(pages, false);
                    queue.unshift(node);
                    queue.unshift(previous);
                    continue;
                }

                const split = splitToFit(node, current.content);
                if (split?.head && split?.tail) {
                    current.content.appendChild(split.head);
                    current = createPage(pages, false);
                    queue.unshift(split.tail);
                    continue;
                }

                current = createPage(pages, false);
                queue.unshift(node);
                continue;
            }

            const split = splitToFit(node, current.content);
            if (split?.head && split?.tail) {
                current.content.appendChild(split.head);
                current = createPage(pages, false);
                queue.unshift(split.tail);
                continue;
            }

            current.content.appendChild(node);
            current.page.classList.add("contains-oversized-block");
            oversized += 1;
        }

        [...pages.children].forEach((page, index) => {
            page.dataset.pageNumber = String(index + 1);
        });
        root.dataset.pageCount = String(pages.childElementCount);
        root.dataset.oversizedBlocks = String(oversized);
        configureEditable(instance);
        if (instance) instance.pageBackup = pages.cloneNode(true);
        return { ok: true, pages: pages.childElementCount, oversized };
    }

    function restorePageBackup(instance) {
        const pages = instance?.root.querySelector("[data-document-pages]");
        if (!pages || pages.childElementCount > 0 || !instance.pageBackup) return false;
        pages.className = instance.pageBackup.className;
        pages.replaceChildren(...[...instance.pageBackup.children].map((page) => page.cloneNode(true)));
        configureEditable(instance);
        return true;
    }

    function reflowProjection(instance) {
        const pages = instance.root.querySelector("[data-document-pages]");
        const fragments = [...(pages?.querySelectorAll(".document-page-content > *") ?? [])];
        if (fragments.length === 0) return false;
        const nodes = coalescePaginationFragments(fragments);
        const selection = instance.pendingSelection ?? captureSelection(instance);
        instance.reconciling = true;
        paginate(instance.root, instance.seamless, instance, nodes);
        if (selection) restoreSelection(instance, selection);
        instance.pendingSelection = null;
        instance.reconciling = false;
        return true;
    }

    function schedule(instance, force = false) {
        if (!force && instance.editable && instance.composing) {
            instance.pendingRenderPolicy = Math.max(
                instance.pendingRenderPolicy,
                RENDER_CANONICAL,
            );
            return;
        }
        instance.generation += 1;
        const generation = instance.generation;
        const expectedDocumentRevision = instance.acceptedDocumentRevision;
        const expectedContentRevision = instance.acceptedContentRevision;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (generation !== instance.generation || !instance.root.isConnected) return;
            if (instance.editable && instance.usesController) {
                const snapshot = window.InfiniteMarkdownEditor?.getSnapshot?.();
                if (
                    !snapshot
                    || snapshot.documentRevision !== expectedDocumentRevision
                    || snapshot.editRevision !== expectedContentRevision
                ) {
                    restorePageBackup(instance);
                    return;
                }
            }
            if (instance.editable && !instance.pendingSelection) {
                instance.pendingSelection = captureSelection(instance);
            }
            instance.reconciling = true;
            paginate(instance.root, instance.seamless, instance);
            if (instance.pendingSelection) {
                restoreSelection(instance, instance.pendingSelection);
                instance.pendingSelection = null;
            }
            instance.reconciling = false;
        }));
    }

    function layoutNeedsPagination(instance) {
        if (instance.seamless) return false;
        const pages = [...instance.root.querySelectorAll("[data-document-pages] > .document-page")];
        if (pages.length === 0) return true;
        const contents = pages
            .map((page) => page.querySelector(".document-page-content"))
            .filter(Boolean);
        if (contents.some((content) => isOverflowing(content))) return true;

        for (let index = 1; index < contents.length; index += 1) {
            const previous = contents[index - 1];
            const current = contents[index];
            const first = current.firstElementChild;
            if (!first) return true;
            const probe = first.cloneNode(true);
            previous.appendChild(probe);
            const fits = !isOverflowing(previous);
            probe.remove();
            if (fits) return true;
        }
        return false;
    }

    function markPendingRender(instance, result, policy) {
        if (!result?.ok || !result.changed) return false;
        instance.generation += 1;
        instance.awaitingContentRevision = result.revision
            ?? window.InfiniteMarkdownEditor?.getRevision?.()
            ?? instance.awaitingContentRevision;
        instance.pendingRenderPolicy = Math.max(instance.pendingRenderPolicy, policy);
        return true;
    }

    function normalizeResourceUrl(url) {
        if (!url || /^(?:[a-z]+:|\/\/|#)/i.test(url)) return null;
        const withoutSuffix = url.split(/[?#]/, 1)[0];
        try {
            return decodeURIComponent(withoutSuffix).replace(/^\.\//, "").replaceAll("\\", "/");
        } catch (_) {
            return withoutSuffix.replace(/^\.\//, "").replaceAll("\\", "/");
        }
    }

    function hydrateResources(instance) {
        const source = instance.root.querySelector(".document-pagination-source");
        for (const image of source?.querySelectorAll("img[src]") ?? []) {
            const original = image.dataset.infiniteResourceSource || image.getAttribute("src");
            const key = normalizeResourceUrl(original);
            const resolved = key ? instance.resources[key] : null;
            if (resolved) {
                image.dataset.infiniteResourceSource = original;
                image.setAttribute("src", resolved);
            }
        }
    }

    function bindResourceReflow(instance) {
        const source = instance.root.querySelector(".document-pagination-source");
        hydrateResources(instance);
        const reflow = () => {
            if (!instance.editable || layoutNeedsPagination(instance)) schedule(instance);
        };
        for (const image of source?.querySelectorAll("img") ?? []) {
            if (!image.complete) {
                image.addEventListener("load", reflow, { once: true });
                image.addEventListener("error", reflow, { once: true });
            }
        }
        if (document.fonts?.ready) document.fonts.ready.then(reflow);
    }

    function escapeText(value) {
        return value.replace(/([\\`*_[\]<>~])/g, "\\$1");
    }

    function inlineMarkdown(node, activeMarks = new Set()) {
        if (node.nodeType === Node.TEXT_NODE) return escapeText(node.data);
        if (node.nodeType !== Node.ELEMENT_NODE) return "";

        const element = node;
        const content = (marks = activeMarks) =>
            [...element.childNodes].map((child) => inlineMarkdown(child, marks)).join("");
        const hasMarkableContent = () => element.textContent.trim().length > 0
            || Boolean(element.querySelector("img"));
        switch (element.tagName.toLowerCase()) {
            case "strong":
            case "b": {
                if (activeMarks.has("strong")) return content();
                if (!hasMarkableContent()) return content();
                const marks = new Set(activeMarks).add("strong");
                return `**${content(marks)}**`;
            }
            case "em":
            case "i": {
                if (activeMarks.has("em")) return content();
                if (!hasMarkableContent()) return content();
                const marks = new Set(activeMarks).add("em");
                return `*${content(marks)}*`;
            }
            case "del":
            case "s":
            case "strike": {
                if (activeMarks.has("del")) return content();
                if (!hasMarkableContent()) return content();
                const marks = new Set(activeMarks).add("del");
                return `~~${content(marks)}~~`;
            }
            case "code": return `\`${element.textContent.replaceAll("`", "\\`")}\``;
            case "a": {
                const href = element.getAttribute("href") || "";
                const title = element.getAttribute("title");
                return `[${content()}](${href}${title ? ` \"${title.replaceAll('"', '\\"')}\"` : ""})`;
            }
            case "img": {
                const source = element.dataset.infiniteResourceSource || element.getAttribute("src") || "";
                const alt = (element.getAttribute("alt") || "").replaceAll("]", "\\]");
                const title = element.getAttribute("title");
                return `![${alt}](${source}${title ? ` \"${title.replaceAll('"', '\\"')}\"` : ""})`;
            }
            case "br": return "  \n";
            case "div": return `\n\n${content()}`;
            default: return content();
        }
    }

    function canonicalMarkTag(element) {
        const tag = element?.tagName?.toLowerCase();
        if (tag === "b" || tag === "strong") return "strong";
        if (tag === "i" || tag === "em") return "em";
        if (tag === "s" || tag === "del" || tag === "strike") return "del";
        return null;
    }

    function normalizeFormatting(root) {
        for (const element of [...root.querySelectorAll("strong, b, em, i, del, s, strike")].reverse()) {
            const mark = canonicalMarkTag(element);
            const parentMark = canonicalMarkTag(element.parentElement);
            if (mark === parentMark) element.replaceWith(...element.childNodes);
        }

        let merged = true;
        while (merged) {
            merged = false;
            for (const element of root.querySelectorAll("strong, b, em, i, del, s, strike")) {
                let sibling = element.nextSibling;
                while (sibling?.nodeType === Node.TEXT_NODE && sibling.data.length === 0) {
                    const empty = sibling;
                    sibling = sibling.nextSibling;
                    empty.remove();
                }
                if (!sibling || canonicalMarkTag(element) !== canonicalMarkTag(sibling)) continue;
                while (sibling.firstChild) element.appendChild(sibling.firstChild);
                sibling.remove();
                merged = true;
                break;
            }
        }
    }

    function selectedSlice(node, range) {
        if (!node.data || !range.intersectsNode(node)) return null;
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.data.length;
        return start < end ? { start, end } : null;
    }

    function inlineContainer(textNode) {
        const pageContent = textNode.parentElement?.closest(".document-page-content");
        if (!pageContent || textNode.parentElement?.closest("pre")) return null;
        let element = textNode.parentElement;
        while (element && element !== pageContent) {
            if (element.matches("p, h1, h2, h3, h4, h5, h6, li, td, th")) return element;
            element = element.parentElement;
        }
        return null;
    }

    function collectInlineTokens(container, range) {
        const tokens = [];
        let wrapperSequence = 0;

        const visit = (node, marks, wrappers) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const selected = selectedSlice(node, range);
                const boundaries = selected
                    ? [0, selected.start, selected.end, node.data.length]
                    : [0, node.data.length];
                for (let index = 0; index < boundaries.length - 1; index += 1) {
                    const from = boundaries[index];
                    const to = boundaries[index + 1];
                    if (from === to) continue;
                    tokens.push({
                        type: "text",
                        text: node.data.slice(from, to),
                        marks: new Set(marks),
                        wrappers: [...wrappers],
                        selected: Boolean(selected && from >= selected.start && to <= selected.end),
                    });
                }
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const mark = canonicalMarkTag(node);
            if (mark) {
                const nextMarks = new Set(marks);
                nextMarks.add(mark);
                for (const child of node.childNodes) visit(child, nextMarks, wrappers);
                return;
            }

            const tag = node.tagName.toLowerCase();
            if (tag === "img" || tag === "br") {
                tokens.push({
                    type: "node",
                    node: node.cloneNode(true),
                    marks: new Set(marks),
                    wrappers: [...wrappers],
                    selected: range.intersectsNode(node),
                });
                return;
            }

            let nextWrappers = wrappers;
            if (tag === "a" || tag === "code") {
                const template = node.cloneNode(false);
                nextWrappers = [...wrappers, {
                    key: `inline-wrapper-${wrapperSequence++}`,
                    create: () => template.cloneNode(false),
                }];
            }
            for (const child of node.childNodes) visit(child, marks, nextWrappers);
        };

        for (const child of container.childNodes) visit(child, new Set(), []);
        return tokens;
    }

    function markDescriptor(mark) {
        return {
            key: `mark-${mark}`,
            create: () => document.createElement(mark),
        };
    }

    function rebuildInlineContainer(container, tokens) {
        const markOrder = ["del", "strong", "em"];
        const markDescriptors = new Map(markOrder.map((mark) => [mark, markDescriptor(mark)]));
        const active = [];
        const parents = [container];
        container.replaceChildren();

        for (const token of tokens) {
            const desired = [
                ...markOrder.filter((mark) => token.marks.has(mark)).map((mark) => markDescriptors.get(mark)),
                ...token.wrappers,
            ];
            let common = 0;
            while (
                common < active.length
                && common < desired.length
                && active[common].key === desired[common].key
            ) {
                common += 1;
            }
            active.length = common;
            parents.length = common + 1;
            for (let index = common; index < desired.length; index += 1) {
                const descriptor = desired[index];
                const wrapper = descriptor.create();
                parents.at(-1).appendChild(wrapper);
                active.push(descriptor);
                parents.push(wrapper);
            }
            const leaf = token.type === "text"
                ? document.createTextNode(token.text)
                : token.node.cloneNode(true);
            parents.at(-1).appendChild(leaf);
        }
    }

    function applyMarkCommand(instance, mark, nativeCommand) {
        const selection = window.getSelection?.();
        if (!selection || selection.rangeCount === 0) return false;
        if (selection.isCollapsed) {
            // A collapsed caret needs a stored-mark state. Until the Markdown
            // selection model exposes that state, retain native caret behavior
            // without using it for any non-collapsed toggle.
            document.execCommand?.(nativeCommand, false);
            return true;
        }
        const range = selection.getRangeAt(0);
        const pages = instance.root.querySelector("[data-document-pages]");
        if (!pages) return false;
        const containers = new Set();
        const walker = document.createTreeWalker(pages, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            if (selectedSlice(node, range)) {
                const container = inlineContainer(node);
                if (container) containers.add(container);
            }
            node = walker.nextNode();
        }
        const models = [...containers].map((container) => ({
            container,
            tokens: collectInlineTokens(container, range),
        }));
        const selectedText = models
            .flatMap((model) => model.tokens)
            .filter((token) => token.selected && token.type === "text" && token.text.trim());
        if (selectedText.length === 0) return false;

        const remove = selectedText.every((token) => token.marks.has(mark));
        const bookmark = captureSelection(instance);
        for (const model of models) {
            for (const token of model.tokens) {
                if (!token.selected) continue;
                if (remove) token.marks.delete(mark);
                else token.marks.add(mark);
            }
            rebuildInlineContainer(model.container, model.tokens);
        }
        if (bookmark) restoreSelection(instance, bookmark);
        return true;
    }

    function serializeContainerBlocks(element, separator = "\n\n") {
        const blocks = [];
        let inline = "";
        const flushInline = () => {
            if (inline || blocks.length === 0) blocks.push(inline.trim());
            inline = "";
        };

        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE && child.data.trim() === "") {
                continue;
            }
            if (child.nodeType === Node.ELEMENT_NODE && child.matches("p, div, blockquote, ul, ol, pre")) {
                if (inline) flushInline();
                blocks.push(serializeFragments([child]));
            } else {
                inline += inlineMarkdown(child);
            }
        }
        if (inline || blocks.length === 0) flushInline();
        return blocks.join(separator);
    }

    function serializeList(fragments, ordered) {
        const items = [];
        for (const fragment of fragments) {
            // `:scope` on detached/cloned elements is unreliable in a number of
            // WebViews. An empty result serializes the list as an empty string,
            // which turns a formatting command into deletion of the whole list.
            for (const item of Array.from(fragment.getElementsByTagName("li"))
                .filter((child) => child.parentElement === fragment)) {
                const id = item.dataset.documentListItemId;
                const previous = items.at(-1);
                const markdown = inlineMarkdown(item).trim() || BLANK_PARAGRAPH_MARKER;
                if (id && previous?.id === id && previous.fragment !== fragment) {
                    previous.markdown += markdown;
                } else {
                    items.push({ id, markdown, fragment });
                }
            }
        }
        return items.map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${item.markdown}`).join("\n");
    }

    function serializeTable(table) {
        const rows = [...table.querySelectorAll("tr")].map((row) =>
            [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) =>
                inlineMarkdown(cell).trim().replaceAll("|", "\\|")
            )
        );
        if (rows.length === 0) return "";
        const width = Math.max(...rows.map((row) => row.length));
        const normalize = (row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")];
        const header = normalize(rows[0]);
        return [
            `| ${header.join(" | ")} |`,
            `| ${header.map(() => "---").join(" | ")} |`,
            ...rows.slice(1).map((row) => `| ${normalize(row).join(" | ")} |`),
        ].join("\n");
    }

    function compatibleContinuationElements(left, right) {
        if (
            !left
            || !right
            || left.nodeType !== Node.ELEMENT_NODE
            || right.nodeType !== Node.ELEMENT_NODE
            || left.tagName !== right.tagName
        ) {
            return false;
        }
        const ignored = new Set([
            "data-document-fragment-continuation",
            "data-document-block-id",
            "data-markdown-from",
            "data-markdown-to",
        ]);
        const signature = (element) => [...element.attributes]
            .filter((attribute) => !ignored.has(attribute.name))
            .map((attribute) => `${attribute.name}=${attribute.value}`)
            .sort()
            .join("\u0000");
        return signature(left) === signature(right);
    }

    function appendContinuation(target, source) {
        const incoming = [...source.childNodes].map((node) => node.cloneNode(true));
        const last = target.lastChild;
        const first = incoming[0];
        if (last?.nodeType === Node.TEXT_NODE && first?.nodeType === Node.TEXT_NODE) {
            last.data += first.data;
            incoming.shift();
        } else if (compatibleContinuationElements(last, first)) {
            appendContinuation(last, first);
            incoming.shift();
        }
        target.append(...incoming);
    }

    function coalescePaginationFragments(fragments) {
        const logical = [];
        for (const fragment of fragments) {
            if (
                logical.length === 0
                || fragment.dataset.documentFragmentContinuation !== "true"
            ) {
                logical.push(fragment.cloneNode(true));
            } else {
                appendContinuation(logical.at(-1), fragment);
            }
        }
        for (const fragment of logical) normalizeFormatting(fragment);
        return logical;
    }

    function serializeFragments(fragments) {
        fragments = coalescePaginationFragments(fragments);
        const first = fragments[0];
        const tag = first.tagName.toLowerCase();
        const inline = () => fragments.map((fragment) => inlineMarkdown(fragment)).join("").trim();
        const paragraphs = () => fragments
            .map((fragment) => inlineMarkdown(fragment).trim() || BLANK_PARAGRAPH_MARKER)
            .join("\n\n");

        if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inline()}`;
        if (tag === "p" || tag === "div") return paragraphs();
        if (tag === "pre") {
            const code = fragments.map((fragment) => fragment.textContent).join("").replace(/\n$/, "");
            const codeElement = first.querySelector("code");
            const language = [...(codeElement?.classList ?? [])]
                .find((name) => name.startsWith("language-"))?.slice(9) ?? "";
            const fence = code.includes("```") ? "````" : "```";
            return `${fence}${language}\n${code}\n${fence}`;
        }
        if (tag === "blockquote") {
            const content = fragments
                .map((fragment) => serializeContainerBlocks(fragment))
                .join("\n\n");
            return content.split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
        }
        if (tag === "ul" || tag === "ol") return serializeList(fragments, tag === "ol");
        if (tag === "hr") return "---";
        if (tag === "table") return serializeTable(first);
        return inline();
    }

    function serializeBlockGroup(fragments) {
        const sections = [];
        let current = [];
        let currentTag = null;
        for (const fragment of fragments) {
            const tag = fragment.tagName.toLowerCase();
            if (
                current.length > 0
                && (
                    tag !== currentTag
                    || fragment.dataset.separateBlock === "true"
                    || fragment.dataset.documentFragmentContinuation !== "true"
                )
            ) {
                sections.push(serializeFragments(current));
                current = [];
            }
            currentTag = tag;
            current.push(fragment);
        }
        if (current.length > 0) sections.push(serializeFragments(current));
        return sections.join("\n\n");
    }

    function markdownGroups(root) {
        const pages = root.querySelector("[data-document-pages]");
        if (!pages) return [];

        const groups = [];
        for (const node of pages.querySelectorAll(".document-page-content > *")) {
            const id = node.dataset.documentBlockId;
            const previous = groups.at(-1);
            if (id && previous?.id === id) {
                previous.fragments.push(node);
                previous.explicitPageBreak ||= node.dataset.explicitPageBreak === "true";
            } else {
                groups.push({
                    id,
                    explicitPageBreak: node.dataset.explicitPageBreak === "true",
                    from: Number(node.dataset.markdownFrom),
                    to: Number(node.dataset.markdownTo),
                    fragments: [node],
                });
            }
        }
        return groups;
    }

    function serializeMarkdown(root) {
        const blocks = [];
        for (const group of markdownGroups(root)) {
            if (group.explicitPageBreak) blocks.push(PAGE_BREAK_MARKER);
            const markdown = serializeBlockGroup(group.fragments);
            if (markdown) blocks.push(markdown);
        }
        return blocks.join("\n\n");
    }

    function topLevelBlock(node) {
        let element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        while (element && !element.parentElement?.classList.contains("document-page-content")) {
            element = element.parentElement;
        }
        return element;
    }

    function editorRange(instance) {
        const pages = instance.root.querySelector("[data-document-pages]");
        const selection = window.getSelection?.();
        if (
            pages
            && selection
            && selection.rangeCount > 0
            && pages.contains(selection.anchorNode)
            && pages.contains(selection.focusNode)
        ) {
            const range = selection.getRangeAt(0);
            instance.lastEditorRange = range.cloneRange();
            return range;
        }
        return instance.lastEditorRange?.cloneRange?.() ?? null;
    }

    function selectedBlockIds(instance) {
        const range = editorRange(instance);
        if (!range) return [];
        const ids = new Set();
        if (!range.collapsed) {
            const pages = instance.root.querySelector("[data-document-pages]");
            const walker = document.createTreeWalker(pages, NodeFilter.SHOW_TEXT);
            let text = walker.nextNode();
            while (text) {
                if (selectedSlice(text, range)) {
                    const block = topLevelBlock(text);
                    if (block?.dataset.documentBlockId) ids.add(block.dataset.documentBlockId);
                }
                text = walker.nextNode();
            }
        }
        if (range.collapsed || ids.size === 0) {
            const anchor = topLevelBlock(range.startContainer);
            if (anchor?.dataset.documentBlockId) ids.add(anchor.dataset.documentBlockId);
        }
        return [...ids];
    }

    function inheritBlockMetadata(instance) {
        for (const content of instance.root.querySelectorAll(".document-page-content")) {
            const blockSelector = "p, h1, h2, h3, h4, h5, h6, pre, blockquote, ul, ol, hr, table, div";
            let inlineRun = null;
            for (const child of [...content.childNodes]) {
                const isBlock = child.nodeType === Node.ELEMENT_NODE && child.matches(blockSelector);
                if (isBlock) {
                    inlineRun = null;
                    continue;
                }
                if (child.nodeType === Node.TEXT_NODE && child.data.length === 0) {
                    child.remove();
                    continue;
                }
                if (!inlineRun) {
                    inlineRun = document.createElement("p");
                    content.insertBefore(inlineRun, child);
                }
                inlineRun.appendChild(child);
            }

            const children = [...content.children];
            for (let index = 0; index < children.length; index += 1) {
                const node = children[index];
                if (node.dataset.documentBlockId) continue;
                const neighbor = children.slice(0, index).reverse().find((item) => item.dataset.documentBlockId)
                    || children.slice(index + 1).find((item) => item.dataset.documentBlockId);
                if (neighbor) {
                    node.dataset.documentBlockId = neighbor.dataset.documentBlockId;
                    node.dataset.markdownFrom = neighbor.dataset.markdownFrom;
                    node.dataset.markdownTo = neighbor.dataset.markdownTo;
                    continue;
                }
                const fallbackId = instance.pendingBlockIds?.[0];
                const fallbackRange = fallbackId && instance.pendingGroupRanges?.get(fallbackId);
                if (!fallbackId || !fallbackRange) continue;
                node.dataset.documentBlockId = fallbackId;
                node.dataset.markdownFrom = String(fallbackRange.from);
                node.dataset.markdownTo = String(fallbackRange.to);
            }
        }
    }

    function repairPageStructure(instance) {
        const pages = instance.root.querySelector("[data-document-pages]");
        if (!pages) return;

        for (const page of pages.querySelectorAll(":scope > .document-page")) {
            if (page.querySelector(":scope > .document-page-content")) continue;
            const content = document.createElement("div");
            content.className = "document-page-content markdown-rendered-html";
            content.append(...page.childNodes);
            page.appendChild(content);
        }

        const stray = [...pages.childNodes].filter((node) =>
            node.nodeType !== Node.ELEMENT_NODE || !node.classList.contains("document-page")
        );
        if (stray.length > 0) {
            const { content } = createPage(pages, instance.seamless);
            content.append(...stray);
        }
        if (!pages.querySelector(":scope > .document-page")) {
            createPage(pages, instance.seamless);
        }
        ensureEditablePageBlocks(instance, pages);
    }

    function createEditablePlaceholder(instance, content, pageIndex) {
        const paragraph = document.createElement("p");
        paragraph.className = "wysiwyg-empty-paragraph";
        paragraph.dataset.syntheticEditablePlaceholder = "true";
        const allBlocks = [...instance.root.querySelectorAll(".document-page-content > *")];
        const previous = allBlocks.filter((block) => content.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_PRECEDING).at(-1);
        const next = allBlocks.find((block) => content.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING);
        const position = Number.isFinite(Number(next?.dataset.markdownFrom))
            ? Number(next.dataset.markdownFrom)
            : Number.isFinite(Number(previous?.dataset.markdownTo))
                ? Number(previous.dataset.markdownTo)
                : instance.markdownLength ?? 0;
        const pendingId = instance.pendingBlockIds?.[0];
        const pendingRange = pendingId && instance.pendingGroupRanges?.get(pendingId);
        paragraph.dataset.documentBlockId = pendingId ?? `empty-page-${pageIndex}-${position}`;
        paragraph.dataset.markdownFrom = String(pendingRange?.from ?? position);
        paragraph.dataset.markdownTo = String(pendingRange?.to ?? position);
        paragraph.appendChild(document.createElement("br"));
        content.appendChild(paragraph);
        return paragraph;
    }

    function ensureEditablePageBlocks(instance, pages) {
        if (!instance?.editable || !pages) return;
        const contents = [...pages.querySelectorAll(".document-page-content")];
        for (let index = 0; index < contents.length; index += 1) {
            if (contents[index].childNodes.length === 0) {
                createEditablePlaceholder(instance, contents[index], index);
            }
        }
    }

    function normalizeStructuralCaret(instance) {
        const pages = instance.root.querySelector("[data-document-pages]");
        const selection = window.getSelection?.();
        if (
            !pages
            || !selection
            || !selection.isCollapsed
            || !pages.contains(selection.anchorNode)
            || topLevelBlock(selection.anchorNode)
        ) {
            return;
        }

        let content = (selection.anchorNode.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode
            : selection.anchorNode.parentElement)?.closest?.(".document-page-content");
        let atStart = selection.anchorOffset === 0;
        if (!content) {
            const pagesList = [...pages.querySelectorAll(":scope > .document-page")];
            const pageIndex = selection.anchorNode === pages && selection.anchorOffset > 0
                ? Math.min(selection.anchorOffset - 1, pagesList.length - 1)
                : 0;
            content = pagesList[Math.max(0, pageIndex)]?.querySelector(".document-page-content");
            atStart = selection.anchorOffset === 0;
        }
        if (!content) return;
        const blocks = [...content.children];
        const targetIndex = atStart
            ? Math.min(selection.anchorOffset, Math.max(0, blocks.length - 1))
            : Math.min(Math.max(0, selection.anchorOffset - 1), Math.max(0, blocks.length - 1));
        const target = blocks[targetIndex] ?? createEditablePlaceholder(instance, content, 0);
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(atStart);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function updateSourceRanges(instance, edits) {
        const nodes = [...instance.root.querySelectorAll(".document-page-content > *")];
        for (const node of nodes) {
            const originalFrom = Number(node.dataset.markdownFrom);
            const originalTo = Number(node.dataset.markdownTo);
            if (!Number.isFinite(originalFrom) || !Number.isFinite(originalTo)) continue;
            const id = node.dataset.documentBlockId;
            const delta = (edit) => edit.insert.length - (edit.to - edit.from);
            const precedingShift = edits
                .filter((edit) => edit.id !== id && edit.to <= originalFrom)
                .reduce((total, edit) => total + delta(edit), 0);
            const ownShift = edits
                .filter((edit) => edit.id === id)
                .reduce((total, edit) => total + delta(edit), 0);
            node.dataset.markdownFrom = String(originalFrom + precedingShift);
            node.dataset.markdownTo = String(originalTo + precedingShift + ownShift);
        }
    }

    function minimalEdit(source, from, to, insert, id) {
        const previous = source.slice(from, to);
        if (previous === insert) return null;
        const previousPoints = Array.from(previous);
        const nextPoints = Array.from(insert);
        let prefixPoints = 0;
        while (
            prefixPoints < previousPoints.length
            && prefixPoints < nextPoints.length
            && previousPoints[prefixPoints] === nextPoints[prefixPoints]
        ) {
            prefixPoints += 1;
        }
        let suffixPoints = 0;
        while (
            suffixPoints < previousPoints.length - prefixPoints
            && suffixPoints < nextPoints.length - prefixPoints
            && previousPoints[previousPoints.length - 1 - suffixPoints]
                === nextPoints[nextPoints.length - 1 - suffixPoints]
        ) {
            suffixPoints += 1;
        }
        const prefix = previousPoints.slice(0, prefixPoints).join("").length;
        const previousSuffix = suffixPoints === 0
            ? previous.length
            : previous.length - previousPoints.slice(-suffixPoints).join("").length;
        const nextSuffix = suffixPoints === 0
            ? insert.length
            : insert.length - nextPoints.slice(-suffixPoints).join("").length;
        return {
            id,
            from: from + prefix,
            to: from + previousSuffix,
            insert: insert.slice(prefix, nextSuffix),
        };
    }

    function dispatchAffectedMarkdown(
        instance,
        origin = "wysiwyg-input",
        userEvent = "input.type",
        isolate = false,
    ) {
        inheritBlockMetadata(instance);
        const affected = new Set([
            ...(instance.pendingBlockIds ?? []),
            ...selectedBlockIds(instance),
        ]);
        instance.pendingBlockIds = [];
        const pendingGroupRanges = instance.pendingGroupRanges ?? new Map();
        instance.pendingGroupRanges = new Map();
        const combinedInput = instance.pendingCombinedInput;
        instance.pendingCombinedInput = null;
        const source = window.InfiniteMarkdownEditor?.getValue?.();
        const currentGroups = markdownGroups(instance.root);
        const affectedGroups = currentGroups
            .filter((group) => affected.has(group.id) && Number.isFinite(group.from) && Number.isFinite(group.to));
        let edits = affectedGroups
            .map((group) => {
                const insert = serializeBlockGroup(group.fragments);
                const lostNonEmptyList = group.fragments.some((fragment) =>
                    fragment.matches("ul, ol")
                    && fragment.textContent.trim()
                    && !insert.trim()
                );
                if (lostNonEmptyList) return null;
                return typeof source === "string"
                    ? minimalEdit(source, group.from, group.to, insert, group.id)
                    : { id: group.id, from: group.from, to: group.to, insert };
            })
            .filter(Boolean);
        if (combinedInput && typeof source === "string") {
            const insert = affectedGroups
                .map((group) => [
                    group.explicitPageBreak ? PAGE_BREAK_MARKER : null,
                    serializeBlockGroup(group.fragments),
                ].filter(Boolean).join("\n\n"))
                .filter(Boolean)
                .join("\n\n");
            const combinedEdit = minimalEdit(
                source,
                combinedInput.from,
                combinedInput.to,
                insert,
                combinedInput.id,
            );
            edits = combinedEdit ? [combinedEdit] : [];
        }
        if (typeof source === "string") {
            const currentIds = new Set(currentGroups.map((group) => group.id));
            for (const id of combinedInput ? [] : affected) {
                if (currentIds.has(id)) continue;
                const range = pendingGroupRanges.get(id);
                if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) continue;
                let from = range.from;
                let to = range.to;
                if (source.slice(to, to + 2) === "\n\n") to += 2;
                else if (from >= 2 && source.slice(from - 2, from) === "\n\n") from -= 2;
                const edit = minimalEdit(source, from, to, "", id);
                if (edit) edits.push(edit);
            }
            edits.sort((left, right) => left.from - right.from);
            for (let index = 1; index < edits.length;) {
                const previous = edits[index - 1];
                const current = edits[index];
                if (previous.insert === "" && current.insert === "" && current.from <= previous.to) {
                    previous.to = Math.max(previous.to, current.to);
                    edits.splice(index, 1);
                } else {
                    index += 1;
                }
            }

            const pages = instance.root.querySelector("[data-document-pages]");
            const projectedContent = Boolean(
                pages?.textContent.trim()
                || pages?.querySelector("img, video, audio, iframe, table, hr")
            );
            let nextSource = source;
            for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
                nextSource = nextSource.slice(0, edit.from) + edit.insert + nextSource.slice(edit.to);
            }
            if (source.trim() && !nextSource.trim() && projectedContent) {
                return {
                    ok: false,
                    changed: false,
                    error: "已阻止会清空文档的无效 WYSIWYG transaction",
                };
            }
        }

        if (typeof source === "string") {
            if (edits.length === 0) {
                return {
                    ok: false,
                    changed: false,
                    error: "无法确定 WYSIWYG 修改对应的 Markdown 源码范围",
                };
            }
            if (!window.InfiniteMarkdownEditor?.applyEdits) {
                return {
                    ok: false,
                    changed: false,
                    error: "Markdown 编辑器不支持增量修改",
                };
            }
            const result = window.InfiniteMarkdownEditor.applyEdits(
                edits,
                origin,
                userEvent,
                isolate,
            );
            if (result?.ok) {
                if (result.changed) {
                    updateSourceRanges(instance, edits);
                    instance.markdownLength = source.length + edits.reduce(
                        (length, edit) => length + edit.insert.length - (edit.to - edit.from),
                        0,
                    );
                }
                return result;
            }
            return result ?? {
                ok: false,
                changed: false,
                error: "Markdown 增量修改失败",
            };
        }
        return dispatchMarkdown(
            instance,
            serializeMarkdown(instance.root),
            origin,
            userEvent,
            isolate,
        );
    }

    function selectionOffset(pages, targetNode, targetOffset) {
        let offset = 0;
        const walker = document.createTreeWalker(pages, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            if (node === targetNode) return offset + Math.min(targetOffset, node.data.length);
            offset += node.data.length;
            node = walker.nextNode();
        }
        return null;
    }

    function captureSelection(instance) {
        const pages = instance.root.querySelector("[data-document-pages]");
        const selection = window.getSelection?.();
        if (!pages || !selection || selection.rangeCount === 0) return null;
        if (!pages.contains(selection.anchorNode) || !pages.contains(selection.focusNode)) return null;
        const structural = (() => {
            if (!selection.isCollapsed) return null;
            const block = topLevelBlock(selection.anchorNode);
            const id = block?.dataset.documentBlockId;
            if (!block || !id) return null;
            const matches = [...pages.querySelectorAll(".document-page-content > *")]
                .filter((candidate) => candidate.dataset.documentBlockId === id);
            const allBlocks = [...pages.querySelectorAll(".document-page-content > *")];
            const logicalBlocks = allBlocks.filter((candidate) =>
                candidate.dataset.documentFragmentContinuation !== "true"
            );
            let logicalBlock = block;
            if (block.dataset.documentFragmentContinuation === "true") {
                const blockIndex = allBlocks.indexOf(block);
                logicalBlock = allBlocks.slice(0, blockIndex + 1).reverse().find((candidate) =>
                    candidate.dataset.documentFragmentContinuation !== "true"
                ) ?? block;
            }
            let offset = 0;
            try {
                const prefix = document.createRange();
                prefix.selectNodeContents(block);
                prefix.setEnd(selection.anchorNode, selection.anchorOffset);
                offset = prefix.toString().length;
            } catch (_) {
                offset = 0;
            }
            return {
                blockId: id,
                blockOrdinal: Math.max(0, matches.indexOf(block)),
                logicalBlockIndex: Math.max(0, logicalBlocks.indexOf(logicalBlock)),
                offset,
            };
        })();
        const anchor = selectionOffset(pages, selection.anchorNode, selection.anchorOffset);
        const focus = selectionOffset(pages, selection.focusNode, selection.focusOffset);
        return (anchor === null || focus === null) && !structural
            ? null
            : {
                anchor,
                focus,
                structural,
                focused: instance.hasEditorFocus || pages.contains(document.activeElement),
            };
    }

    function globalTextPosition(root, targetOffset) {
        let offset = 0;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let last = null;
        while (node) {
            last = node;
            if (targetOffset <= offset + node.data.length) {
                return { node, offset: Math.max(0, targetOffset - offset) };
            }
            offset += node.data.length;
            node = walker.nextNode();
        }
        return last ? { node: last, offset: last.data.length } : null;
    }

    function restoreSelection(instance, bookmark) {
        const pages = instance.root.querySelector("[data-document-pages]");
        const selection = window.getSelection?.();
        if (!pages || !selection) return;
        if (bookmark.structural) {
            const matches = [...pages.querySelectorAll(".document-page-content > *")]
                .filter((candidate) => candidate.dataset.documentBlockId === bookmark.structural.blockId);
            const logicalBlocks = [...pages.querySelectorAll(".document-page-content > *")]
                .filter((candidate) => candidate.dataset.documentFragmentContinuation !== "true");
            const block = matches[bookmark.structural.blockOrdinal]
                ?? logicalBlocks[bookmark.structural.logicalBlockIndex];
            if (block) {
                const position = globalTextPosition(block, bookmark.structural.offset);
                const range = document.createRange();
                if (position) {
                    range.setStart(position.node, position.offset);
                } else {
                    range.selectNodeContents(block);
                    range.collapse(true);
                }
                if (bookmark.focused) pages.focus({ preventScroll: true });
                selection.removeAllRanges();
                selection.addRange(range);
                instance.hasEditorFocus = bookmark.focused;
                return;
            }
        }
        const anchor = bookmark.anchor === null ? null : globalTextPosition(pages, bookmark.anchor);
        const focus = bookmark.focus === null ? null : globalTextPosition(pages, bookmark.focus);
        if (!anchor || !focus) return;
        if (bookmark.focused) {
            pages.focus({ preventScroll: true });
            instance.hasEditorFocus = true;
        }
        selection.removeAllRanges();
        if (selection.setBaseAndExtent) {
            selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        } else {
            const range = document.createRange();
            range.setStart(anchor.node, anchor.offset);
            range.setEnd(focus.node, focus.offset);
            selection.addRange(range);
        }
    }

    function dispatchMarkdown(
        instance,
        snapshot = null,
        origin = "wysiwyg-input",
        userEvent = "input.type",
        isolate = false,
    ) {
        const markdown = snapshot ?? serializeMarkdown(instance.root);
        if (window.InfiniteMarkdownEditor) {
            const result = window.InfiniteMarkdownEditor.replaceAll(
                markdown,
                origin,
                userEvent,
                isolate,
            );
            if (result?.ok) return result;
        }
        const bridge = instance.bridgeId && document.getElementById(instance.bridgeId);
        if (!bridge) return { ok: false, error: "Markdown bridge 不存在" };
        const revision = (instance.fallbackRevision ?? 0) + 1;
        instance.fallbackRevision = revision;
        const payload = JSON.stringify({
            document_revision: instance.documentRevision,
            edit_revision: revision,
            origin,
            markdown,
        });
        if (bridge.value === payload) return { ok: true, changed: false, revision };
        bridge.value = payload;
        bridge.dispatchEvent(new Event("input", { bubbles: true }));
        return { ok: true, changed: true, revision };
    }

    function configureEditable(instance) {
        if (!instance) return;
        const pages = instance.root.querySelector("[data-document-pages]");
        if (!pages) return;
        if (instance.editable) {
            pages.setAttribute("contenteditable", "true");
            pages.setAttribute("spellcheck", "true");
            pages.setAttribute("role", "textbox");
            pages.setAttribute("aria-multiline", "true");
            ensureEditablePageBlocks(instance, pages);
        } else {
            pages.removeAttribute("contenteditable");
            pages.removeAttribute("spellcheck");
            pages.removeAttribute("role");
            pages.removeAttribute("aria-multiline");
        }
        for (const content of pages?.querySelectorAll(".document-page-content") ?? []) {
            // Page contents inherit editability from one shared host. Separate
            // editing hosts prevent native selections from crossing pages.
            content.removeAttribute("contenteditable");
            content.removeAttribute("spellcheck");
            content.removeAttribute("role");
            content.removeAttribute("aria-multiline");
        }
    }

    function inputTransaction(inputType, composing = false) {
        if (composing || inputType === "insertCompositionText") {
            return { userEvent: "input.type.compose", isolate: false, policy: RENDER_REFLOW };
        }
        if (inputType === "deleteContentBackward") {
            return { userEvent: "delete.backward", isolate: false, policy: RENDER_REFLOW };
        }
        if (inputType === "deleteContentForward") {
            return { userEvent: "delete.forward", isolate: false, policy: RENDER_REFLOW };
        }
        if (inputType === "insertParagraph" || inputType === "insertLineBreak") {
            // The browser has already projected Enter into the live editable DOM.
            // Keep that projection and only repaginate if it really crosses a page
            // boundary; replacing every page here is the visible "flash back".
            return { userEvent: "input", isolate: true, policy: RENDER_REFLOW };
        }
        if (inputType === "insertFromPaste" || inputType === "insertFromDrop") {
            return { userEvent: "input", isolate: true, policy: RENDER_CANONICAL };
        }
        return { userEvent: "input.type", isolate: false, policy: RENDER_REFLOW };
    }

    function commitInput(instance, inputType, composing = false) {
        const transaction = inputTransaction(inputType, composing);
        const result = dispatchAffectedMarkdown(
            instance,
            "wysiwyg-input",
            transaction.userEvent,
            transaction.isolate,
        );
        if (
            result?.ok
            && result.changed
            && !instance.seamless
            && (transaction.policy === RENDER_CANONICAL || layoutNeedsPagination(instance))
        ) {
            reflowProjection(instance);
        }
        markPendingRender(instance, result, transaction.policy);
        if (!result?.ok) schedule(instance, true);
        return result;
    }

    function editorShortcut(event) {
        if (!(event.ctrlKey || event.metaKey)) return null;
        const key = event.key.toLowerCase();
        if (key === "b") return "bold";
        if (key === "i") return "italic";
        if (key === "z" && event.shiftKey) return "redo";
        if (key === "z") return "undo";
        if (key === "y") return "redo";
        return null;
    }

    function selectedListItemIndexes(instance) {
        const result = new Map();
        const range = editorRange(instance);
        if (!range) return result;
        const add = (node) => {
            const item = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest?.("li");
            const block = topLevelBlock(item);
            if (!item || !block?.matches("ul, ol") || !block.dataset.documentBlockId) return;
            const idIndex = /-item-(\d+)$/.exec(item.dataset.documentListItemId ?? "");
            const directItems = Array.from(item.parentElement?.children ?? []).filter((child) => child.matches("li"));
            const duplicatedInFragment = directItems.filter((candidate) =>
                candidate.dataset.documentListItemId
                && candidate.dataset.documentListItemId === item.dataset.documentListItemId
            ).length > 1;
            const index = idIndex && !duplicatedInFragment
                ? Number(idIndex[1])
                : directItems.indexOf(item);
            if (index < 0) return;
            if (!result.has(block.dataset.documentBlockId)) result.set(block.dataset.documentBlockId, new Set());
            result.get(block.dataset.documentBlockId).add(index);
        };
        if (!range.collapsed) {
            const pages = instance.root.querySelector("[data-document-pages]");
            const walker = document.createTreeWalker(pages, NodeFilter.SHOW_TEXT);
            let text = walker.nextNode();
            while (text) {
                if (selectedSlice(text, range)) add(text);
                text = walker.nextNode();
            }
        }
        if (range.collapsed || result.size === 0) add(range.startContainer);
        return result;
    }

    function transformListMarkdown(markdown, ordered, selectedIndexes = null) {
        const target = ordered ? /^(\s*)\d+[.)]\s+/ : /^(\s*)[-+*]\s+/;
        const anyList = /^(\s*)(?:[-+*]|\d+[.)])\s+/;
        const lines = markdown.split("\n");
        let itemIndex = -1;
        const selectedLines = lines.map((line) => {
            const listItem = anyList.test(line);
            if (listItem) itemIndex += 1;
            return selectedIndexes ? listItem && selectedIndexes.has(itemIndex) : true;
        });
        const selectedContent = lines.filter((line, index) => line.trim() && selectedLines[index]);
        const remove = selectedContent.length > 0 && selectedContent.every((line) => target.test(line));
        let number = 1;
        return lines.map((line, index) => {
            if (!line.trim() || !selectedLines[index]) return line;
            if (remove) return line.replace(target, "$1");
            const existing = anyList.exec(line);
            const indentation = existing?.[1] ?? /^(\s*)/.exec(line)[1];
            const content = existing ? line.slice(existing[0].length) : line.slice(indentation.length);
            const marker = ordered ? `${number++}. ` : "- ";
            return `${indentation}${marker}${content}`;
        }).join("\n");
    }

    function applyListCommand(instance, ordered) {
        const source = window.InfiniteMarkdownEditor?.getValue?.();
        if (typeof source !== "string" || !window.InfiniteMarkdownEditor?.applyEdits) {
            return { ok: false, changed: false, error: "Markdown 编辑器不支持列表修改" };
        }
        const selectedIds = new Set(selectedBlockIds(instance));
        const selectedItems = selectedListItemIndexes(instance);
        const edits = markdownGroups(instance.root)
            .filter((group) => selectedIds.has(group.id)
                && Number.isFinite(group.from)
                && Number.isFinite(group.to))
            .map((group) => {
                const isList = group.fragments.some((fragment) => fragment.matches("ul, ol"));
                const indexes = selectedItems.get(group.id);
                if (isList && (!indexes || indexes.size === 0)) return null;
                return minimalEdit(
                    source,
                    group.from,
                    group.to,
                    transformListMarkdown(source.slice(group.from, group.to), ordered, indexes),
                    group.id,
                );
            })
            .filter(Boolean);
        if (edits.length === 0) {
            return { ok: false, changed: false, error: "无法确定列表对应的 Markdown 源码范围" };
        }
        return window.InfiniteMarkdownEditor.applyEdits(
            edits,
            "wysiwyg-command",
            "input",
            true,
        );
    }

    function quoteParagraph(node) {
        let element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        while (element && !element.matches("p, div")) {
            if (element.matches("blockquote, .document-page-content")) return null;
            element = element.parentElement;
        }
        return element?.parentElement?.matches("blockquote") ? element : null;
    }

    function emptyEditableBlock(element) {
        return Boolean(
            element
            && element.textContent.trim() === ""
            && !element.querySelector("img, video, audio, iframe, table, hr")
        );
    }

    function trimTrailingEmptyQuoteParagraphs(quote) {
        while (quote.children.length > 1 && emptyEditableBlock(quote.lastElementChild)) {
            quote.lastElementChild.remove();
        }
    }

    function placeCaret(instance, element, atStart = true) {
        const selection = window.getSelection?.();
        if (!selection || !element) return;
        instance.root.querySelector("[data-document-pages]")?.focus({ preventScroll: true });
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(atStart);
        selection.removeAllRanges();
        selection.addRange(range);
        instance.hasEditorFocus = true;
    }

    function insertHorizontalRule(instance) {
        const range = editorRange(instance);
        const block = range && topLevelBlock(range.startContainer);
        if (!block) return false;
        const rule = document.createElement("hr");
        const paragraph = document.createElement("p");
        paragraph.className = "wysiwyg-empty-paragraph";
        paragraph.appendChild(document.createElement("br"));
        block.after(rule, paragraph);
        placeCaret(instance, paragraph);
        return true;
    }

    function normalizeParagraphInput(instance, inputType) {
        const splitEmptyQuote = inputType === "insertParagraph" && instance.pendingEmptyQuoteBreak;
        instance.pendingEmptyQuoteBreak = false;
        if (!splitEmptyQuote) return;
        const pages = instance.root.querySelector("[data-document-pages]");
        if (!pages) return;

        const selection = window.getSelection?.();
        const selectedTopLevel = topLevelBlock(selection?.anchorNode);
        let changed = false;
        let caretTarget = null;

        if (selectedTopLevel?.matches("blockquote")) {
            const selectedParagraph = quoteParagraph(selection?.anchorNode);
            if (selectedParagraph) {
                const trailingQuote = selectedTopLevel.cloneNode(false);
                delete trailingQuote.dataset.explicitPageBreak;
                let moving = selectedParagraph.nextElementSibling;
                while (moving) {
                    const next = moving.nextElementSibling;
                    trailingQuote.appendChild(moving);
                    moving = next;
                }
                selectedTopLevel.after(selectedParagraph);
                if (trailingQuote.childElementCount > 0) {
                    selectedParagraph.after(trailingQuote);
                }
                trimTrailingEmptyQuoteParagraphs(selectedTopLevel);
                caretTarget = selectedParagraph;
                changed = true;
            }
        } else if (selectedTopLevel?.matches("p, div")) {
            const previousQuote = selectedTopLevel.previousElementSibling;
            if (previousQuote?.matches("blockquote")) {
                trimTrailingEmptyQuoteParagraphs(previousQuote);
                caretTarget = selectedTopLevel;
                changed = true;
            }
        }
        if (changed) placeCaret(instance, caretTarget);
    }

    function removeSelectedEmptyStructures(instance, inputType) {
        if (!inputType?.startsWith("delete")) return;
        const selected = new Set(instance.pendingBlockIds ?? []);
        if (selected.size === 0) return;
        for (const block of instance.root.querySelectorAll(".document-page-content > *")) {
            if (!selected.has(block.dataset.documentBlockId)) continue;
            if (!block.matches("h1, h2, h3, h4, h5, h6, blockquote, ul, ol")) continue;
            if (!emptyEditableBlock(block)) continue;
            block.remove();
        }
    }

    function selectionCoversDocument(instance) {
        const pages = instance.root.querySelector("[data-document-pages]");
        const selection = window.getSelection?.();
        if (!pages || !selection || selection.isCollapsed || selection.rangeCount === 0) return false;
        const range = selection.getRangeAt(0);
        const blocks = [...pages.querySelectorAll(".document-page-content > *")];
        if (blocks.length === 0) return true;

        try {
            const documentRange = document.createRange();
            documentRange.setStartBefore(blocks[0]);
            documentRange.setEndAfter(blocks.at(-1));
            if (
                range.compareBoundaryPoints(window.Range.START_TO_START, documentRange) <= 0
                && range.compareBoundaryPoints(window.Range.END_TO_END, documentRange) >= 0
            ) {
                return true;
            }
        } catch (_) {
            // Text boundary checks below also cover browser selections whose
            // endpoints are inside the first and last blocks.
        }

        const walker = document.createTreeWalker(pages, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node = walker.nextNode();
        while (node) {
            if (node.data.length > 0) nodes.push(node);
            node = walker.nextNode();
        }
        if (nodes.length === 0) return true;
        const first = selectedSlice(nodes[0], range);
        const lastNode = nodes.at(-1);
        const last = selectedSlice(lastNode, range);
        return Boolean(first?.start === 0 && last?.end === lastNode.data.length);
    }

    function selectEntireDocument(instance) {
        const pages = instance.root.querySelector("[data-document-pages]");
        const selection = window.getSelection?.();
        if (!pages || !selection) return false;
        const range = document.createRange();
        range.selectNodeContents(pages);
        selection.removeAllRanges();
        selection.addRange(range);
        instance.lastEditorRange = range.cloneRange();
        return true;
    }

    function replaceDocumentWithMarkdown(instance, markdown) {
        const pages = instance.root.querySelector("[data-document-pages]");
        const groups = markdownGroups(instance.root);
        const firstContent = pages?.querySelector(".document-page-content");
        if (!pages || !firstContent || groups.length === 0) {
            return false;
        }

        const id = groups.find((group) => group.id)?.id;
        if (!id) return false;
        const normalized = markdown.replace(/\r\n?/g, "\n");
        const result = dispatchMarkdown(
            instance,
            normalized,
            "wysiwyg-input",
            "input",
            true,
        );
        if (!result?.ok) {
            schedule(instance, true);
            return false;
        }
        if (!result.changed) return true;

        // This is only a temporary projection until the canonical Markdown
        // renderer returns. It must never be serialized back into the source.
        const paragraphs = normalized.split("\n").map((line) => {
            const paragraph = document.createElement("p");
            paragraph.dataset.documentBlockId = id;
            paragraph.dataset.markdownFrom = "0";
            paragraph.dataset.markdownTo = String(normalized.length);
            if (line) {
                paragraph.textContent = line;
            } else {
                paragraph.className = "wysiwyg-empty-paragraph";
                paragraph.appendChild(document.createElement("br"));
            }
            return paragraph;
        });

        for (const content of pages.querySelectorAll(".document-page-content")) {
            content.replaceChildren();
        }
        firstContent.append(...paragraphs);
        placeCaret(instance, paragraphs.at(-1), false);
        instance.pendingSelection = captureSelection(instance);
        instance.markdownLength = normalized.length;
        reflowProjection(instance);
        markPendingRender(instance, result, RENDER_CANONICAL);
        return true;
    }

    function bindEditing(instance) {
        const pages = instance.root.querySelector("[data-document-pages]");
        if (!pages) return;
        if (!instance.keydownHandler) {
            instance.keydownHandler = (event) => {
                if (!instance.root.isConnected || !instance.editable || !instance.hasEditorFocus) return;
                if (
                    (event.ctrlKey || event.metaKey)
                    && !event.altKey
                    && event.key.toLowerCase() === "a"
                    && selectEntireDocument(instance)
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                const shortcut = editorShortcut(event);
                if (!shortcut) return;
                event.preventDefault();
                event.stopPropagation();
                command(instance.root.id, shortcut);
            };
            window.addEventListener("keydown", instance.keydownHandler, true);
        }
        if (instance.pages === pages) return;
        instance.pages = pages;
        pages.addEventListener("input", (event) => {
            if (!instance.editable) return;
            if (instance.composing) return;
            const inputType = event.inputType || instance.pendingInputType || "insertText";
            instance.pendingInputType = null;
            repairPageStructure(instance);
            inheritBlockMetadata(instance);
            normalizeStructuralCaret(instance);
            normalizeParagraphInput(instance, inputType);
            removeSelectedEmptyStructures(instance, inputType);
            instance.pendingSelection = captureSelection(instance);
            commitInput(instance, inputType);
        });
        pages.addEventListener("beforeinput", (event) => {
            const groups = markdownGroups(instance.root);
            const selectedIds = new Set(selectedBlockIds(instance));
            if (event.inputType?.startsWith("delete")) {
                const directlySelected = new Set(selectedIds);
                for (let index = 0; index < groups.length; index += 1) {
                    if (!directlySelected.has(groups[index].id)) continue;
                    if (index > 0) selectedIds.add(groups[index - 1].id);
                    if (index + 1 < groups.length) selectedIds.add(groups[index + 1].id);
                }
            }
            instance.pendingBlockIds = [...new Set([
                ...instance.pendingBlockIds,
                ...selectedIds,
            ])];
            for (const group of groups) {
                if (!selectedIds.has(group.id)) continue;
                instance.pendingGroupRanges.set(group.id, { from: group.from, to: group.to });
            }
            if (
                (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop")
                && selectedIds.size > 0
            ) {
                instance.pendingCombinedInput = null;
                const selectedGroups = groups.filter((group) =>
                    selectedIds.has(group.id)
                    && Number.isFinite(group.from)
                    && Number.isFinite(group.to)
                );
                if (selectedGroups.length > 0) {
                    if (selectedGroups.length > 1) {
                        instance.pendingCombinedInput = {
                            id: selectedGroups[0].id,
                            from: Math.min(...selectedGroups.map((group) => group.from)),
                            to: Math.max(...selectedGroups.map((group) => group.to)),
                        };
                    }
                }
            } else {
                instance.pendingCombinedInput = null;
            }
            instance.pendingInputType = event.inputType || "insertText";
            const selection = window.getSelection?.();
            instance.pendingEmptyQuoteBreak = event.inputType === "insertParagraph"
                && emptyEditableBlock(quoteParagraph(selection?.anchorNode));
        });
        pages.addEventListener("paste", (event) => {
            if (!instance.editable || !selectionCoversDocument(instance)) return;
            const text = event.clipboardData?.getData?.("text/plain");
            if (!text) return;
            event.preventDefault();
            event.stopPropagation();
            replaceDocumentWithMarkdown(instance, text);
        });
        pages.addEventListener("compositionstart", () => {
            instance.composing = true;
        });
        pages.addEventListener("compositionend", () => {
            instance.composing = false;
            instance.pendingSelection = captureSelection(instance);
            instance.pendingInputType = null;
            commitInput(instance, "insertCompositionText", true);
        });
        pages.addEventListener("focusin", () => {
            instance.hasEditorFocus = true;
        });
        pages.addEventListener("focusout", () => {
            queueMicrotask(() => {
                if (instance.reconciling || pages.contains(document.activeElement)) return;
                instance.hasEditorFocus = false;
                if (instance.awaitingContentRevision === null) {
                    schedule(instance, true);
                } else {
                    instance.pendingRenderPolicy = RENDER_CANONICAL;
                }
            });
        });
        pages.addEventListener("click", (event) => {
            if (instance.editable && event.target.closest?.("a")) event.preventDefault();
        });
    }

    function clearSelectionHighlight(instance) {
        instance.selectionLayer?.replaceChildren();
    }

    function selectionClipBounds(instance, node) {
        const content = node.parentElement?.closest(".document-page-content");
        if (!content) return null;
        const contentRect = content.getBoundingClientRect();
        const surface = instance.root.closest(".editor-surface");
        const surfaceRect = surface?.getBoundingClientRect();
        const stickyRulerRect = surface
            ?.querySelector(".page-ruler-sticky")
            ?.getBoundingClientRect();
        return {
            left: Math.max(contentRect.left, surfaceRect?.left ?? 0, 0),
            top: Math.max(
                contentRect.top,
                surfaceRect?.top ?? 0,
                stickyRulerRect?.bottom ?? 0,
                0,
            ),
            right: Math.min(
                contentRect.right,
                surfaceRect?.right ?? window.innerWidth,
                window.innerWidth,
            ),
            bottom: Math.min(
                contentRect.bottom,
                surfaceRect?.bottom ?? window.innerHeight,
                window.innerHeight,
            ),
        };
    }

    function clipSelectionRect(rect, bounds) {
        const left = Math.max(rect.left, bounds.left);
        const top = Math.max(rect.top, bounds.top);
        const right = Math.min(rect.right, bounds.right);
        const bottom = Math.min(rect.bottom, bounds.bottom);
        return right > left && bottom > top
            ? { left, top, width: right - left, height: bottom - top }
            : null;
    }

    function paintTextSelection(instance) {
        instance.selectionFrame = null;
        clearSelectionHighlight(instance);
        if (!instance.editable || !instance.root.isConnected) return;

        const selection = window.getSelection?.();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
        if (!instance.root.contains(selection.anchorNode) || !instance.root.contains(selection.focusNode)) return;

        const pages = instance.root.querySelector("[data-document-pages]");
        if (!pages) return;
        const range = selection.getRangeAt(0);
        const layer = instance.selectionLayer ?? document.createElement("div");
        layer.className = "wysiwyg-selection-layer";
        layer.dataset.rendererRoot = instance.root.id;
        if (!layer.isConnected) document.body.appendChild(layer);
        instance.selectionLayer = layer;

        const walker = document.createTreeWalker(pages, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            if (node.data.length > 0 && range.intersectsNode(node)) {
                const textRange = document.createRange();
                const start = node === range.startContainer ? range.startOffset : 0;
                const end = node === range.endContainer ? range.endOffset : node.data.length;
                if (start < end) {
                    textRange.setStart(node, start);
                    textRange.setEnd(node, end);
                    const bounds = selectionClipBounds(instance, node);
                    if (!bounds) {
                        node = walker.nextNode();
                        continue;
                    }
                    for (const rect of textRange.getClientRects?.() ?? []) {
                        if (rect.width <= 0 || rect.height <= 0) continue;
                        const clipped = clipSelectionRect(rect, bounds);
                        if (!clipped) continue;
                        const highlight = document.createElement("span");
                        highlight.className = "wysiwyg-selection-rect";
                        highlight.style.left = `${clipped.left}px`;
                        highlight.style.top = `${clipped.top}px`;
                        highlight.style.width = `${clipped.width}px`;
                        highlight.style.height = `${clipped.height}px`;
                        layer.appendChild(highlight);
                    }
                }
            }
            node = walker.nextNode();
        }
    }

    function scheduleSelectionHighlight(instance) {
        if (instance.selectionFrame !== null) window.cancelAnimationFrame(instance.selectionFrame);
        instance.selectionFrame = requestAnimationFrame(() => paintTextSelection(instance));
    }

    function bindSelectionHighlight(instance) {
        if (instance.selectionChangeHandler) return;
        instance.selectionChangeHandler = () => {
            normalizeStructuralCaret(instance);
            editorRange(instance);
            scheduleSelectionHighlight(instance);
        };
        instance.selectionViewportHandler = () => scheduleSelectionHighlight(instance);
        document.addEventListener("selectionchange", instance.selectionChangeHandler);
        window.addEventListener("resize", instance.selectionViewportHandler);
        window.addEventListener("scroll", instance.selectionViewportHandler, true);
    }

    function command(rootId, name) {
        const instance = instances.get(rootId);
        if (!instance?.editable) return { ok: false, error: "编辑器当前不可编辑" };

        if (name === "undo" || name === "redo") {
            const historyCommand = window.InfiniteMarkdownEditor?.[name];
            if (!historyCommand) return { ok: false, error: "Markdown 历史控制器尚未就绪" };
            const changed = historyCommand();
            const result = {
                ok: true,
                changed,
                revision: window.InfiniteMarkdownEditor?.getRevision?.(),
            };
            markPendingRender(instance, result, RENDER_CANONICAL);
            return result;
        }

        if (name === "page_break") {
            const selectedIds = new Set(selectedBlockIds(instance));
            const group = markdownGroups(instance.root).find((item) => selectedIds.has(item.id));
            if (!group || !Number.isFinite(group.to) || !window.InfiniteMarkdownEditor?.applyChange) {
                return { ok: false, error: "无法确定分页符的 Markdown 插入位置" };
            }
            const result = window.InfiniteMarkdownEditor.applyChange(
                group.to,
                group.to,
                `\n\n${PAGE_BREAK_MARKER}\n\n`,
                "wysiwyg-command",
                "input",
                true,
            );
            markPendingRender(instance, result, RENDER_CANONICAL);
            return result;
        }

        if (name === "unordered_list" || name === "ordered_list") {
            const result = applyListCommand(instance, name === "ordered_list");
            markPendingRender(instance, result, RENDER_CANONICAL);
            return result;
        }

        if (name === "horizontal_rule") {
            instance.pendingBlockIds = selectedBlockIds(instance);
            if (!insertHorizontalRule(instance)) {
                return { ok: false, changed: false, error: "无法确定分割线插入位置" };
            }
            instance.pendingSelection = captureSelection(instance);
            const result = dispatchAffectedMarkdown(
                instance,
                "wysiwyg-command",
                "input",
                true,
            );
            markPendingRender(instance, result, RENDER_REFLOW);
            return result;
        }

        const nativeCommands = {
            bold: ["bold", null],
            italic: ["italic", null],
            strike: ["strikeThrough", null],
            paragraph: ["formatBlock", "p"],
            heading1: ["formatBlock", "h1"],
            heading2: ["formatBlock", "h2"],
            heading3: ["formatBlock", "h3"],
            quote: ["formatBlock", "blockquote"],
            code_block: ["formatBlock", "pre"],
            unordered_list: ["insertUnorderedList", null],
            ordered_list: ["insertOrderedList", null],
            horizontal_rule: ["insertHorizontalRule", null],
        };
        const selected = nativeCommands[name];
        if (!selected) return { ok: false, error: `未知编辑命令：${name}` };

        instance.pendingBlockIds = selectedBlockIds(instance);
        if (name === "bold") {
            applyMarkCommand(instance, "strong", "bold");
        } else if (name === "italic") {
            applyMarkCommand(instance, "em", "italic");
        } else if (name === "strike") {
            applyMarkCommand(instance, "del", "strikeThrough");
        } else {
            if (!document.execCommand) return { ok: false, error: "浏览器不支持该编辑命令" };
            document.execCommand(selected[0], false, selected[1]);
        }
        for (const content of instance.root.querySelectorAll(".document-page-content")) {
            normalizeFormatting(content);
        }
        instance.pendingSelection = captureSelection(instance);
        const result = dispatchAffectedMarkdown(
            instance,
            "wysiwyg-command",
            "input",
            true,
        );
        markPendingRender(instance, result, RENDER_CANONICAL);
        return result ?? { ok: false, error: "格式命令未生成 Markdown transaction" };
    }

    function mount(
        rootId,
        seamless,
        resources = {},
        editable = false,
        bridgeId = null,
        markdown = null,
        documentRevision = 0,
        contentRevision = 0,
        renderRequestRevision = 0,
    ) {
        const root = document.getElementById(rootId);
        if (!root) return { ok: false, error: `找不到文档渲染器：${rootId}` };

        if (editable && markdown !== null && !window.InfiniteMarkdownEditor) {
            pendingEditorMounts.set(rootId, [
                rootId,
                seamless,
                resources,
                editable,
                bridgeId,
                markdown,
                documentRevision,
                contentRevision,
                renderRequestRevision,
            ]);
            if (!waitingForMarkdownEditor) {
                waitingForMarkdownEditor = true;
                window.addEventListener("infinite-markdown-editor-ready", () => {
                    waitingForMarkdownEditor = false;
                    const pending = [...pendingEditorMounts.values()];
                    pendingEditorMounts.clear();
                    for (const arguments_ of pending) mount(...arguments_);
                }, { once: true });
            }
            return { ok: true, pending: true };
        }

        let instance = instances.get(rootId);
        if (
            instance
            && (
                documentRevision < instance.acceptedDocumentRevision
                || renderRequestRevision < instance.acceptedRenderRequest
            )
        ) {
            restorePageBackup(instance);
            return { ok: true, stale: true };
        }

        let authoritativeContentRevision = contentRevision;
        if (editable && markdown !== null && window.InfiniteMarkdownEditor) {
            const initialized = window.InfiniteMarkdownEditor.initialize(
                markdown,
                documentRevision,
                bridgeId,
                contentRevision,
            );
            const snapshot = window.InfiniteMarkdownEditor.getSnapshot?.();
            if (
                initialized?.staleDocument
                || !snapshot
                || snapshot.documentRevision !== documentRevision
                || snapshot.markdown !== markdown
            ) {
                restorePageBackup(instance);
                return { ok: true, stale: true };
            }
            // Layout updates can arrive before Rust has processed the latest
            // WYSIWYG bridge revision. When the Markdown is identical, the
            // browser controller's newer revision is authoritative.
            authoritativeContentRevision = snapshot.editRevision;
        }

        if (!instance || instance.root !== root) {
            instance?.observer.disconnect();
            if (instance?.keydownHandler) {
                window.removeEventListener("keydown", instance.keydownHandler, true);
            }
            instance = {
                root,
                seamless,
                resources,
                editable,
                bridgeId,
                generation: 0,
                observer: null,
                pendingSelection: null,
                lastEditorRange: null,
                pendingBlockIds: [],
                pendingGroupRanges: new Map(),
                pendingCombinedInput: null,
                pendingInputType: null,
                pendingEmptyQuoteBreak: false,
                documentRevision,
                composing: false,
                reconciling: false,
                hasEditorFocus: false,
                keydownHandler: null,
                selectionChangeHandler: null,
                selectionViewportHandler: null,
                selectionLayer: null,
                selectionFrame: null,
                pages: null,
                pageBackup: null,
                awaitingContentRevision: null,
                pendingRenderPolicy: RENDER_NONE,
                acceptedDocumentRevision: -1,
                acceptedContentRevision: -1,
                acceptedRenderRequest: -1,
                fallbackRevision: contentRevision,
                markdownLength: markdown?.length ?? 0,
                usesController: Boolean(window.InfiniteMarkdownEditor),
            };
            const source = root.querySelector(".document-pagination-source");
            instance.observer = new MutationObserver(() => {
                bindResourceReflow(instance);
                if (!instance.editable) schedule(instance);
            });
            if (source) instance.observer.observe(source, { childList: true, subtree: true });
            instances.set(rootId, instance);
        }

        const documentChanged = instance.acceptedDocumentRevision !== documentRevision;
        const isInitialRender = !root.querySelector("[data-document-pages]")?.childElementCount;
        let renderPolicy = RENDER_CANONICAL;
        if (
            !documentChanged
            && instance.awaitingContentRevision !== null
            && authoritativeContentRevision >= instance.awaitingContentRevision
        ) {
            renderPolicy = instance.pendingRenderPolicy;
            instance.awaitingContentRevision = null;
            instance.pendingRenderPolicy = RENDER_NONE;
        }

        instance.seamless = seamless;
        instance.resources = resources;
        instance.editable = editable;
        instance.bridgeId = bridgeId;
        instance.markdownLength = markdown?.length ?? instance.markdownLength;
        instance.usesController = Boolean(window.InfiniteMarkdownEditor);
        if (documentChanged) {
            instance.pendingSelection = null;
            instance.pendingBlockIds = [];
            instance.pendingGroupRanges = new Map();
            instance.pendingCombinedInput = null;
            instance.pendingInputType = null;
            instance.pendingEmptyQuoteBreak = false;
            instance.awaitingContentRevision = null;
            instance.pendingRenderPolicy = RENDER_NONE;
        }
        instance.documentRevision = documentRevision;
        instance.acceptedDocumentRevision = documentRevision;
        instance.acceptedContentRevision = authoritativeContentRevision;
        instance.acceptedRenderRequest = renderRequestRevision;
        bindEditing(instance);
        bindSelectionHighlight(instance);
        bindResourceReflow(instance);
        if (isInitialRender || renderPolicy === RENDER_CANONICAL) {
            schedule(instance, true);
        } else if (renderPolicy === RENDER_REFLOW) {
            if (layoutNeedsPagination(instance)) schedule(instance, true);
            else instance.pendingSelection = null;
        }
        return { ok: true, revision: authoritativeContentRevision, renderPolicy };
    }

    function destroy(rootId) {
        pendingEditorMounts.delete(rootId);
        const instance = instances.get(rootId);
        instance?.observer.disconnect();
        if (instance?.keydownHandler) {
            window.removeEventListener("keydown", instance.keydownHandler, true);
        }
        if (instance?.selectionChangeHandler) {
            document.removeEventListener("selectionchange", instance.selectionChangeHandler);
            window.removeEventListener("resize", instance.selectionViewportHandler);
            window.removeEventListener("scroll", instance.selectionViewportHandler, true);
        }
        if (instance && instance.selectionFrame !== null) {
            window.cancelAnimationFrame(instance.selectionFrame);
        }
        instance?.selectionLayer?.remove();
        instances.delete(rootId);
    }

    window.InfiniteDocumentRenderer = { mount, paginate, serializeMarkdown, command, destroy };
    window.dispatchEvent(new CustomEvent("infinite-document-renderer-ready"));
})();
