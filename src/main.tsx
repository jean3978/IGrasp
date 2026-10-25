import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/themes/light.css';
import './styles/themes/dark.css';
import './styles/themes/high-contrast.css';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');
const root = createRoot(container);

// Browser dev mode only: `/?diff=<fixture>&theme=<theme>` shows a rendered diff for a visual check.
const params = new URLSearchParams(window.location.search);
const diffFixture = import.meta.env.DEV ? params.get('diff') : null;

if (diffFixture) {
  document.documentElement.dataset['theme'] = params.get('theme') ?? 'light';
  void import('./features/diff/DiffPlayground').then(({ DiffPlayground }) => {
    root.render(
      <StrictMode>
        <DiffPlayground name={diffFixture} />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
