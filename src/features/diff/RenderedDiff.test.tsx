import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RenderedDiff } from './RenderedDiff';

describe('RenderedDiff', () => {
  const oldText = '# Title\n\nOne.\n\nMid.\n\n- a\n- b\n\nEnd.\n';
  const newText = '# Title\n\nUno.\n\nMid.\n\n- a\n- b\n- c\n\nEnd.\n';

  it('renders unchanged blocks once and each change group with its toolbar', async () => {
    const { container } = render(
      <RenderedDiff
        oldText={oldText}
        newText={newText}
        states={[undefined, 'accepted']}
        renderToolbar={({ index, count, state }) => (
          <span data-testid="bar">{`${index + 1}/${count} ${state}`}</span>
        )}
      />,
    );
    const groups = await screen.findAllByRole('group');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.getAttribute('aria-label')).toBe('Change 1 of 2: replaced paragraph');
    expect(groups[1]?.getAttribute('aria-label')).toBe('Change 2 of 2: replaced list');
    expect(screen.getAllByTestId('bar').map((n) => n.textContent)).toEqual([
      '1/2 pending',
      '2/2 accepted',
    ]);
    expect(groups[1]?.getAttribute('data-state')).toBe('accepted');
    // The heading and the last paragraph are common: shown once. The removed side has no ids.
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelectorAll('.diff-part--removed [id]')).toHaveLength(0);
    expect(container.querySelector('.diff-part--removed')?.textContent).toContain('One.');
    expect(container.querySelector('.diff-part--added')?.textContent).toContain('Uno.');
    // Lists carry their start line like the other blocks.
    expect(container.querySelector('ul[data-line="7"]')).not.toBeNull();
  });

  it('shows the whole document as added for a new file', async () => {
    const { container } = render(<RenderedDiff oldText="" newText={'# New\n\nText.\n'} />);
    await screen.findByRole('group');
    expect(container.querySelector('.diff-part--removed')).toBeNull();
    expect(container.querySelector('.diff-part--added h1')?.textContent).toBe('New');
  });
});
