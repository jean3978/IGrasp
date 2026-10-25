// Text of the usage line and of the confirmation card (pure, shared by the chat, the quiz and
// the tutorials).

import type { AiSizeEstimate } from '../../ipc/types';
import { formatSize } from '../code/codeLines';

export interface UsageValues {
  inputTokens: number;
  outputTokens: number;
  /** Null when the provider reports no cost. */
  costUsd: number | null;
  /** Omitted or 0 when unknown. */
  durationMs?: number;
}

/** `1200` -> `1 200` (no-break space), so a count never wraps in the middle. */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(usd >= 0.01 ? 2 : 3)}`;
}

/** "1 200 in · 80 out · $0.003 · 4.2 s"; the cost only when reported. */
export function usageText({ inputTokens, outputTokens, costUsd, durationMs }: UsageValues): string {
  const parts = [`${formatCount(inputTokens)} in`, `${formatCount(outputTokens)} out`];
  if (costUsd !== null && costUsd > 0) parts.push(formatCost(costUsd));
  if (durationMs !== undefined && durationMs > 0) parts.push(`${(durationMs / 1000).toFixed(1)} s`);
  return parts.join(' · ');
}

export const BUCKET_LABEL: Record<AiSizeEstimate['bucket'], string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/** "Acme AI (sonnet) will read 3 documents (14 KB) and 1 image." */
export function confirmSummary(input: {
  provider: string;
  model: string;
  documents: { bytes: number }[];
  images: number;
}): string {
  const { provider, model, documents, images } = input;
  const who = model ? `${provider} (${model})` : provider;
  const reads: string[] = [];
  if (documents.length > 0) {
    const bytes = documents.reduce((n, d) => n + d.bytes, 0);
    reads.push(`${plural(documents.length, 'document')} (${formatSize(bytes)})`);
  }
  if (images > 0) reads.push(plural(images, 'image'));
  return reads.length === 0
    ? `${who} will receive your message.`
    : `${who} will read ${reads.join(' and ')}.`;
}
