import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESKTOP_SETTINGS, type DownloadEvent } from '@homestream/shared';
import { planCloseNotice, planReadyToast, type ToastSpec } from '../src/notifications.js';
import { bindToast } from '../src/toastBinding.js';

const ready = { downloadId: 'd7', title: 'The Matrix', mediaType: 'movie', tmdbId: 603 } as unknown as DownloadEvent;
const readyToast = planReadyToast(ready, { settings: DEFAULT_DESKTOP_SETTINGS, windowFocused: false })!;

/** An Electron Notification stand-in: 'click' carries an event, 'action' an event plus the pressed button index. */
function setup(spec: ToastSpec) {
  const notification = new EventEmitter();
  const activate = vi.fn();
  const gone = vi.fn();
  bindToast(
    {
      onBody: (listener) => notification.on('click', listener),
      onButton: (listener) => notification.on('action', (_event: unknown, index: number) => listener(index)),
      onGone: (listener) => notification.on('close', listener),
    },
    spec,
    activate,
    gone,
  );
  return { notification, activate, gone };
}

describe('bindToast', () => {
  it('opens the title for a body click', () => {
    const { notification, activate } = setup(readyToast);
    notification.emit('click', {});
    expect(activate).toHaveBeenCalledExactlyOnceWith(readyToast, 'open');
  });

  it('opens the title for the Play button', () => {
    const { notification, activate } = setup(readyToast);
    notification.emit('action', { actionIndex: 0 }, 0, -1);
    expect(activate).toHaveBeenCalledExactlyOnceWith(readyToast, 'open');
  });

  it('does nothing for the Dismiss button', () => {
    const { notification, activate, gone } = setup(readyToast);
    notification.emit('action', { actionIndex: 1 }, 1, -1);
    expect(activate).not.toHaveBeenCalled();
    expect(gone).toHaveBeenCalledOnce();
  });

  it('runs one activation per toast even when the press is reported twice', () => {
    const { notification, activate } = setup(readyToast);
    notification.emit('action', { actionIndex: 0 }, 0, -1);
    notification.emit('click', {});
    expect(activate).toHaveBeenCalledOnce();
  });

  it('does not let a later body click open after Dismiss', () => {
    const { notification, activate } = setup(readyToast);
    notification.emit('action', { actionIndex: 1 }, 1, -1);
    notification.emit('click', {});
    expect(activate).not.toHaveBeenCalled();
  });

  it('does nothing for the close notice', () => {
    const { notification, activate } = setup(planCloseNotice(DEFAULT_DESKTOP_SETTINGS)!);
    notification.emit('click', {});
    notification.emit('action', { actionIndex: 0 }, 0, -1);
    expect(activate).not.toHaveBeenCalled();
  });

  it('reports the toast as gone when Windows closes it', () => {
    const { notification, activate, gone } = setup(readyToast);
    notification.emit('close');
    expect(gone).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });
});
