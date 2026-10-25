import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { useAiProvider } from '../../stores/aiProvider';
import { useProjectProfile } from '../../stores/projectProfile';
import { useQuiz } from '../../stores/quiz';
import { useSettings } from '../../stores/settings';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { QuizWizard } from './QuizWizard';

const setup = () => useQuiz.getState().setup;

function show() {
  render(
    <Tooltip.Provider>
      <QuizWizard />
    </Tooltip.Provider>,
  );
}

const heading = () => screen.getByRole('heading', { level: 2 });
const next = () => screen.getByRole('button', { name: /^Next/ });
const kind = (name: string) =>
  within(screen.getByRole('radiogroup', { name: 'What kind of quiz?' })).getByRole('radio', {
    name: new RegExp(name),
  });

beforeEach(async () => {
  window.__igraspMock?.reset();
  resetAiStores();
  useProjectProfile.getState().clear();
  await useSettings.getState().load();
  useQuiz.getState().leaveFolder();
  useTabs.setState({ tabs: [], activeId: null });
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await useAiProvider.getState().checkStatus();
  await useProjectProfile.getState().load(FIXTURE_ROOT);
  await useProjectProfile.getState().loadSubjects();
});

describe('the new-quiz wizard', () => {
  it('goes kind, concept, options, then Start shows the confirmation card', async () => {
    show();
    expect(heading()).toHaveTextContent('What kind of quiz?');
    expect(screen.getByRole('button', { name: /Kind of quiz/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    // Only the kinds on the first step: no subject chip, no option, no Start.
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    expect(screen.queryByLabelText('Questions')).toBeNull();

    await userEvent.click(kind('Global concepts'));
    expect(heading()).toHaveTextContent('Which concept?');
    expect(heading()).toHaveFocus();
    const concepts = screen.getByRole('radiogroup', { name: 'Concepts' });
    expect(
      within(concepts)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['The whole project', 'Architecture', 'Tech stack', 'Build, CI and release']);
    await userEvent.click(within(concepts).getByRole('radio', { name: 'Tech stack' }));
    await userEvent.click(next());

    expect(heading()).toHaveTextContent('How should the quiz go?');
    expect(screen.getByText('Tech stack', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByLabelText('Questions')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Sources' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Start/ }));
    await waitFor(() => {
      expect(useQuiz.getState().screen).toBe('confirm');
    });
    expect(useQuiz.getState().pending?.input.subjectId).toBe('concept:stack');
    expect(window.__igraspMock?.state.ai.starts).toEqual([]);
  });

  it('waits for a feature to be picked', async () => {
    show();
    await userEvent.click(kind('A feature'));
    expect(heading()).toHaveTextContent('Which feature?');
    expect(next()).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Greeting' }));
    expect(next()).toBeEnabled();
    expect(setup()).toMatchObject({ target: 'subject', subjectId: 'feature:greeting' });
    // Back to the kinds keeps the choice highlighted.
    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(kind('A feature')).toHaveAttribute('aria-checked', 'true');
  });

  it('takes a subject of your own, focused, and needs some text', async () => {
    show();
    await userEvent.click(kind('Your own subject'));
    const field = screen.getByRole('textbox', { name: 'Your own subject' });
    expect(field).toHaveFocus();
    expect(next()).toBeDisabled();
    await userEvent.type(field, 'how the greeting is built');
    await userEvent.click(next());
    expect(screen.getByText('“how the greeting is built”')).toBeInTheDocument();
    expect(setup()).toMatchObject({ target: 'custom', customSubject: 'how the greeting is built' });
  });

  it('collects code to check from typed paths and open files, without sources', async () => {
    useTabs.getState().openCode('src/main.ts');
    show();
    await userEvent.click(kind('Check specific code'));
    expect(next()).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText('A file or folder to check'),
      '\\docs\\guide\\{Enter}',
    );
    await userEvent.click(screen.getByRole('button', { name: /main\.ts/ }));
    expect(setup()).toMatchObject({ target: 'paths', paths: ['docs/guide', 'src/main.ts'] });
    await userEvent.click(screen.getByRole('button', { name: 'Remove docs/guide' }));
    expect(setup().paths).toEqual(['src/main.ts']);
    await userEvent.click(next());
    expect(screen.getByText('src/main.ts', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Sources' })).toBeNull();
    expect(
      screen.getByText(/Code check: only the files and folders you picked/),
    ).toBeInTheDocument();
    // "Change" goes back to the subject step.
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(heading()).toHaveTextContent('Which code should Hoot check?');
  });
});
