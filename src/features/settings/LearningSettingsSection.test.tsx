import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../../ipc/client';
import { DEFAULT_SETTINGS } from '../../ipc/defaults';
import { FIXTURE_ROOT, FIXTURE_SHARED_TUTORIAL } from '../../ipc/mock/fixture';
import { useAcademy } from '../../stores/academy';
import { useProjectProfile } from '../../stores/projectProfile';
import { useQuiz } from '../../stores/quiz';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';
import { LearningSettingsSection } from './LearningSettingsSection';

const learning = async () => (await backend.getSettings()).learning;

beforeEach(async () => {
  window.__igraspMock?.reset();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  useProjectProfile.getState().clear();
  useQuiz.getState().leaveFolder();
  await useWorkspace.getState().closeRoot();
});

describe('Settings → Learning', () => {
  it('saves the quiz defaults and the effects', async () => {
    render(<LearningSettingsSection />);
    const count = screen.getByRole('spinbutton', { name: 'Questions per quiz' });
    await userEvent.clear(count);
    await userEvent.type(count, '50{Enter}');
    await userEvent.click(screen.getByRole('radio', { name: 'Adaptive' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Documentation only' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Effects' }));
    await waitFor(async () => {
      expect(await learning()).toMatchObject({
        quizQuestions: 30,
        quizMode: 'adaptive',
        quizScope: 'documentationOnly',
        effects: false,
      });
    });
    // Forgetting needs an open folder.
    expect(screen.getByRole('button', { name: 'Forget quizzes…' })).toBeDisabled();
  });

  it('validates the folders before saving them', async () => {
    render(<LearningSettingsSection />);
    const results = screen.getByRole('textbox', { name: 'Results folder' });
    await userEvent.clear(results);
    await userEvent.type(results, '../outside');
    await userEvent.tab();
    expect(screen.getByRole('alert')).toHaveTextContent(/inside the open folder/);
    expect((await learning()).quizResultsFolder).toBe('quiz-results');
    await userEvent.clear(results);
    await userEvent.type(results, 'docs/quiz results/{Enter}');
    await waitFor(async () => {
      expect((await learning()).quizResultsFolder).toBe('docs/quiz results');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("forgets the folder's quizzes after a confirmation", async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    const mock = window.__igraspMock;
    if (!mock) throw new Error('no mock');
    mock.state.quizzes.set(FIXTURE_ROOT, { current: null, history: [] });
    render(<LearningSettingsSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Forget quizzes…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Forget them' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Forgotten.');
    });
    expect(mock.state.quizzes.has(FIXTURE_ROOT)).toBe(false);
  });

  it('saves the tutorial defaults and folder, and forgets the private tutorials only', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    useAcademy.getState().leaveFolder();
    const t = structuredClone(FIXTURE_SHARED_TUTORIAL.tutorial);
    t.id = '';
    await backend.saveTutorial(t);
    window.__igraspMock?.addSharedTutorial();
    render(<LearningSettingsSection />);
    const group = screen.getByRole('group', { name: 'Tutorials' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Already contributing' }));
    await userEvent.click(within(group).getByRole('radio', { name: 'Deep' }));
    const folder = within(group).getByRole('textbox', { name: 'Tutorials folder' });
    await userEvent.clear(folder);
    await userEvent.type(folder, '/abs{Enter}');
    expect(within(group).getByRole('alert')).toHaveTextContent(/inside the open folder/);
    await userEvent.clear(folder);
    await userEvent.type(folder, 'docs/learn{Enter}');
    await waitFor(async () => {
      expect(await learning()).toMatchObject({
        tutorialFamiliarity: 'contributing',
        tutorialLength: 'deep',
        tutorialsFolder: 'docs/learn',
      });
    });
    await userEvent.click(within(group).getByRole('button', { name: 'Forget tutorials…' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Forget them' }));
    expect(await within(group).findByRole('status')).toHaveTextContent('Forgotten.');
    const left = await backend.listTutorials();
    expect(left.map((x) => x.reference.type)).toEqual(['shared']);
  });
});
