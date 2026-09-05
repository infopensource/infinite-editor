export function normalizeResourcePath(value) {
  const path = String(value ?? "");
  if (!path || /^(?:[a-z]+:|\/\/|#)/iu.test(path)) return null;
  const withoutSuffix = path.split(/[?#]/u, 1)[0];
  try {
    return decodeURIComponent(withoutSuffix).replace(/^\.\//u, "").replaceAll("\\", "/");
  } catch (_) {
    return withoutSuffix.replace(/^\.\//u, "").replaceAll("\\", "/");
  }
}

export function resolveResource(resources, path) {
  const key = normalizeResourcePath(path);
  return (key && resources?.[key]) || path;
}
