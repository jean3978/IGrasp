// Root-relative paths (`docs/guide/a.md`, `/` separators, no leading slash; "" is the root).

export function dirname(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i < 0 ? '' : relPath.slice(0, i);
}

/** Whether a link or media URL has a scheme (`https:`, `mailto:`, `data:` …). */
export function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/**
 * Resolves a relative link or media path found in `fromDoc` to a root-relative path.
 * A leading `/` is relative to the root. Query and fragment are dropped, percent-escapes are
 * decoded. Returns null for URLs with a scheme and for paths that climb above the root.
 */
export function resolveRelative(fromDoc: string, target: string): string | null {
  if (hasScheme(target) || target.startsWith('//')) return null;
  const clean = target.split(/[?#]/)[0] ?? '';
  if (clean === '') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }
  decoded = decoded.replace(/\\/g, '/');
  const base = decoded.startsWith('/') ? [] : dirname(fromDoc).split('/').filter(Boolean);
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (base.length === 0) return null;
      base.pop();
    } else {
      base.push(segment);
    }
  }
  return base.length === 0 ? null : base.join('/');
}

/** The fragment of a link (`#install` → `install`), decoded, or null. */
export function fragmentOf(href: string): string | null {
  const i = href.indexOf('#');
  if (i < 0 || i === href.length - 1) return null;
  try {
    return decodeURIComponent(href.slice(i + 1));
  } catch {
    return href.slice(i + 1);
  }
}

export function isMarkdownPath(relPath: string): boolean {
  return /.\.(md|markdown)$/i.test(relPath);
}

/** Joins the root's absolute path and a root-relative path with the root's separator. */
export function toAbsolute(rootPath: string, relPath: string): string {
  const sep = rootPath.includes('\\') ? '\\' : '/';
  const root = rootPath.endsWith(sep) ? rootPath.slice(0, -1) : rootPath;
  return relPath === '' ? root : `${root}${sep}${relPath.split('/').join(sep)}`;
}
