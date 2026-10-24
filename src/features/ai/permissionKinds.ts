// The five permission kinds as the user reads them (chat rules, settings rows).

import type { AiPermissionKind, AiPermissionSettings } from '../../ipc/types';

export const KIND_LABEL: Record<AiPermissionKind, string> = {
  markdownEdit: 'markdown edit',
  fileEdit: 'other file edit',
  command: 'command',
  web: 'web access',
  other: 'other',
};

/** One row of Settings → AI → Permissions. */
export interface PermissionCategory {
  key: keyof AiPermissionSettings;
  label: string;
  /** One sentence; `{provider}` is replaced by the provider's display name. */
  description: string;
  /** Allow is risky: a warning is shown next to it. */
  risky: boolean;
}

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    key: 'markdownEdits',
    label: 'Markdown edits',
    description:
      'When {provider} wants to change or create a markdown file in this folder. Ask shows the proposed change to accept or reject.',
    risky: false,
  },
  {
    key: 'fileEdits',
    label: 'Other file edits',
    description:
      'When {provider} wants to change or create any other file in this folder (code, configuration, …).',
    risky: true,
  },
  {
    key: 'commands',
    label: 'Commands',
    description: 'When {provider} wants to run a command or a script on this computer.',
    risky: true,
  },
  {
    key: 'web',
    label: 'Web access',
    description: 'When {provider} wants to fetch a web page or search the web.',
    risky: true,
  },
  {
    key: 'other',
    label: 'Anything else',
    description:
      'Reading outside this folder, or a tool {provider} does not classify. Reading inside the folder never asks.',
    risky: true,
  },
];
