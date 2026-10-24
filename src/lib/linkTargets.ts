// What a link points to, decided from its text alone. Same rules as Rust `graph::links::classify`
// (the graph then refines `file` into document / folder / file with a status).

import type { LinkTarget } from '../ipc/types';

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

export function classifyHref(fromDoc: string, rawHref: string | undefined): LinkTarget {
  const href = (rawHref ?? '').trim();
  if (href === '' || href === '#') return { kind: 'unsupported' };
  if (href.startsWith('#')) return { kind: 'anchor', fragment: decode(href.slice(1)) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
    return /^(https?|mailto):/i.test(href)
      ? { kind: 'external', url: href }
      : { kind: 'unsupported' };
  }
  const hash = href.indexOf('#');
  const rest = hash < 0 ? href : href.slice(0, hash);
  const fragment = hash < 0 || hash === href.length - 1 ? null : decode(href.slice(hash + 1));
  const path = rest.split('?')[0] ?? '';
  if (path === '') return fragment ? { kind: 'anchor', fragment } : { kind: 'unsupported' };
  const decoded = decode(path).replace(/\\/g, '/');
  const parts = decoded.startsWith('/') ? [] : parentOf(fromDoc).split('/').filter(Boolean);
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return { kind: 'outside' };
      parts.pop();
    } else parts.push(segment);
  }
  return { kind: 'file', relPath: parts.join('/'), fragment };
}

/** Media a document may open with the system player or viewer (Rust `EXTERNAL_MEDIA`). */
const MEDIA = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|mp3|wav|flac|m4a|png|jpe?g|gif|webp|svg)$/i;

export const isMediaPath = (relPath: string) => MEDIA.test(relPath);
