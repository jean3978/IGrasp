// Human labels of the profile's values, and the values the edit dialog suggests.

import type { ProfileCorrections, ProjectKind } from '../../ipc/types';

export const KIND_LABELS: Record<ProjectKind, string> = {
  game: 'Game',
  webFrontend: 'Web front end',
  webBackend: 'Web back end',
  mobile: 'Mobile app',
  desktop: 'Desktop app',
  library: 'Library',
  cli: 'Command-line tool',
  service: 'Service',
  dataMl: 'Data / ML',
  infrastructure: 'Infrastructure',
  embedded: 'Embedded',
  monorepo: 'Monorepo',
  documentation: 'Documentation',
  unknown: 'Unknown',
};

/** Every kind the user can add (Unknown is what remains when nothing is detected). */
export const ADDABLE_KINDS = (Object.keys(KIND_LABELS) as ProjectKind[]).filter(
  (k) => k !== 'unknown',
);

/** Suggestions of the edit dialog: what the detector knows, plus free text. */
export const ENGINE_SUGGESTIONS = [
  'Unreal Engine',
  'Unity',
  'Godot',
  'Bevy',
  'MonoGame',
  'Phaser',
  'Pygame',
  'Custom engine',
];

export const FRAMEWORK_SUGGESTIONS = [
  'React',
  'Vue',
  'Svelte',
  'Angular',
  'Next.js',
  'Nuxt',
  'Express',
  'NestJS',
  'Django',
  'FastAPI',
  'Flask',
  'Spring Boot',
  'ASP.NET Core',
  'Ruby on Rails',
  'Laravel',
  'Tauri',
  'Electron',
  'Flutter',
  'React Native',
  'Android',
  'gRPC',
  'Axum',
  'PyTorch',
  'TensorFlow',
  'Terraform',
  'Helm',
];

/** The evidence of an item the user added (same as Rust's `BY_YOU`). */
export const BY_YOU = '(you)';

export const EMPTY_CORRECTIONS: ProfileCorrections = {
  addKinds: [],
  removeKinds: [],
  addEngines: [],
  removeEngines: [],
  addFrameworks: [],
  removeFrameworks: [],
  notes: '',
};
