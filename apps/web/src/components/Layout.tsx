import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router';
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
  return (
    <>
      <Nav />
      <Suspense fallback={<div className={styles.fallback} aria-busy="true" />}>
        <Outlet />
      </Suspense>
    </>
  );
}
