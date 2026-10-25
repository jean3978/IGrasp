// One-click messages about the selection attached to the chat. Each one is a user action that
// sends a message (and spends tokens); the transcript shows its label, the model receives the
// instruction. Edits are proposed through the provider, so they go through the user's
// permission settings and the inline review like any other edit.

export interface QuickAction {
  id: string;
  label: string;
  prompt: string;
}

/**
 * The scope rule of every editing action. "The selection" is the highlighted text when there is
 * one (the source lines given are only where it sits), otherwise the selected lines.
 */
const AS_EDIT =
  'Scope: change only the selection. If highlighted text is given, the selection is exactly ' +
  'that text, even when it is part of a longer sentence, paragraph or list: the lines around ' +
  'it are context, not part of it. Propose one edit of the file that replaces exactly that ' +
  'passage as it appears in the source, and keep every other character of the file unchanged, ' +
  'including the rest of its paragraph, list, table or section.';

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'rewrite',
    label: 'Rewrite',
    prompt: `Rewrite the selection so it reads clearly, keeping its meaning. ${AS_EDIT}`,
  },
  {
    id: 'shorten',
    label: 'Shorten',
    prompt: `Shorten the selection, keeping what matters. ${AS_EDIT}`,
  },
  {
    id: 'expand',
    label: 'Expand',
    prompt: `Expand the selection with the details a developer reading it would need, grounded in this project's files. ${AS_EDIT}`,
  },
  {
    id: 'grammar',
    label: 'Fix grammar',
    prompt: `Fix the grammar, spelling and punctuation of the selection without changing its meaning or tone. ${AS_EDIT}`,
  },
  {
    id: 'table',
    label: 'Make a table',
    prompt: `Turn the selection into a markdown table. ${AS_EDIT}`,
  },
  {
    id: 'diagram',
    label: 'Make a diagram',
    prompt:
      'Draw what the selection describes as a Mermaid diagram (a ```mermaid code block). ' +
      'Propose one edit of the file that only inserts the diagram after the block holding the ' +
      'selection, and keep every existing character of the file unchanged.',
  },
  {
    id: 'explain',
    label: 'Explain',
    prompt:
      'Explain the selection: what it means and how it fits in this project, citing the files ' +
      'it relates to. Answer in the chat; do not edit any file.',
  },
];
