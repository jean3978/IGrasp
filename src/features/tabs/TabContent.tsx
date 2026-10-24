import { selectActiveTab, useTabs } from '../../stores/tabs';
import { DocumentTab } from '../preview/DocumentTab';
import { EmptyState } from './EmptyState';
import { panelDomId, tabDomId } from './tabIds';

export function TabContent() {
  const tab = useTabs(selectActiveTab);

  if (!tab) return <EmptyState />;

  return (
    <div
      className="tab-content"
      role="tabpanel"
      id={panelDomId(tab.id)}
      aria-labelledby={tabDomId(tab.id)}
    >
      {tab.kind === 'document' && tab.relPath !== null && (
        <DocumentTab key={tab.id} tabId={tab.id} relPath={tab.relPath} />
      )}
      {tab.kind === 'settings' && <p className="placeholder">Settings arrive in a later step.</p>}
      {tab.kind === 'shortcuts' && <p className="placeholder">Shortcuts arrive in a later step.</p>}
    </div>
  );
}
