import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import { useTextFiles } from '../stores/textFiles';
import { useWorkspace } from '../stores/workspace';
import { CodeView } from './CodeView';

beforeEach(async () => {
  window.__igraspMock?.reset();
  useTextFiles.getState().clear();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

describe('CodeView', () => {
  it('shows a file with its line numbers and a highlighted range', async () => {
    render(<CodeView path="src/main.ts" highlight={{ first: 9, last: 12 }} />);
    const view = await screen.findByRole('region', { name: 'src/main.ts, read-only' });
    await waitFor(() => {
      expect(view).toHaveTextContent('export function main');
    });
    const range = view.querySelectorAll('.code-view-range');
    expect([...range].map((l) => l.getAttribute('data-line'))).toEqual(['9', '10', '11', '12']);
    expect(view.querySelector('.code-view-range-start')?.getAttribute('data-line')).toBe('9');
  });

  it('shows only a snippet, with the file numbers, and lets a line be picked', async () => {
    const pick = vi.fn();
    render(
      <CodeView
        path="src/main.ts"
        window={{ first: 9, last: 12 }}
        onLineClick={pick}
        cursorLine={10}
        marks={{ 11: 'right' }}
        label="Snippet"
      />,
    );
    const view = await screen.findByRole('region', { name: 'Snippet' });
    await waitFor(() => {
      expect(within(view).getAllByRole('button')).toHaveLength(4);
    });
    const lines = within(view).getAllByRole('button');
    expect(lines[0]).toHaveAccessibleName(/^Line 9: export function main/);
    expect(lines[1]).toHaveAttribute('aria-current', 'true');
    expect(lines[2]).toHaveAttribute('data-mark', 'right');
    await userEvent.click(lines[2] as HTMLElement);
    expect(pick).toHaveBeenCalledWith(11);
    expect(view).not.toHaveTextContent('import { greet }');
  });

  it('says when a file cannot be opened', async () => {
    render(<CodeView path="nope.ts" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot open nope.ts');
  });
});
