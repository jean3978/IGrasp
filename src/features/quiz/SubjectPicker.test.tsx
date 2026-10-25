import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { useProjectProfile } from '../../stores/projectProfile';
import { targetReady, useQuiz } from '../../stores/quiz';
import { useSettings } from '../../stores/settings';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { SubjectPicker } from './SubjectPicker';

const setup = () => useQuiz.getState().setup;

beforeEach(async () => {
  window.__igraspMock?.reset();
  useProjectProfile.getState().clear();
  await useSettings.getState().load();
  useQuiz.getState().leaveFolder();
  useTabs.setState({ tabs: [], activeId: null });
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await useProjectProfile.getState().load(FIXTURE_ROOT);
  await useProjectProfile.getState().loadSubjects();
});

describe('SubjectPicker', () => {
  it('groups the subjects as global concepts and features, with names, not paths', async () => {
    render(<SubjectPicker />);
    const group = screen.getByRole('radiogroup', { name: 'What should Hoot ask about?' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      'No specific subject',
      'Architecture',
      'Tech stack',
      'Build, CI and release',
      'Greeting',
      'Getting started',
    ]);
    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.getByText('Features')).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('radio', { name: 'Tech stack' }));
    expect(setup()).toMatchObject({ target: 'subject', subjectId: 'concept:stack' });
    expect(within(group).getByRole('radio', { name: 'Tech stack' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('takes a subject of your own', async () => {
    render(<SubjectPicker />);
    const box = screen.getByRole('textbox', { name: 'Your own' });
    await userEvent.type(box, 'how the greeting is built');
    expect(setup()).toMatchObject({ target: 'custom', customSubject: 'how the greeting is built' });
    expect(targetReady(setup())).toBe(true);
    // No chip is checked while the typed subject is the target.
    for (const r of screen.getAllByRole('radio'))
      expect(r).toHaveAttribute('aria-checked', 'false');
    await userEvent.clear(box);
    expect(setup().target).toBe('subject');
  });

  it('collects the code to check: typed paths and open files', async () => {
    useTabs.getState().openCode('src/main.ts');
    render(<SubjectPicker />);
    await userEvent.type(
      screen.getByLabelText('A file or folder to check'),
      '\\docs\\guide\\{Enter}',
    );
    expect(setup()).toMatchObject({ target: 'paths', paths: ['docs/guide'] });
    await userEvent.click(screen.getByRole('button', { name: /main\.ts/ }));
    expect(setup().paths).toEqual(['docs/guide', 'src/main.ts']);
    const list = screen.getByRole('list', { name: 'Code to check' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Remove docs/guide' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove src/main.ts' }));
    expect(setup()).toMatchObject({ target: 'subject', paths: [] });
  });
});
