import { actions } from '../titlebar/menuActions';
import type { ActionId } from '../titlebar/menuActions';
import { RESERVED_SHORTCUTS } from './keymap';
import './shortcuts.css';

interface Row {
  keys: string;
  label: string;
}

const fromActions = (ids: ActionId[]): Row[] =>
  ids.map((id) => ({ keys: actions[id].shortcut ?? '', label: actions[id].label }));

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'General',
    rows: [
      ...fromActions(['file.openFolder', 'file.settings', 'help.shortcuts']),
      { keys: 'Alt+F / E / V / H', label: 'Open the File, Edit, View or Help menu' },
      { keys: 'F10 or Alt', label: 'Focus the menu bar' },
      { keys: 'Esc', label: 'Close menus, dialogs and full-screen views' },
    ],
  },
  {
    title: 'View',
    rows: fromActions([
      'view.toggleSidebar',
      'view.focusExplorer',
      'view.zoomIn',
      'view.zoomOut',
      'view.zoomReset',
    ]),
  },
  {
    title: 'Tabs',
    rows: [
      ...fromActions(['tabs.close', 'tabs.next', 'tabs.previous']),
      { keys: 'Ctrl+PageDown / PageUp', label: 'Next / previous tab' },
      { keys: 'Alt+1 … Alt+8', label: 'Go to tab 1 … 8' },
      ...fromActions(['tabs.goto9', 'tabs.moveLeft', 'tabs.moveRight']),
      { keys: '← / →, Enter', label: 'Move between tabs and open one (tab bar focused)' },
      { keys: 'Delete', label: 'Close the focused tab (tab bar focused)' },
    ],
  },
  {
    title: 'Explorer (tree focused)',
    rows: [
      { keys: '↑ / ↓', label: 'Previous / next item' },
      { keys: 'Home / End', label: 'First / last item' },
      { keys: '→', label: 'Expand a folder, or go to its first item' },
      { keys: '←', label: 'Collapse a folder, or go to its parent' },
      { keys: 'Enter', label: 'Open the file (kept open) or toggle the folder' },
      { keys: 'Space', label: 'Preview the file or toggle the folder' },
      { keys: '*', label: 'Expand all sibling folders' },
      { keys: 'Letters', label: 'Jump to the next item starting with the typed text' },
    ],
  },
  {
    title: 'Mermaid diagrams (diagram focused)',
    rows: [
      { keys: '+ / -', label: 'Zoom in / out' },
      { keys: 'F', label: 'Fit to view' },
      { keys: '0', label: 'Reset to 1:1' },
      { keys: 'Enter', label: 'Full screen' },
      { keys: 'Ctrl+wheel', label: 'Zoom with the mouse' },
    ],
  },
];

function Keys({ keys }: { keys: string }) {
  return (
    <span className="shortcut-keys">
      {keys.split(/(\s+\/\s+|\s+…\s+|,\s+|\s+or\s+)/).map((part, i) =>
        /^\s*(\/|…|,|or)\s*$/.test(part) ? (
          <span key={i} className="shortcut-sep">
            {part}
          </span>
        ) : (
          <kbd key={i}>{part}</kbd>
        ),
      )}
    </span>
  );
}

export function ShortcutsReferenceTab() {
  return (
    <div className="document-scroll" tabIndex={0} aria-label="Keyboard shortcuts">
      <div className="shortcuts">
        <h1>Keyboard Shortcuts</h1>
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            <table>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.label}>
                    <td>
                      <Keys keys={row.keys} />
                    </td>
                    <td>{row.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <p className="shortcuts-note">
          Reserved for upcoming features: {RESERVED_SHORTCUTS.join(', ')}.
        </p>
      </div>
    </div>
  );
}
