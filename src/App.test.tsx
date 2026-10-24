import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { useWorkspace } from './stores/workspace';

beforeEach(() => {
  window.__igraspMock?.reset();
  useWorkspace.setState({ root: null, openError: null });
});

describe('App', () => {
  it('starts on the welcome screen', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'IGrasp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Folder/ })).toBeInTheDocument();
    expect(await screen.findByText('Folders you open will appear here.')).toBeInTheDocument();
  });

  it('opens a folder from the welcome screen', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /Open Folder/ }));
    expect(await screen.findByRole('heading', { name: 'igrasp-demo' })).toBeInTheDocument();
    expect(document.title).toBe('igrasp-demo — IGrasp');
  });
});
