import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { useProjectProfile } from '../../stores/projectProfile';
import { useTabs } from '../../stores/tabs';
import { useUi } from '../../stores/ui';
import { useWorkspace } from '../../stores/workspace';
import { ProjectProfilePanel } from './ProjectProfilePanel';

const starts = () => window.__igraspMock?.state.ai.starts ?? [];

beforeEach(async () => {
  window.__igraspMock?.reset();
  useProjectProfile.getState().clear();
  useUi.setState({ profileEditorOpen: false });
  useTabs.setState({ tabs: [], activeId: null });
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

describe('the project profile card', () => {
  it('shows the summary, the chips, the languages and the tools', async () => {
    render(<ProjectProfilePanel />);
    const card = await screen.findByRole('region', { name: 'Project profile' });
    expect(card).toHaveTextContent('igrasp-demo: a command-line tool in TypeScript');
    const kinds = within(card).getByRole('list', { name: 'Kind' });
    expect(within(kinds).getByRole('button', { name: /Command-line tool/ })).toBeInTheDocument();
    // The medium-confidence library chip names its evidence.
    expect(
      within(kinds).getByRole('button', {
        name: /Library \(medium confidence\)\. Evidence: package\.json/,
      }),
    ).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: /TypeScript/ })).toBeInTheDocument();
    expect(card).toHaveTextContent('GitHub Actions');
    expect(card).toHaveTextContent('detected locally, no AI');
    expect(starts()).toEqual([]);
  });

  it('opens the evidence of a chip', async () => {
    render(<ProjectProfilePanel />);
    const kinds = await screen.findByRole('list', { name: 'Kind' });
    await userEvent.click(within(kinds).getByRole('button', { name: /Command-line tool/ }));
    const tab = useTabs.getState().tabs[0];
    expect(tab?.kind).toBe('code');
    expect(tab?.relPath).toBe('package.json');
  });
});

describe('the profile edit dialog', () => {
  it('removes a kind, adds one and a framework, writes a note, and saves', async () => {
    render(<ProjectProfilePanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit the project profile' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Library' }));
    expect(within(dialog).getByRole('button', { name: 'Restore Library' })).toBeInTheDocument();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Add a kind' }),
      'service',
    );
    await userEvent.type(
      within(dialog).getByRole('combobox', { name: 'framework' }),
      'Nakama{Enter}',
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Notes for the generators' }),
      'This is also a dedicated server.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const p = useProjectProfile.getState().profile;
    expect(p?.kinds.map((k) => k.value)).toEqual(['service', 'cli']);
    expect(p?.frameworks.map((f) => f.value)).toEqual(['Nakama']);
    expect(screen.getByRole('region', { name: 'Project profile' })).toHaveTextContent(
      'Your note: This is also a dedicated server.',
    );
    expect(window.__igraspMock?.state.learning.get(FIXTURE_ROOT)?.removeKinds).toEqual(['library']);
  });

  it('resets to what was detected', async () => {
    await useProjectProfile.getState().load(FIXTURE_ROOT);
    await useProjectProfile.getState().saveCorrections({
      addKinds: ['game'],
      removeKinds: ['cli'],
      addEngines: [],
      removeEngines: [],
      addFrameworks: [],
      removeFrameworks: [],
      notes: 'x',
    });
    render(<ProjectProfilePanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset to detected' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(useProjectProfile.getState().profile?.kinds.map((k) => k.value)).toEqual([
        'cli',
        'library',
      ]);
    });
  });
});
