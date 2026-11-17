import { createContext, useContext } from 'react';
import { classifyGotoTarget, type GotoPlacement } from './gotoTarget';

export type GotoScope = 'live' | 'history';

export interface GotoBufferValue {
  scope: GotoScope;
  oldestMs: number | null;
  newestMs: number | null;
}

export const GotoBufferContext = createContext<GotoBufferValue>({
  scope: 'live',
  oldestMs: null,
  newestMs: null,
});

export function useGotoBuffer(): GotoBufferValue {
  return useContext(GotoBufferContext);
}

/** Icon chrome for a jump whose target time is known. */
export type GotoIconTone = 'ready' | 'outside' | 'missing';

export const OUTSIDE_GOTO_TITLE = 'Ctrl-Klick lädt nach';
export const MISSING_GOTO_TITLE = 'Ziel ausgefiltert/nicht vorhanden';

/**
 * Live targets outside the buffer need Ctrl to load. History has no reload:
 * a target outside the loaded span is missing (filtered out or absent).
 * Unknown bounds stay `ready` so a control without a buffer span keeps working.
 */
export function gotoIconTone(targetMs: number | null, buf: GotoBufferValue): GotoIconTone {
  if (targetMs == null || !Number.isFinite(targetMs)) return 'ready';
  const place: GotoPlacement = classifyGotoTarget(targetMs, buf.oldestMs, buf.newestMs);
  if (place === 'inside' || place === 'unknown') return 'ready';
  return buf.scope === 'history' ? 'missing' : 'outside';
}
