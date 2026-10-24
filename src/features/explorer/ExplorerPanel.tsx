import { Eye, EyeOff, FolderMinus, ListFilter, RefreshCw } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';
import { useTree } from '../../stores/tree';
import { useWorkspace } from '../../stores/workspace';
import { FileTree } from './FileTree';
import './explorer.css';

interface ExplorerPanelProps {
  activePath: string | null;
  onOpen: (path: string, options: { pin: boolean }) => void;
}

function report(err: unknown) {
  console.error('Explorer action failed', err);
}

function ExplorerToolbar() {
  const root = useWorkspace((s) => s.root);
  const showDotfiles = useTree((s) => s.showDotfiles);
  const showIgnored = useTree((s) => s.showIgnored);
  const tree = useTree.getState;

  return (
    <div className="explorer-header">
      <h2 className="explorer-title" title={root?.path}>
        {root?.name}
      </h2>
      <div className="explorer-actions" role="toolbar" aria-label="Explorer actions">
        <IconButton
          label={showDotfiles ? 'Hide dotfiles' : 'Show dotfiles'}
          pressed={showDotfiles}
          onClick={() => {
            tree().setShowDotfiles(!showDotfiles).catch(report);
          }}
        >
          {showDotfiles ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
        </IconButton>
        <IconButton
          label={showIgnored ? 'Hide ignored files' : 'Show ignored files'}
          pressed={showIgnored}
          onClick={() => {
            tree().setShowIgnored(!showIgnored).catch(report);
          }}
        >
          <ListFilter aria-hidden />
        </IconButton>
        <IconButton
          label="Collapse folders"
          onClick={() => {
            tree().collapseAll();
          }}
        >
          <FolderMinus aria-hidden />
        </IconButton>
        <IconButton
          label="Refresh"
          onClick={() => {
            tree().refresh().catch(report);
          }}
        >
          <RefreshCw aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

function IndexStatusRow() {
  const index = useWorkspace((s) => s.index);
  const rootListing = useTree((s) => s.listings['']);

  if (index.state === 'scanning') {
    return (
      <div className="explorer-status" role="status">
        Indexing… {index.scannedEntries > 0 && `${index.scannedEntries.toLocaleString()} entries`}
      </div>
    );
  }
  if (index.state === 'error') {
    return (
      <div className="explorer-status explorer-status-error" role="alert">
        {index.message}
      </div>
    );
  }
  if (index.state === 'ready' && rootListing?.dirs.length === 0 && rootListing.files.length === 0) {
    return <div className="explorer-status">No markdown files in this folder.</div>;
  }
  return null;
}

export function ExplorerPanel({ activePath, onOpen }: ExplorerPanelProps) {
  return (
    <div className="explorer">
      <ExplorerToolbar />
      <IndexStatusRow />
      <FileTree activePath={activePath} onOpen={onOpen} />
    </div>
  );
}
