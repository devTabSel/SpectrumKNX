import { useSyncExternalStore } from 'react';
import { getPref, setPref } from './prefs';

// Colours the user gives to group addresses and devices in the focus lists, so
// their telegrams can be told apart in the list (#509). A telegram uses its
// group-address colour when it has one, and the sending device's colour only
// otherwise.
//
// Module scope mirrored to the stored preferences: the filter panel sets a
// colour and the telegram table reads it, in the Group Monitor and in History
// Search alike, without the state being threaded through both.

/** Offered in this order; distinct on the light and the dark theme. */
export const TARGET_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#eab308', // yellow
  '#22c55e', // green
  '#a855f7', // purple
  '#f97316', // orange
  '#14b8a6', // teal
] as const;

/** Gray stripe of a highlighted row the focus lists left uncoloured. The slate itself, so its brightness sits with the solid focus-list colours. */
export const UNCOLORED_MARK_STRIPE = 'var(--text-dim)';
/** Stripe of a highlighted context row. Solid amber, the same weight as a focus-list colour. */
export const CONTEXT_MARK_STRIPE = 'var(--warning, #f59e0b)';

const PREF = 'targetColors';

const load = (): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(getPref(PREF) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] => (TARGET_COLORS as readonly unknown[]).includes(entry[1])
        )
      );
    }
  } catch {
    // Ignore a malformed stored value
  }
  return {};
};

let colors: Record<string, string> = load();
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getSnapshot = () => colors;

const update = (next: Record<string, string>) => {
  colors = next;
  setPref(PREF, JSON.stringify(next));
  listeners.forEach(l => l());
};

/**
 * The colour a click on an address's swatch leads to: from none to the first
 * colour no other address in `inUse` has yet, then on through the palette, and
 * after the last one back to none (null).
 */
export function nextTargetColor(
  current: Record<string, string>,
  address: string,
  inUse: readonly string[] = Object.keys(current),
): string | null {
  const own = current[address];
  if (!own) {
    const taken = new Set(inUse.filter(a => a !== address).map(a => current[a]));
    return TARGET_COLORS.find(c => !taken.has(c)) ?? TARGET_COLORS[0];
  }
  const at = TARGET_COLORS.indexOf(own as (typeof TARGET_COLORS)[number]);
  return at === TARGET_COLORS.length - 1 ? null : TARGET_COLORS[at + 1];
}

/** The colour painted on a telegram: its group address, else its sending device. */
export function telegramColor(
  colors: Record<string, string>,
  telegram: { target_address: string; source_address: string },
): string | undefined {
  return colors[telegram.target_address] ?? colors[telegram.source_address];
}

/** Removes every colour whose address matches. One update for the whole set. */
export function clearTargetColors(match: (address: string) => boolean): void {
  const next: Record<string, string> = {};
  let changed = false;
  for (const [address, color] of Object.entries(colors)) {
    if (match(address)) changed = true;
    else next[address] = color;
  }
  if (changed) update(next);
}

/** Sets or, with null, removes the colour of a group address or device. */
export function setTargetColor(address: string, color: string | null): void {
  const next = { ...colors };
  if (color === null) delete next[address];
  else next[address] = color;
  update(next);
}

/** The colours by group address; re-renders the caller when one changes. */
export function useTargetColors(): Record<string, string> {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Test helper: forget every colour. */
export const resetTargetColors = () => update({});
