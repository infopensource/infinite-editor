(() => {
  window.__infiniteToolbarClipboardAbort?.abort();
  const abort = new AbortController();
  window.__infiniteToolbarClipboardAbort = abort;
  const activeEditor = () => document.querySelector('#infinite-prosemirror-host .ProseMirror')
    ?? document.querySelector('#markdown-editor-host .cm-content');

  window.InfiniteToolbarClipboard = {
    command(action) {
      if (action !== 'copy' && action !== 'cut') return false;
      const editor = activeEditor();
      if (!editor) return false;
      editor.focus();
      return document.execCommand(action);
    },
    insertText(text) {
      if (typeof text !== 'string') return false;
      const rich = document.querySelector('#infinite-prosemirror-host .ProseMirror');
      if (rich) return window.InfiniteWysiwygEditor?.insertText('infinite-prosemirror-host', text)?.ok === true;
      if (document.querySelector('#markdown-editor-host .cm-content')) {
        return window.InfiniteMarkdownEditor?.insertText('markdown-editor-host', text)?.ok === true;
      }
      return false;
    },
    pasteImage() {
      const source = window.InfiniteMarkdownEditor;
      if (!source?.requestClipboardImage) return false;
      return source.requestClipboardImage((path) => {
        if (!path) return;
        const rich = document.querySelector('#infinite-prosemirror-host .ProseMirror');
        if (rich) window.InfiniteWysiwygEditor?.insertImage('infinite-prosemirror-host', path);
        else source.insertText('markdown-editor-host', `![粘贴的图片](${path})`);
      });
    },
    async paste() {
      try {
        const text = await navigator.clipboard.readText();
        return this.insertText(text);
      } catch (_) {
        const editor = activeEditor();
        if (!editor) return false;
        editor.focus();
        return document.execCommand('paste');
      }
    },
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-clipboard-action]');
    if (!button) return;
    const action = button.dataset.clipboardAction;
    if (action === 'copy' || action === 'cut') {
      window.InfiniteToolbarClipboard.command(action);
    } else if (action === 'paste') {
      const native = document.getElementById('clipboard-paste-bridge')?.dataset.nativeClipboard === 'true';
      if (!native) window.InfiniteToolbarClipboard.paste();
    }
  }, { capture: true, signal: abort.signal });
})();
