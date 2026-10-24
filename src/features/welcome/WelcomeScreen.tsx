import { useEffect, useState } from 'react';
import { AlertCircle, Folder, FolderOpen, FolderX, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { backend } from '../../ipc/client';
import { useRecent } from '../../stores/recent';
import { useWorkspace } from '../../stores/workspace';
import { AppLogo } from '../splash/AppLogo';
import { runAction } from '../titlebar/menuActions';
import './welcome.css';

function RecentFolders() {
  const folders = useRecent((s) => s.folders);
  const remove = useRecent((s) => s.remove);
  const clear = useRecent((s) => s.clear);
  const openRoot = useWorkspace((s) => s.openRoot);

  if (folders.length === 0) {
    return <p className="welcome-empty">Folders you open will appear here.</p>;
  }

  return (
    <>
      <ul className="recent-list">
        {folders.map((f) => (
          <li key={f.path} className="recent-item" data-missing={f.exists ? undefined : ''}>
            <button
              type="button"
              className="recent-open"
              disabled={!f.exists}
              onClick={() => void openRoot(f.path)}
              title={f.exists ? f.path : `${f.path} (not found)`}
            >
              {f.exists ? <Folder aria-hidden /> : <FolderX aria-hidden />}
              <span className="recent-name">{f.name}</span>
              <span className="recent-path">{f.path}</span>
              {!f.exists && <span className="recent-missing">Not found</span>}
            </button>
            <IconButton
              label={`Remove ${f.name} from recent folders`}
              className="recent-remove"
              onClick={() => void remove(f.path)}
            >
              <X aria-hidden />
            </IconButton>
          </li>
        ))}
      </ul>
      <Button variant="ghost" className="recent-clear" onClick={() => void clear()}>
        Clear recent folders
      </Button>
    </>
  );
}

export function WelcomeScreen() {
  const refresh = useRecent((s) => s.refresh);
  const openError = useWorkspace((s) => s.openError);
  const opening = useWorkspace((s) => s.opening);
  const [version, setVersion] = useState('');

  useEffect(() => {
    void refresh();
    void backend.getAppInfo().then((info) => {
      setVersion(info.version);
    });
  }, [refresh]);

  return (
    <main className="welcome" id="main-content">
      <div className="welcome-inner">
        <header className="welcome-header">
          <AppLogo className="welcome-logo" />
          <div>
            <h1 className="welcome-title">IGrasp</h1>
            <p className="welcome-tagline">Grasp what your project&apos;s documentation says.</p>
          </div>
        </header>

        <section className="welcome-section" aria-labelledby="welcome-start">
          <h2 id="welcome-start">Start</h2>
          <Button
            variant="primary"
            disabled={opening}
            onClick={() => {
              runAction('file.openFolder');
            }}
          >
            <FolderOpen aria-hidden />
            Open Folder…
            <kbd className="welcome-kbd">Ctrl+O</kbd>
          </Button>
          {openError && (
            <p className="welcome-error" role="alert">
              <AlertCircle aria-hidden />
              {openError}
            </p>
          )}
        </section>

        <section className="welcome-section" aria-labelledby="welcome-recent">
          <h2 id="welcome-recent">Open Recent</h2>
          <RecentFolders />
        </section>

        <footer className="welcome-footer">
          <span>Press F1 for keyboard shortcuts.</span>
          {version && <span>Version {version}</span>}
        </footer>
      </div>
    </main>
  );
}
