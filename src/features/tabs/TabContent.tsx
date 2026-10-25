import { selectActiveTab, useTabs } from '../../stores/tabs';
import { ViewportToolbar } from '../ai/ViewportToolbar';
import { CodeTab } from '../code/CodeTab';
import { DocumentTab } from '../preview/DocumentTab';
import { SettingsTab } from '../settings/SettingsTab';
import { ShortcutsReferenceTab } from '../shortcuts/ShortcutsReferenceTab';
import { EmptyState } from './EmptyState';
import { panelDomId, tabDomId } from './tabIds';

export function TabContent() {
  const tab = useTabs(selectActiveTab);

  // The AI tools are over every view of an open folder, so the chat always has its button (the
  // selection tools are disabled where there is nothing to select).
  if (!tab) {
    return (
      <div className="tab-content">
        <EmptyState />
        <ViewportToolbar />
      </div>
    );
  }

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
      {tab.kind === 'code' && tab.relPath !== null && (
        <CodeTab key={tab.id} tabId={tab.id} relPath={tab.relPath} />
      )}
      {tab.kind === 'settings' && <SettingsTab />}
      {tab.kind === 'shortcuts' && <ShortcutsReferenceTab />}
      <ViewportToolbar />
    </div>
  );
}
