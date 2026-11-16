// Shared tristate for SpectrumKNX checkboxes and the Time-Delta-Context header.
// off → all on; on → all off; mixed → all off; Ctrl/Cmd on mixed → all on.

export type TriState = 'none' | 'some' | 'all';

/** Next state for a plain click or a Ctrl/Cmd-click. Alt is not a tristate transition. */
export function nextTriState(state: TriState, opts?: { ctrl?: boolean }): TriState {
  if (state === 'none') return 'all';
  if (state === 'all') return 'none';
  return opts?.ctrl ? 'all' : 'none';
}

export function triStateAriaChecked(state: TriState): boolean | 'mixed' {
  if (state === 'all') return true;
  if (state === 'some') return 'mixed';
  return false;
}
