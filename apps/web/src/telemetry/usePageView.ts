import { useEffect } from 'react';
import { trackPageView } from './index';

/** Reports a page view for the current location. The router layout calls it with `location.pathname`. */
export function usePageView(pathname: string): void {
  useEffect(() => trackPageView(pathname), [pathname]);
}
