import { describe, expect, it } from 'vitest';
import { guardPermissions, permissionGranted, type PermissionSession } from '../src/permissions.js';

const ORIGIN = 'http://127.0.0.1:8600';

describe('guardPermissions', () => {
  function install() {
    const handlers: {
      request?: Parameters<PermissionSession['setPermissionRequestHandler']>[0];
      check?: Parameters<PermissionSession['setPermissionCheckHandler']>[0];
    } = {};
    guardPermissions(
      {
        setPermissionRequestHandler: (handler) => (handlers.request = handler),
        setPermissionCheckHandler: (handler) => (handlers.check = handler),
      },
      ORIGIN,
    );
    const ask = (permission: string, requestingUrl: string): boolean => {
      let granted: boolean | undefined;
      handlers.request?.(null, permission, (value) => (granted = value), { requestingUrl });
      return granted === true;
    };
    const check = (permission: string, requestingOrigin: string, requestingUrl?: string): boolean =>
      handlers.check?.(null, permission, requestingOrigin, { requestingUrl }) === true;
    return { ask, check };
  }

  it('answers requests: keyboardLock for the server origin only, fullscreen as before, nothing else', () => {
    const { ask } = install();
    expect(ask('keyboardLock', `${ORIGIN}/play/movie/278`)).toBe(true);
    expect(ask('keyboardLock', 'file:///app/dist/assets/loading.html')).toBe(false);
    expect(ask('fullscreen', `${ORIGIN}/`)).toBe(true);
    expect(ask('notifications', `${ORIGIN}/`)).toBe(false);
  });

  it('answers checks from the requesting URL, or from the origin when no URL is given', () => {
    const { check } = install();
    expect(check('keyboardLock', ORIGIN, `${ORIGIN}/play/tv/1396/1/1`)).toBe(true);
    expect(check('keyboardLock', `${ORIGIN}/`)).toBe(true);
    expect(check('keyboardLock', 'https://example.test', `${ORIGIN}/`)).toBe(true);
    expect(check('keyboardLock', ORIGIN, 'https://example.test/')).toBe(false);
    expect(check('keyboardLock', 'file://')).toBe(false);
    expect(check('media', ORIGIN, `${ORIGIN}/`)).toBe(false);
  });
});

describe('permissionGranted', () => {
  it('grants keyboardLock to pages of the server origin', () => {
    expect(permissionGranted('keyboardLock', `${ORIGIN}/play/movie/278`, ORIGIN)).toBe(true);
    expect(permissionGranted('keyboardLock', `${ORIGIN}/`, ORIGIN)).toBe(true);
    expect(permissionGranted('keyboardLock', ORIGIN, ORIGIN)).toBe(true);
    expect(permissionGranted('keyboardLock', `${ORIGIN}/?q=1#top`, ORIGIN)).toBe(true);
  });

  it('refuses keyboardLock to the bundled startup page, other origins and unknown requesters', () => {
    expect(permissionGranted('keyboardLock', 'file:///app/dist/assets/loading.html', ORIGIN)).toBe(false);
    expect(permissionGranted('keyboardLock', 'http://127.0.0.1:8601/', ORIGIN)).toBe(false);
    expect(permissionGranted('keyboardLock', 'http://127.0.0.1:86000/', ORIGIN)).toBe(false);
    expect(permissionGranted('keyboardLock', 'http://127.0.0.1:8600.example.test/', ORIGIN)).toBe(false);
    expect(permissionGranted('keyboardLock', 'https://example.test/', ORIGIN)).toBe(false);
    expect(permissionGranted('keyboardLock', 'not a url', ORIGIN)).toBe(false);
    expect(permissionGranted('keyboardLock', '', ORIGIN)).toBe(false);
    expect(permissionGranted('keyboardLock', undefined, ORIGIN)).toBe(false);
  });

  it('keeps granting fullscreen as before', () => {
    expect(permissionGranted('fullscreen', `${ORIGIN}/play/movie/278`, ORIGIN)).toBe(true);
    expect(permissionGranted('fullscreen', undefined, ORIGIN)).toBe(true);
  });

  it('denies every other permission, also on the server origin', () => {
    for (const permission of ['media', 'notifications', 'geolocation', 'pointerLock', 'clipboard-read', 'unknown']) {
      expect(permissionGranted(permission, `${ORIGIN}/`, ORIGIN)).toBe(false);
    }
  });
});
