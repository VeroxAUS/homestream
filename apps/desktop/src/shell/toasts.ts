import { Notification } from 'electron';
import { toastXml, type ToastSpec } from '../notifications.js';

/** Shows Windows toasts and keeps a reference to each until it closes (an unreferenced notification can be collected). */
export class ToastCenter {
  private readonly live = new Set<Notification>();

  /** `onActivate` runs when the toast or its first button is clicked; Dismiss only closes the toast. */
  show(spec: ToastSpec, onActivate: (spec: ToastSpec) => void): boolean {
    if (!Notification.isSupported()) return false;
    const notification = new Notification({ title: spec.title, body: spec.body, toastXml: toastXml(spec) });
    this.live.add(notification);
    notification.on('click', () => onActivate(spec));
    notification.on('close', () => this.live.delete(notification));
    notification.on('failed', () => this.live.delete(notification));
    notification.show();
    return true;
  }
}
