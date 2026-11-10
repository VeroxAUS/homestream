function isOnOrigin(url: string | undefined, origin: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * The only permissions the web UI gets. `keyboardLock` is what lets the player keep Escape for itself while it is
 * fullscreen (menu, then Info, then fullscreen, then the player); the bundled startup page and other origins never get
 * it.
 */
export function permissionGranted(
  permission: string,
  requestingUrl: string | undefined,
  serverOrigin: string,
): boolean {
  if (permission === 'fullscreen') return true;
  if (permission === 'keyboardLock') return isOnOrigin(requestingUrl, serverOrigin);
  return false;
}

export interface PermissionSession {
  setPermissionRequestHandler(
    handler: (
      contents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      details: { requestingUrl?: string },
    ) => void,
  ): void;
  setPermissionCheckHandler(
    handler: (
      contents: unknown,
      permission: string,
      requestingOrigin: string,
      details: { requestingUrl?: string },
    ) => boolean,
  ): void;
}

/** Installs the request and the check handler: Chromium asks one or the other depending on the API. */
export function guardPermissions(ses: PermissionSession, serverOrigin: string): void {
  ses.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(permissionGranted(permission, details.requestingUrl, serverOrigin)),
  );
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
    permissionGranted(permission, details.requestingUrl ?? requestingOrigin, serverOrigin),
  );
}
