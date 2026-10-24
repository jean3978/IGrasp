// The IGrasp mark: a markdown page held by a stroke that reads both as fingers wrapping the page
// and as the letter G (its bar is the thumb resting on the page). Kept in sync with
// assets/branding/*.svg, which are the sources for the app icons.

import { useId } from 'react';
import { LOGO_PATHS } from './logoPaths';

interface AppLogoProps {
  variant?: 'color' | 'mono';
  className?: string;
  /** Accessible name; the logo is decorative when omitted. */
  title?: string;
}

export function AppLogo({ variant = 'color', className, title }: AppLogoProps) {
  const id = useId();
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };

  if (variant === 'mono') {
    return (
      <svg viewBox="0 0 512 512" className={className} {...a11y}>
        <path d={LOGO_PATHS.page} fill="currentColor" />
        <path
          d={`${LOGO_PATHS.grip}${LOGO_PATHS.thumb}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="44"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const gradient = `${id}-bg`;
  return (
    <svg viewBox="0 0 512 512" className={className} {...a11y}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b2fa8" />
          <stop offset="1" stopColor="#6d4de0" />
        </linearGradient>
      </defs>
      <rect
        className="logo-badge"
        x="32"
        y="32"
        width="448"
        height="448"
        rx="104"
        fill={`url(#${gradient})`}
      />
      <g className="logo-page">
        <path d={LOGO_PATHS.page} fill="#f7f3ea" />
        <path d={LOGO_PATHS.fold} fill="#cfc4f2" />
        <rect x="204" y="200" width="84" height="18" rx="9" fill="#8c7ae6" />
        <rect x="204" y="244" width="116" height="24" rx="12" fill="#3b2fa8" />
        <rect x="204" y="294" width="100" height="18" rx="9" fill="#8c7ae6" />
        <rect x="204" y="334" width="64" height="18" rx="9" fill="#8c7ae6" />
      </g>
      <path
        className="logo-grip"
        d={`${LOGO_PATHS.grip}${LOGO_PATHS.thumb}`}
        pathLength={1}
        fill="none"
        stroke="#f5b83d"
        strokeWidth="40"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
