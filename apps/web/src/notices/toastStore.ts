import { useSyncExternalStore } from 'react';

type ToastKind = 'info' | 'ready' | 'error';

interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastSpec {
  kind: ToastKind;
  message: string;
  /** Second, smaller line. */
  detail?: string;
  actions: ToastAction[];
  /** `null` keeps the toast until it is acted on or dismissed. */
  autoDismissMs: number | null;
  /** Held back while the player is open and shown when it closes. */
  deferWhilePlaying?: boolean;
}

export interface Toast extends ToastSpec {
  id: number;
}

export const INFO_TOAST_MS = 5000;
export const READY_TOAST_MS = 10_000;

let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** One toast at a time: a new one replaces the one on screen. Returns its id. */
export function showToast(spec: ToastSpec): number {
  current = { ...spec, id: nextId++ };
  emit();
  return current.id;
}

/** Dismisses the toast with this id, or whatever is shown when no id is given. */
export function dismissToast(id?: number): void {
  if (current === null || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToast(): Toast | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** Clears the toast; tests start from a clean state. */
export function resetToasts(): void {
  current = null;
  emit();
}
