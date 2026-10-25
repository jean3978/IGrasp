// The profile of the open folder with its edit dialog, connected to the store. Loading it walks
// the folder in the backend (local, no AI).

import { useEffect } from 'react';
import { useProjectProfile } from '../../stores/projectProfile';
import { useWorkspace } from '../../stores/workspace';
import { useUi } from '../../stores/ui';
import { ProfileCard } from './ProfileCard';
import { ProfileEditDialog } from './ProfileEditDialog';

export function ProjectProfilePanel({ compact = false }: { compact?: boolean }) {
  const root = useWorkspace((s) => s.root?.path ?? null);
  const profile = useProjectProfile((s) => s.profile);
  const loading = useProjectProfile((s) => s.loading);
  const error = useProjectProfile((s) => s.error);
  const load = useProjectProfile((s) => s.load);
  const saveCorrections = useProjectProfile((s) => s.saveCorrections);
  const editing = useUi((s) => s.profileEditorOpen);
  const setEditing = useUi((s) => s.setProfileEditorOpen);

  useEffect(() => {
    if (root) void load(root);
  }, [root, load]);

  if (!root) return <p className="profile-empty">Open a folder to see its project profile.</p>;
  if (error) {
    return (
      <p className="profile-error" role="alert">
        Cannot detect the project profile: {error}
      </p>
    );
  }
  if (!profile) {
    return (
      <p className="profile-loading" role="status">
        {loading ? 'Looking at the project…' : ''}
      </p>
    );
  }
  return (
    <>
      <ProfileCard
        profile={profile}
        compact={compact}
        onEdit={() => {
          setEditing(true);
        }}
        onRebuild={() => {
          void load(root, true);
        }}
      />
      <ProfileEditDialog
        open={editing}
        profile={profile}
        onOpenChange={setEditing}
        onSave={saveCorrections}
      />
    </>
  );
}
