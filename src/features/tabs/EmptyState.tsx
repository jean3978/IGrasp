import { AppLogo } from '../splash/AppLogo';

const KEYS: [string, string][] = [
  ['Open a file', 'Click it in the Explorer'],
  ['Open folder', 'Ctrl+O'],
  ['Toggle sidebar', 'Ctrl+B'],
  ['Keyboard shortcuts', 'F1'],
];

export function EmptyState() {
  return (
    <div className="empty-state">
      <AppLogo variant="mono" className="empty-state-logo" />
      <dl className="empty-state-keys">
        {KEYS.map(([label, key]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt>{label}</dt>
            <dd>{key.startsWith('Click') ? key : <kbd>{key}</kbd>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
