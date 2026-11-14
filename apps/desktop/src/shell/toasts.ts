import { Notification } from 'electron';
import { toastButtons, type ToastSpec } from '../notifications.js';
import { bindToast } from '../toastBinding.js';

/** Shows Windows toasts and keeps a reference to each until it closes (an unreferenced notification can be collected). */
export class ToastCenter {
  private readonly live = new Set<Notification>();

  /**
   * `onActivate` runs when the toast body or an action button is pressed; Dismiss does nothing.
   * The buttons are Electron's own (not custom toast XML), so every press arrives with its button index.
   */
  show(spec: ToastSpec, onActivate: (spec: ToastSpec, action: 'open' | 'health') => void): boolean {
    if (!Notification.isSupported()) return false;
    const notification = new Notification({ title: spec.title, body: spec.body, actions: toastButtons(spec) });
    this.live.add(notification);
    const forget = (): void => void this.live.delete(notification);
    bindToast(
      {
        onBody: (listener) => notification.on('click', listener),
        onButton: (listener) => notification.on('action', (_event, index) => listener(index)),
        onGone: (listener) => {
          notification.on('close', listener);
          notification.on('failed', listener);
        },
      },
      spec,
      onActivate,
      forget,
    );
    notification.show();
    return true;
  }
}
