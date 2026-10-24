export type Platform = 'windows' | 'linux' | 'other';

export function detectPlatform(userAgent: string = navigator.userAgent): Platform {
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Linux|X11/i.test(userAgent) && !/Android/i.test(userAgent)) return 'linux';
  return 'other';
}

export const platform: Platform = typeof navigator === 'undefined' ? 'other' : detectPlatform();
