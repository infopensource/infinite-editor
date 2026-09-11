(() => {
  window.__infiniteTitleBarAbort?.abort();
  const abort = new AbortController();
  window.__infiniteTitleBarAbort = abort;
  let query = '', index = -1;
  const panel = document.getElementById('title-search-panel');
  const trigger = document.getElementById('title-search');
  const setOpen = (open) => {
    if (!panel) return;
    panel.hidden = !open;

    trigger?.setAttribute('aria-expanded', String(open));
    if (open) { const input = document.getElementById('title-search'); input?.focus(); input?.select(); }
    else trigger?.blur();
  };
  const setReplaceOpen = (open) => {
    const section = document.getElementById('title-replace-section');
    if (section) section.hidden = !open;
    document.getElementById('title-replace-toggle')?.setAttribute('aria-expanded', String(open));
    if (open) document.getElementById('title-replace')?.focus();
  };
  document.addEventListener('focusin', e => {
    if (e.target.id === 'title-search' && panel) { panel.hidden = false; trigger?.setAttribute('aria-expanded', 'true'); }
  }, { signal: abort.signal });
  let feedbackTimer;
  const bar = document.querySelector('.title-bar');
  const observer = new MutationObserver(records => {
    if (!records.some(record => record.attributeName === 'data-save-status')) return;
    const feedback = document.getElementById('title-save-feedback');
    clearTimeout(feedbackTimer);
    if (feedback) {
      feedback.textContent = /^(已保存|已另存为)/.test(bar.dataset.saveStatus) && bar.dataset.dirty === 'false' ? '已保存' : '';
      feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 2500);
    }
  });
  if (bar) observer.observe(bar, { attributes: true, attributeFilter: ['data-save-status', 'data-dirty'] });
  const historyTimer = setInterval(() => {
    const state = window.InfiniteMarkdownEditor?.historyStatus();
    for (const action of ['undo', 'redo']) {
      const button = document.getElementById(`title-${action}`);
      if (button) button.disabled = !state?.[action];
    }
    if (!bar?.isConnected) abort.abort();
  }, 200);
  abort.signal.addEventListener('abort', () => { clearInterval(historyTimer); clearTimeout(feedbackTimer); observer.disconnect(); }, { once: true });
  const search = (step = 0) => {
    const input = document.getElementById('title-search');
    if (!input) return;
    if (query !== input.value) { query = input.value; index = -1; }
    const rich = document.getElementById('infinite-prosemirror-host');
    const api = rich ? window.InfiniteWysiwygEditor : window.InfiniteMarkdownEditor;
    const result = rich ? api?.search('infinite-prosemirror-host', query, (index < 0 ? 0 : index + step))
      : api?.search(query, (index < 0 ? 0 : index + step));
    index = result?.index ?? -1;
    const count = document.getElementById('title-search-count');
    if (count) count.textContent = !query ? '输入关键词查找' : result?.total ? `${index + 1} / ${result.total} 项匹配` : '未找到匹配';
    for (const id of ['title-search-prev', 'title-search-next', 'title-replace-one', 'title-replace-all']) { const button = document.getElementById(id); if (button) button.disabled = !result?.total; }
  };
  const replace = (all) => {
    const input = document.getElementById('title-search');
    const replacement = document.getElementById('title-replace')?.value ?? '';
    if (!input?.value) return;
    query = input.value;
    const rich = document.getElementById('infinite-prosemirror-host');
    const result = rich
      ? window.InfiniteWysiwygEditor?.replaceMatches('infinite-prosemirror-host', query, replacement, Math.max(0, index), all)
      : window.InfiniteMarkdownEditor?.replaceMatches(query, replacement, Math.max(0, index), all);
    search();
    const feedback = document.getElementById('title-replace-feedback');
    if (feedback) feedback.textContent = result?.deferred ? '请完成当前输入后再替换' : `已替换 ${result?.count ?? 0} 项`;
  };
  document.addEventListener('input', e => { if (e.target.id === 'title-search') search(); }, { signal: abort.signal });
  document.addEventListener('click', e => {
    if (e.target.closest('#title-replace-one')) replace(false);
    if (e.target.closest('#title-replace-all')) replace(true);
    if (e.target.closest('#title-replace-toggle')) setReplaceOpen(document.getElementById('title-replace-section')?.hidden);
    if (e.target.closest('#title-search-close')) setOpen(false);
    if (e.target.closest('#title-search-prev')) search(-1);
    if (e.target.closest('#title-search-next')) search(1);
  }, { signal: abort.signal });
  document.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && ['f', 'h', 's'].includes(e.key.toLowerCase())) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key.toLowerCase() === 's') document.getElementById('title-save')?.click();
      else { setOpen(true); if (e.key.toLowerCase() === 'h') setReplaceOpen(true); }
    } else if (e.target.id === 'title-search' || panel?.contains(e.target)) {
      if (e.key === 'Enter') { e.preventDefault(); if (e.target.id === 'title-replace') replace(false); else if (e.target.id === 'title-search') search(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    }
  }, { capture: true, signal: abort.signal });
})();
