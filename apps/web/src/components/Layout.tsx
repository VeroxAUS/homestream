import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router';
import { AppKeys } from '../desktop/AppKeys';
import { UnreachableBanner } from '../desktop/UnreachableBanner';
import { DownloadNotices } from '../notices/DownloadNotices';
import { ToastHost } from '../notices/ToastHost';
import { usePageView } from '../telemetry/usePageView';
import { Nav } from './Nav';
import styles from './Layout.module.css';

/** A new page opens at its top; going back leaves the browser to restore where the user was. */
function useScrollToTop(pathname: string): void {
  const type = useNavigationType();
  const last = useRef(pathname);
  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    if (type !== 'POP') window.scrollTo(0, 0);
  }, [pathname, type]);
}

export function Layout() {
  const { pathname } = useLocation();
  usePageView(pathname);
  useScrollToTop(pathname);
  // The player owns the whole window; it has its own top bar.
  const inPlayer = pathname === '/play' || pathname.startsWith('/play/');
  return (
    <>
      {inPlayer ? null : <Nav />}
      {inPlayer ? null : <UnreachableBanner />}
      <Suspense fallback={<div className={inPlayer ? styles.playerFallback : styles.fallback} aria-busy="true" />}>
        <Outlet />
      </Suspense>
      <AppKeys />
      <DownloadNotices />
      <ToastHost />
    </>
  );
}
