// Settings → Learning: the quiz defaults and the project profile of the open folder.

import { ProjectProfilePanel } from '../profile/ProjectProfilePanel';

export function LearningSettingsSection() {
  return (
    <section aria-labelledby="settings-learning">
      <h2 id="settings-learning">Learning</h2>
      <div className="settings-learning-profile">
        <ProjectProfilePanel />
      </div>
    </section>
  );
}
