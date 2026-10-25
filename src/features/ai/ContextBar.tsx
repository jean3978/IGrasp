// What the next message carries: the provider's instruction files from the root down to the
// current file's folder, then the current file, with their sizes (from `ai_context`, metadata
// only). ✕ drops a document for the messages sent from this file; a click opens it. The
// selection attached to the next message is recalled at the top of the chat (`SelectionLine`).

import { clsx } from 'clsx';
import { Plus, X } from 'lucide-react';
import { formatSize } from '../code/codeLines';
import type { AiContextDocument } from '../../ipc/types';
import { useAiPanel } from '../../stores/aiPanel';
import { selectProviderName, useAiProvider } from '../../stores/aiProvider';
import { useTabs } from '../../stores/tabs';

const baseName = (path: string) => path.split('/').pop() ?? path;
const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

function open(path: string) {
  if (isMarkdown(path)) useTabs.getState().openDocument(path);
  else useTabs.getState().openCode(path);
}

function DocumentChip({ doc, removed }: { doc: AiContextDocument; removed: boolean }) {
  const removeContext = useAiPanel((s) => s.removeContext);
  const restoreContext = useAiPanel((s) => s.restoreContext);
  const providerName = useAiProvider(selectProviderName);
  const name = baseName(doc.path);
  const role = doc.role === 'currentFile' ? 'current file' : 'instructions';
  const note = doc.truncated ? `, too large to include: ${providerName} is asked to read it` : '';
  return (
    <li
      className={clsx('ai-context-chip', {
        'ai-context-removed': removed,
        'ai-context-current': doc.role === 'currentFile',
      })}
    >
      <button
        type="button"
        className="ai-context-name"
        title={`${doc.path} (${role}, ${formatSize(doc.bytes)}${note}) · click to open`}
        onClick={() => {
          open(doc.path);
        }}
      >
        {name}
        <span className="ai-context-size">
          {formatSize(doc.bytes)}
          {doc.truncated ? ' · by path' : ''}
        </span>
      </button>
      {removed ? (
        <button
          type="button"
          className="ai-context-toggle"
          aria-label={`Add ${doc.path} back to the next message`}
          title="Add it back"
          onClick={() => {
            restoreContext(doc.path);
          }}
        >
          <Plus aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          className="ai-context-toggle"
          aria-label={`Remove ${doc.path} from the next message`}
          title="Leave it out of the next message"
          onClick={() => {
            removeContext(doc.path);
          }}
        >
          <X aria-hidden />
        </button>
      )}
    </li>
  );
}

export function ContextBar() {
  const context = useAiPanel((s) => s.context);
  if (!context) return null;
  const { documents, removed } = context;
  const kept = documents.filter((d) => !removed.includes(d.path));
  const bytes = kept.reduce((n, d) => n + d.bytes, 0);
  return (
    <div className="ai-context" role="group" aria-label="Context of the next message">
      <span className="ai-context-label">
        Context{kept.length > 0 ? ` · ${formatSize(bytes)}` : ''}
      </span>
      <ul className="ai-context-list">
        {documents.map((doc) => (
          <DocumentChip key={doc.path} doc={doc} removed={removed.includes(doc.path)} />
        ))}
        {documents.length === 0 && (
          <li className="ai-context-empty">
            {context.error ?? 'Only your message (no file open).'}
          </li>
        )}
      </ul>
    </div>
  );
}
