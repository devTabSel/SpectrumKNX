import type { FilterOption } from '../types/filters';
import type { Telegram } from '../hooks/useWebSocket';
import {
  dptDesignation,
  dptKeyLabel,
  dptUnit,
} from './dpt';
import { formatDpt, parseDptKey } from './knxSend';

/** Project GA datatype used when a telegram carries no DPT of its own. */
export interface ProjectGaDpt {
  main: number;
  sub?: number | null;
  label?: string | null;
}

export interface EffectiveTelegramDpt {
  key: string;
  main: number;
  sub: number | null;
  unit: string;
  name: string;
  /** True when the DPT came from the project map, not the telegram row. */
  fromProject: boolean;
}

/** Build address → project DPT from filter-panel targets (ETS project GAs). */
export function projectDptByAddress(
  targets: readonly FilterOption[],
): Map<string, ProjectGaDpt> {
  const m = new Map<string, ProjectGaDpt>();
  for (const t of targets) {
    if (!t.address || t.main == null) continue;
    m.set(t.address, { main: t.main, sub: t.sub ?? null, label: t.label ?? t.name ?? null });
  }
  return m;
}

/**
 * Prefer the telegram's own DPT; otherwise the project GA map for
 * `target_address`. Null when neither has a datatype.
 */
export function effectiveTelegramDpt(
  t: Pick<Telegram, 'dpt' | 'dpt_main' | 'dpt_sub' | 'dpt_name' | 'unit' | 'target_address'>,
  projectByGa?: Map<string, ProjectGaDpt> | null,
): EffectiveTelegramDpt | null {
  if (t.dpt_main != null) {
    const key = t.dpt?.trim()
      || dptKeyLabel(t.dpt_main, t.dpt_sub)
      || formatDpt(t.dpt_main, t.dpt_sub);
    if (!key) return null;
    const unit = (t.unit ?? '').trim() || dptUnit(key, t.dpt_name);
    const name = (t.dpt_name ?? '').trim() || dptDesignation(key);
    return {
      key,
      main: t.dpt_main,
      sub: t.dpt_sub ?? null,
      unit,
      name,
      fromProject: false,
    };
  }

  // Live payloads sometimes set `dpt` without numeric main/sub.
  const fromString = parseDptKey(t.dpt);
  if (fromString) {
    const key = t.dpt!.trim();
    const unit = (t.unit ?? '').trim() || dptUnit(key, t.dpt_name);
    const name = (t.dpt_name ?? '').trim() || dptDesignation(key);
    return {
      key,
      main: fromString.main,
      sub: fromString.sub,
      unit,
      name,
      fromProject: false,
    };
  }

  const proj = projectByGa?.get(t.target_address);
  if (!proj || proj.main == null) return null;
  const key = formatDpt(proj.main, proj.sub ?? undefined);
  if (!key) return null;
  const unit = dptUnit(key, proj.label);
  const name = dptDesignation(key, proj.label);
  return {
    key,
    main: proj.main,
    sub: proj.sub ?? null,
    unit,
    name,
    fromProject: true,
  };
}
