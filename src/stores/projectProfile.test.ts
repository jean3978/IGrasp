import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import { EMPTY_CORRECTIONS } from '../ipc/mock/mockProfile';
import { useProjectProfile } from './projectProfile';
import { useWorkspace } from './workspace';

beforeEach(async () => {
  window.__igraspMock?.reset();
  useProjectProfile.getState().clear();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

describe('project profile store', () => {
  it('loads the profile of the fixture', async () => {
    await useProjectProfile.getState().load(FIXTURE_ROOT);
    const p = useProjectProfile.getState().profile;
    expect(p?.name).toBe('igrasp-demo');
    expect(p?.kinds.map((k) => k.value)).toEqual(['cli', 'library']);
    expect(p?.languages.map((l) => l.name)).toContain('TypeScript');
    expect(p?.ci[0]?.value).toBe('GitHub Actions');
    expect(p?.summary).toBe('igrasp-demo: a command-line tool in TypeScript, tested with Vitest.');
  });

  it('lists the subjects of the fixture, about the project', async () => {
    await useProjectProfile.getState().load(FIXTURE_ROOT);
    await useProjectProfile.getState().loadSubjects();
    const subjects = useProjectProfile.getState().subjects ?? [];
    expect(subjects.map((s) => s.id)).toEqual([
      'overview',
      'feature:docs/guide/getting-started.md',
      'build',
    ]);
    for (const s of subjects) {
      expect(s.title).toContain('igrasp-demo');
      expect(s.anchors.length).toBeGreaterThan(0);
    }
    expect(window.__igraspMock?.state.ai.starts).toEqual([]);
  });

  it('saves corrections that the next load keeps', async () => {
    await useProjectProfile.getState().load(FIXTURE_ROOT);
    await useProjectProfile.getState().saveCorrections({
      ...EMPTY_CORRECTIONS,
      addKinds: ['service'],
      removeKinds: ['library'],
      notes: '  Also a dedicated server. ',
    });
    let p = useProjectProfile.getState().profile;
    expect(p?.kinds.map((k) => k.value)).toEqual(['service', 'cli']);
    expect(p?.kinds[0]?.evidence).toEqual(['(you)']);
    expect(p?.corrections.notes).toBe('Also a dedicated server.');
    useProjectProfile.getState().clear();
    await useProjectProfile.getState().load(FIXTURE_ROOT);
    p = useProjectProfile.getState().profile;
    expect(p?.summary.startsWith('igrasp-demo: a service')).toBe(true);
  });
});
