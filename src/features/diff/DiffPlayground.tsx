// Visual check page of the rendered diff, browser dev mode only: `/?diff=paragraph-edit` renders
// src/test/fixtures/diff/paragraph-edit.{old,new}.md, `&theme=dark|light|high-contrast` picks the
// theme. Not part of the production build (main.tsx imports it behind import.meta.env.DEV).

import { useState } from 'react';
import { RenderedDiff } from './RenderedDiff';
import type { ChangeState } from './RenderedDiff';

const fixtures = import.meta.glob<string>('../../test/fixtures/diff/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const read = (name: string, side: 'old' | 'new'): string | undefined =>
  Object.entries(fixtures).find(([path]) => path.endsWith(`/${name}.${side}.md`))?.[1];

export function DiffPlayground({ name }: { name: string }) {
  const [states, setStates] = useState<ChangeState[]>([]);
  const oldText = read(name, 'old');
  const newText = read(name, 'new');
  if (oldText === undefined || newText === undefined) return <p>No fixture pair named {name}.</p>;
  const set = (index: number, state: ChangeState) => {
    setStates((prev) => {
      const next = [...prev];
      next[index] = state;
      return next;
    });
  };
  return (
    <div style={{ background: 'var(--bg-editor)', color: 'var(--fg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: 24 }}>
        <RenderedDiff
          oldText={oldText}
          newText={newText}
          states={states}
          renderToolbar={({ index, state }) => (
            <span role="toolbar" aria-label="Change controls">
              <button
                type="button"
                onClick={() => {
                  set(index, 'accepted');
                }}
              >
                Accept
              </button>{' '}
              <button
                type="button"
                onClick={() => {
                  set(index, 'rejected');
                }}
              >
                Reject
              </button>{' '}
              <span>{state}</span>
            </span>
          )}
        />
      </div>
    </div>
  );
}
