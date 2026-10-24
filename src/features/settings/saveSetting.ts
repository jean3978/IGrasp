import type { SettingsPatch } from '../../ipc/types';
import { useSettings } from '../../stores/settings';
import { useToasts } from '../../stores/toasts';

/** Saves a settings change; a failure is shown as a toast. */
export function save(patch: SettingsPatch) {
  useSettings
    .getState()
    .update(patch)
    .catch((err: unknown) => {
      useToasts
        .getState()
        .notify(
          'error',
          `Cannot save the setting: ${err instanceof Error ? err.message : String(err)}`,
        );
    });
}
