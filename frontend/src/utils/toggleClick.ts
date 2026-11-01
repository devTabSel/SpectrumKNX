import { applyMembership } from './rowMarks';

/**
 * What a toggle click does.
 * Plain: exclusive toggle, no navigation.
 * Ctrl/Cmd: additive toggle, no navigation.
 * Shift: exclusive toggle and navigate. Ctrl/Cmd+Shift: additive toggle and navigate.
 * Alt: navigate only.
 * Any other combination does nothing.
 */
export type ToggleGesture =
  | { kind: 'none' }
  | { kind: 'navigate' }
  | { kind: 'toggle'; exclusive: boolean; navigate: boolean };

export const PLAIN_TOGGLE: ToggleGesture = { kind: 'toggle', exclusive: true, navigate: false };

export function toggleGesture(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): ToggleGesture {
  const ctrl = e.ctrlKey || e.metaKey;
  const alt = e.altKey;
  const shift = e.shiftKey;
  if (alt) return ctrl || shift ? { kind: 'none' } : { kind: 'navigate' };
  if (shift) return { kind: 'toggle', exclusive: !ctrl, navigate: true };
  if (ctrl) return { kind: 'toggle', exclusive: false, navigate: false };
  return PLAIN_TOGGLE;
}

/** Replace the set with the targets, or leave every other id as it is. Turning off exclusively clears the set. */
export function applyToggle(
  current: readonly string[],
  targets: readonly string[],
  turnOn: boolean,
  exclusive: boolean,
): string[] {
  if (exclusive) return turnOn ? [...targets] : [];
  return applyMembership(current, targets, turnOn);
}

/**
 * Direction follows the clicked id. A group button has no clicked id and turns
 * on unless every address in the group is already on.
 */
export function toggleTurnOn(current: readonly string[], addresses: readonly string[], clicked?: string): boolean {
  if (clicked !== undefined) return !current.includes(clicked);
  const have = new Set(current);
  return !(addresses.length > 0 && addresses.every(id => have.has(id)));
}

export function toggleTitle(action: string, panel: string): string {
  return `${action}. Ctrl-click keeps the others. Shift-click also opens ${panel}. Alt-click only opens ${panel}.`;
}

/** Read the gesture and pass it as the last argument. A useless combination calls nothing. */
export function invokeToggle<A extends unknown[]>(
  e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; preventDefault: () => void },
  fn: ((...args: [...A, gesture: ToggleGesture]) => void) | undefined,
  ...args: A
): void {
  if (!fn) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) e.preventDefault();
  const gesture = toggleGesture(e);
  if (gesture.kind === 'none') return;
  fn(...args, gesture);
}
