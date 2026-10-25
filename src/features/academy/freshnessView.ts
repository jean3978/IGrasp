// What the reader shows of the local freshness check: the status of each cited range (by its
// `path:lines` label, as the steps' source lines show them) and the mark of each chapter on the
// course map.

import type { Badge, FreshnessReport } from '../../ipc/types';
import type { SourceStatus } from './steps/stepUtils';

const labelOf = (path: string, lines: string | null) => (lines ? `${path}:${lines}` : path);

/** `path:lines` → changed or missing, for the steps' notices. */
export function sourceStatusMap(report: FreshnessReport | null): Record<string, SourceStatus> {
  const out: Record<string, SourceStatus> = {};
  for (const c of report?.checks ?? [])
    if (c.state === 'changed' || c.state === 'missing') out[labelOf(c.path, c.lines)] = c.state;
  return out;
}

/** Chapter index → its mark on the map: missing wins over changed. */
export function affectedChapters(
  report: FreshnessReport | null,
): Map<number, 'changed' | 'missing'> {
  const out = new Map<number, 'changed' | 'missing'>();
  if (!report) return out;
  const mark = report.badge.badge === 'sourcesMissing' ? 'missing' : 'changed';
  for (const s of report.affected) {
    if (out.get(s.chapter) !== 'missing') out.set(s.chapter, mark);
  }
  return out;
}

export function badgeLabel(badge: Badge): string {
  switch (badge.badge) {
    case 'upToDate':
      return 'Up to date';
    case 'maybeOutdated':
      return `Maybe outdated (${String(badge.changed)} of ${String(badge.of)} sources changed)`;
    case 'sourcesMissing':
      return `Sources missing (${String(badge.missing)} of ${String(badge.of)})`;
  }
}

export const badgeShort = (badge: Badge) =>
  badge.badge === 'upToDate'
    ? 'up to date'
    : badge.badge === 'maybeOutdated'
      ? 'maybe outdated'
      : 'sources missing';
