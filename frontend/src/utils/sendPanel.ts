import { useSyncExternalStore } from 'react';

let open = false;
let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: boolean) {
  if (open === next) return;
  open = next;
  version += 1;
  listeners.forEach(listener => listener());
}

export function useSendPanelOpen(): boolean {
  useSyncExternalStore(subscribe, () => version);
  return open;
}

export function setSendPanelOpen(next: boolean) {
  publish(next);
}

export function toggleSendPanel() {
  publish(!open);
}
