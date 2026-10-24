import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { describe, expect, it, vi } from 'vitest';
import { MermaidBlock } from './MermaidBlock';
import { mermaidConfig } from './mermaidRuntime';
import type * as runtime from './mermaidRuntime';

vi.mock('./mermaidRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof runtime>();
  return {
    ...actual,
    cachedMermaid: () => undefined,
    renderMermaid: (source: string) =>
      Promise.resolve(
        source.includes('oops')
          ? { kind: 'error', message: 'Parse error on line 1' }
          : { kind: 'svg', svg: '<svg data-testid="diagram" viewBox="0 0 10 10"></svg>' },
      ),
  };
});

const show = (source: string) =>
  render(
    <Tooltip.Provider>
      <MermaidBlock source={source} />
    </Tooltip.Provider>,
  );

describe('MermaidBlock', () => {
  it('renders the diagram with its tools', async () => {
    show('graph TD; A-->B');
    expect(await screen.findByTestId('diagram')).toBeInTheDocument();
    for (const name of ['Zoom in', 'Zoom out', 'Fit to view', 'Reset view', 'Copy source']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('opens and closes the full-screen view', async () => {
    show('graph TD; A-->B');
    await userEvent.click(await screen.findByRole('button', { name: 'Full screen' }));
    expect(await screen.findByRole('dialog', { name: 'Mermaid diagram' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the error and the source of an invalid diagram', async () => {
    show('graph oops');
    expect(await screen.findByText('Parse error on line 1')).toBeInTheDocument();
    expect(screen.getByText('graph oops')).toBeInTheDocument();
  });
});

describe('mermaidConfig', () => {
  it('always uses the strict security level', () => {
    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      const config = mermaidConfig(theme, 'sans-serif');
      expect(config.securityLevel).toBe('strict');
      expect(config.startOnLoad).toBe(false);
    }
    expect(mermaidConfig('dark', 'x').theme).toBe('redux-dark-color');
    expect(mermaidConfig('light', 'x').theme).toBe('redux-color');
    expect(mermaidConfig('high-contrast', 'x').theme).toBe('base');
  });
});
