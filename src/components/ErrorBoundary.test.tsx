import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

it('keeps a render error inside the view, shows it, and tries again', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let broken = true;
  function View() {
    if (broken) throw new TypeError('sources is not iterable');
    return <p>Back</p>;
  }
  const onReset = vi.fn(() => {
    broken = false;
  });
  render(
    <div>
      <nav>Sidebar</nav>
      <ErrorBoundary label="the Academy" onReset={onReset}>
        <View />
      </ErrorBoundary>
    </div>,
  );
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Something went wrong in the Academy.');
  expect(alert).toHaveTextContent('sources is not iterable');
  expect(screen.getByText('Sidebar')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Back')).toBeInTheDocument();
});
