import type { ReactElement } from 'react';

const PATHS = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  chevronLeft: <path d="m14.5 5-7 7 7 7" />,
  chevronRight: <path d="m9.5 5 7 7-7 7" />,
  chevronDown: <path d="m5 9.5 7 7 7-7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  hourglass: (
    <>
      <path d="M7 3.5h10M7 20.5h10" />
      <path d="M8 3.5c0 4 4 5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5-4 8.5s4 4.5 4 8.5" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </>
  ),
  star: (
    <path
      d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"
      fill="currentColor"
      stroke="none"
    />
  ),
  film: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M8 4.5v15M16 4.5v15M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5" />
    </>
  ),
  pause: <path d="M8 5v14M16 5v14" strokeWidth="3.2" />,
  back: <path d="M19 12H5.5M11.5 5.5 5 12l6.5 6.5" />,
  skipBack: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" />
      <path d="M4 3.5v4h4" />
    </>
  ),
  skipForward: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" />
      <path d="M20 3.5v4h-4" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  audio: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3.5" y="13.5" width="4" height="6" rx="1.5" />
      <rect x="16.5" y="13.5" width="4" height="6" rx="1.5" />
    </>
  ),
  subtitles: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 11h3.5M13.5 11H17M7 14.5h6M16 14.5h1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.1" />
    </>
  ),
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  fullscreenExit: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  popOut: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <rect x="12" y="11" width="7" height="5.5" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  pin: <path d="M9 4h6l-1 6 3 3v1.5H7V13l3-3zM12 14.5V21" />,
  expand: <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />,
  unplug: (
    <>
      <path d="m9 6 3.5 3.5M15 6l-3.5 3.5" />
      <path d="M7 9.5h10v3a5 5 0 0 1-10 0zM12 17.5V21" />
    </>
  ),
} satisfies Record<string, ReactElement>;

type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

/** Inline SVG icon: 20 px, stroke 1.8, round caps, painted in the current text colour. */
export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
