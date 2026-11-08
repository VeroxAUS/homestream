import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { focusNavSearch } from '../lib/searchUrl';
import { typesText } from '../player/useShortcuts';
import { desktopBridge } from './bridge';
import { ShortcutSheet } from './ShortcutSheet';

/**
 * Window-wide keys of the desktop app: `?` opens the shortcut list (Esc closes it), Ctrl+F and `/` focus the nav search
 * field. Zoom, F11, Alt+arrows and Alt+F4 belong to the shell. The player has its own keys and no nav, so Search is not
 * offered there.
 */
function Keys() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const inPlayer = pathname === '/play' || pathname.startsWith('/play/');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (open && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (event.altKey || event.metaKey) return;
      const search = event.ctrlKey ? event.key.toLowerCase() === 'f' : event.key === '/' && !typesText(event.target);
      if (search && !inPlayer) {
        event.preventDefault();
        focusNavSearch();
      } else if (event.key === '?' && !event.ctrlKey && !typesText(event.target)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, inPlayer]);

  return open ? <ShortcutSheet onClose={() => setOpen(false)} /> : null;
}

export function AppKeys() {
  return desktopBridge() ? <Keys /> : null;
}
