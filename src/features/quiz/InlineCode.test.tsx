import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineCode } from './InlineCode';

describe('InlineCode', () => {
  it('shows backtick spans as code and leaves the rest as plain text', () => {
    const { container } = render(
      <p>
        <InlineCode text="Runs `npm test`, never `<b>bold</b>` or **markdown**; a lone ` stays." />
      </p>,
    );
    const codes = [...container.querySelectorAll('code.quiz-code')].map((c) => c.textContent);
    expect(codes).toEqual(['npm test', '<b>bold</b>']);
    expect(container.querySelector('b, strong')).toBeNull();
    expect(container.textContent).toBe(
      'Runs npm test, never <b>bold</b> or **markdown**; a lone ` stays.',
    );
  });
});
