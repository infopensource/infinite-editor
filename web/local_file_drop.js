export function handleLocalFileDrop(event, fallbackText = "") {
  const transfer = event.dataTransfer;
  if (!transfer) return false;

  const text = transfer.getData("text/uri-list") || transfer.getData("text/plain") || fallbackText;
  const urls = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  const localUrls = urls.length > 0 && urls.every(value => {
    try { return new URL(value).protocol === "file:"; }
    catch { return false; }
  });
  if (localUrls) {
    const bridge = globalThis.document?.getElementById("desktop-file-drop-bridge");
    if (bridge) {
      event.stopPropagation();
      bridge.value = JSON.stringify(urls);
      bridge.dispatchEvent(new bridge.ownerDocument.defaultView.Event("input", { bubbles: true }));
    }
    return true;
  }
  return Boolean(transfer.files?.length || Array.from(transfer.types ?? []).includes("Files"));
}
