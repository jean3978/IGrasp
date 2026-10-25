import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import type { ProjectProfile } from '../../ipc/types';
import { useAiProvider } from '../../stores/aiProvider';
import { useProjectProfile } from '../../stores/projectProfile';
import { useQuiz } from '../../stores/quiz';
import { useSettings } from '../../stores/settings';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { rolesFor } from './quizRoles';
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

/** Step 1: picks a proposed role and goes on. */
async function asRole(role = 'Contributor') {
  await userEvent.click(screen.getByRole('radio', { name: role }));
  await userEvent.click(next());
}

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
  it('goes role, kind, concept, options, then Start shows the confirmation card', async () => {
    show();
    expect(heading()).toHaveTextContent('Who are you on this project?');
    // The fixture is a command-line tool and a library: roles for those.
    const roles = screen.getByRole('radiogroup', { name: 'Roles' });
    expect(
      within(roles)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Contributor', 'Maintainer', 'User of the tool', 'Developer using the library']);
    expect(next()).toBeDisabled();
    await asRole('Maintainer');

    expect(heading()).toHaveTextContent('What kind of quiz?');
    expect(heading()).toHaveFocus();
    expect(screen.queryByRole('radio', { name: /Your own subject/ })).toBeNull();
    await userEvent.click(kind('Global concepts'));
    expect(heading()).toHaveTextContent('Which concept?');
    const concepts = screen.getByRole('radiogroup', { name: 'Concepts' });
    await userEvent.click(within(concepts).getByRole('radio', { name: 'Tech stack' }));
    await userEvent.click(next());

    expect(heading()).toHaveTextContent('How should the quiz go?');
    expect(screen.getByText('Maintainer', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Tech stack', { selector: 'strong' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Start/ }));
    await waitFor(() => {
      expect(useQuiz.getState().screen).toBe('confirm');
    });
    expect(useQuiz.getState().pending?.input).toMatchObject({
      subjectId: 'concept:stack',
      category: 'global',
      role: 'Maintainer',
    });
    expect(window.__igraspMock?.state.ai.starts).toEqual([]);
  });

  it('takes a role of your own', async () => {
    show();
    await userEvent.type(screen.getByRole('textbox', { name: 'Other role' }), 'Narrative designer');
    expect(setup().role).toBe('Narrative designer');
    for (const r of within(screen.getByRole('radiogroup', { name: 'Roles' })).getAllByRole('radio'))
      expect(r).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(next());
    expect(heading()).toHaveTextContent('What kind of quiz?');
  });

  it('types a feature that is not in the list, read as a feature', async () => {
    show();
    await asRole();
    await userEvent.click(kind('A feature'));
    expect(heading()).toHaveTextContent('Which feature?');
    expect(next()).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Greeting' }));
    expect(next()).toBeEnabled();
    const other = screen.getByRole('textbox', { name: 'Something else' });
    await userEvent.type(other, 'loud mode');
    expect(setup()).toMatchObject({
      target: 'custom',
      category: 'feature',
      customSubject: 'loud mode',
    });
    expect(screen.getByRole('radio', { name: 'Greeting' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await userEvent.click(next());
    expect(screen.getByText('“loud mode”')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Start/ }));
    await waitFor(() => {
      expect(useQuiz.getState().pending?.input).toMatchObject({
        subjectId: null,
        customSubject: 'loud mode',
        category: 'feature',
      });
    });
    useQuiz.getState().cancelConfirm();
  });

  it('collects code to check, as a code quiz without sources', async () => {
    useTabs.getState().openCode('src/main.ts');
    show();
    await asRole();
    await userEvent.click(kind('Check specific code'));
    expect(next()).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText('A file or folder to check'),
      '\\docs\\guide\\{Enter}',
    );
    await userEvent.click(screen.getByRole('button', { name: /main\.ts/ }));
    expect(setup()).toMatchObject({
      target: 'paths',
      category: 'code',
      paths: ['docs/guide', 'src/main.ts'],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Remove docs/guide' }));
    await userEvent.click(next());
    expect(screen.getByText('src/main.ts', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Sources' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(heading()).toHaveTextContent('Which code should Hoot check?');
  });
});

describe('rolesFor', () => {
  const profile = (...kinds: string[]) =>
    ({
      kinds: kinds.map((value) => ({ value, confidence: 'high', evidence: [] })),
    }) as unknown as ProjectProfile;

  it('proposes the roles of the kinds of project', () => {
    expect(rolesFor(profile('game'))).toEqual([
      'Gameplay programmer',
      'Game designer',
      'Level designer',
      'Artist',
      'Technical artist',
      'Sound designer',
      'Producer',
      'QA tester',
    ]);
    expect(rolesFor(profile('webFrontend', 'webBackend')).slice(0, 4)).toEqual([
      'Frontend developer',
      'UX/UI designer',
      'Product manager',
      'QA engineer',
    ]);
    expect(rolesFor(profile('documentation'))[0]).toBe('Technical writer');
    expect(rolesFor(null)).toEqual(['Developer', 'Tech lead', 'New team member']);
  });
});
