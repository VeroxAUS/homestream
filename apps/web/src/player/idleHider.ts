export const IDLE_HIDE_MS = 3000;
/** A mouse move resets the timer at most this often, so a busy pointer costs nothing. */
export const ACTIVITY_THROTTLE_MS = 250;

export interface IdleHider {
  /** Any input: shows the controls at once and restarts the countdown. */
  activity: () => void;
  /** While blocked (paused, menu open, pointer over a bar, ...) the controls stay visible and no countdown runs. */
  setBlocked: (blocked: boolean) => void;
  dispose: () => void;
}

interface IdleHiderOptions {
  onChange: (visible: boolean) => void;
  delayMs?: number;
  now?: () => number;
}

/** The auto-hide state machine of the player controls; the DOM is toggled by `onChange`, never through React state. */
export function createIdleHider({ onChange, delayMs = IDLE_HIDE_MS, now = Date.now }: IdleHiderOptions): IdleHider {
  let visible = true;
  let blocked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastReset = Number.NEGATIVE_INFINITY;

  const show = () => {
    if (visible) return;
    visible = true;
    onChange(true);
  };
  const hide = () => {
    timer = undefined;
    if (blocked || !visible) return;
    visible = false;
    onChange(false);
  };
  const restart = () => {
    clearTimeout(timer);
    timer = blocked ? undefined : setTimeout(hide, delayMs);
    lastReset = now();
  };

  return {
    activity() {
      const wasVisible = visible;
      show();
      // The throttle only applies while the controls are already up and counting down.
      if (wasVisible && now() - lastReset < ACTIVITY_THROTTLE_MS) return;
      restart();
    },
    setBlocked(next) {
      if (blocked === next) return;
      blocked = next;
      if (blocked) {
        clearTimeout(timer);
        timer = undefined;
        show();
      } else restart();
    },
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
