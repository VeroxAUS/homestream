import { toastActionFor, type ToastInteraction, type ToastSpec } from './notifications.js';

/** The part of Electron's `Notification` the binding listens to. */
export interface ToastEvents {
  onBody(listener: () => void): void;
  /** Electron passes the pressed button as the second argument, after its event object. */
  onButton(listener: (index: number) => void): void;
  onGone(listener: () => void): void;
}

/**
 * Runs `onActivate` once per toast, and only for an interaction that asks for something.
 * Windows can report one press through more than one path, and Dismiss arrives like any other press.
 */
export function bindToast(
  events: ToastEvents,
  spec: ToastSpec,
  onActivate: (spec: ToastSpec, action: 'open' | 'health') => void,
  onGone: () => void,
): void {
  let handled = false;
  const interact = (interaction: ToastInteraction): void => {
    if (handled) return;
    handled = true;
    onGone();
    const action = toastActionFor(spec, interaction);
    if (action) onActivate(spec, action);
  };
  events.onBody(() => interact({ kind: 'body' }));
  events.onButton((index) => interact({ kind: 'button', index }));
  events.onGone(onGone);
}
