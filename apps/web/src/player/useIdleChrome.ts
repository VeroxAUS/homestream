import { useEffect, useRef, type RefObject } from 'react';
import { createIdleHider, type IdleHider } from './idleHider';

/** Marks the top bar and control bar: the controls never hide while the pointer is over one of them. */
export const BAR_ATTRIBUTE = 'data-chrome-bar';
const MIN_MOVE_PX = 4;

function focusVisibleIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || !target.closest(`[${BAR_ATTRIBUTE}]`)) return false;
  try {
    return target.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * Hides the overlays after 3 s without input by setting `data-chrome="hidden"` on the stage; CSS does the fade, so
 * playing never re-renders anything. `blocked` keeps them up (paused, buffering, error, menu or info open).
 */
export function useIdleChrome(stageRef: RefObject<HTMLElement | null>, blocked: boolean): void {
  const hider = useRef<IdleHider | null>(null);
  const flags = useRef({ external: blocked, hover: false, focus: false });

  const apply = () => {
    const { external, hover, focus } = flags.current;
    hider.current?.setBlocked(external || hover || focus);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const instance = createIdleHider({
      onChange: (visible) => {
        stage.dataset.chrome = visible ? 'visible' : 'hidden';
      },
    });
    hider.current = instance;
    stage.dataset.chrome = 'visible';
    let x = 0;
    let y = 0;
    const onMove = (event: MouseEvent) => {
      if (Math.hypot(event.clientX - x, event.clientY - y) < MIN_MOVE_PX) return;
      x = event.clientX;
      y = event.clientY;
      instance.activity();
    };
    const onActivity = () => instance.activity();
    const onOver = (event: MouseEvent) => {
      flags.current.hover = event.target instanceof Element && event.target.closest(`[${BAR_ATTRIBUTE}]`) !== null;
      apply();
    };
    const onLeave = () => {
      flags.current.hover = false;
      apply();
    };
    const onFocusIn = (event: FocusEvent) => {
      flags.current.focus = focusVisibleIn(event.target);
      apply();
    };
    const onFocusOut = () => {
      flags.current.focus = false;
      apply();
    };
    stage.addEventListener('mousemove', onMove, { passive: true });
    stage.addEventListener('mousedown', onActivity, { passive: true });
    stage.addEventListener('touchstart', onActivity, { passive: true });
    stage.addEventListener('mouseover', onOver, { passive: true });
    stage.addEventListener('mouseleave', onLeave, { passive: true });
    stage.addEventListener('focusin', onFocusIn);
    stage.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onActivity, true);
    apply();
    instance.activity();
    return () => {
      stage.removeEventListener('mousemove', onMove);
      stage.removeEventListener('mousedown', onActivity);
      stage.removeEventListener('touchstart', onActivity);
      stage.removeEventListener('mouseover', onOver);
      stage.removeEventListener('mouseleave', onLeave);
      stage.removeEventListener('focusin', onFocusIn);
      stage.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onActivity, true);
      instance.dispose();
      hider.current = null;
      stage.dataset.chrome = 'visible';
    };
  }, [stageRef]);

  useEffect(() => {
    flags.current.external = blocked;
    apply();
    if (!blocked) hider.current?.activity();
  }, [blocked]);
}
