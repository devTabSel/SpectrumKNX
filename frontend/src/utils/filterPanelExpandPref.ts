import { useCallback, useState } from 'react';
import { getPref, setPref } from './prefs';

/**
 * Open/closed state of the telegram-table side panel.
 *
 * Sections store `'1'` or `'0'` under their own key. Each tree stores one JSON
 * object: `expanded` is the set of node ids the user opened, `collapsed` the
 * set the user closed. A node in neither set keeps its default (and, for the
 * DPT tree, search may still open it). Search-driven expansion is never written.
 * A missing or malformed value falls back to those defaults.
 */

export const FILTER_PANEL_SECTION_PREF_PREFIX = 'filterPanel.section.';

export const FILTER_SECTION_TIME_DELTA = 'time-delta-context';
export const FILTER_SECTION_SOURCE = 'source';
export const FILTER_SECTION_TARGET = 'target';
export const FILTER_SECTION_TYPE = 'type';
export const FILTER_SECTION_DIRECTION = 'direction';
export const FILTER_SECTION_DPT = 'dpt';

export const SOURCE_TREE_EXPANDED_PREF = 'filterPanel.tree.source';
export const TARGET_TREE_EXPANDED_PREF = 'filterPanel.tree.target';
export const DPT_TREE_EXPANDED_PREF = 'filterPanel.tree.dpt';

export interface TreeExpandPref {
  expanded: Set<string>;
  collapsed: Set<string>;
}

export function sectionOpenPrefKey(sectionId: string): string {
  return FILTER_PANEL_SECTION_PREF_PREFIX + sectionId;
}

/** `'1'` / `'0'` win. Anything else, including a missing key, is not a preference. */
export function readSectionOpen(sectionId: string, defaultOpen: boolean): boolean {
  const raw = getPref(sectionOpenPrefKey(sectionId));
  if (raw === '1') return true;
  if (raw === '0') return false;
  return defaultOpen;
}

export function writeSectionOpen(sectionId: string, open: boolean): void {
  setPref(sectionOpenPrefKey(sectionId), open ? '1' : '0');
}

function stringSet(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    ids.push(item);
  }
  return new Set(ids);
}

function withoutContradictions(expanded: Set<string>, collapsed: Set<string>): TreeExpandPref {
  for (const id of [...expanded]) {
    if (collapsed.has(id)) {
      expanded.delete(id);
      collapsed.delete(id);
    }
  }
  return { expanded, collapsed };
}

/**
 * `null` when nothing usable is stored.
 * A bare JSON array is the expanded-id set (no explicit collapses).
 * An object must carry `expanded` and `collapsed` string arrays.
 */
export function readTreeExpand(key: string): TreeExpandPref | null {
  const raw = getPref(key);
  if (raw == null || raw.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const expanded = stringSet(parsed);
      if (!expanded) return null;
      return { expanded, collapsed: new Set() };
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const expanded = stringSet(obj.expanded);
    const collapsed = stringSet(obj.collapsed);
    if (!expanded || !collapsed) return null;
    return withoutContradictions(expanded, collapsed);
  } catch {
    return null;
  }
}

export function writeTreeExpand(key: string, pref: TreeExpandPref): void {
  const normalized = withoutContradictions(new Set(pref.expanded), new Set(pref.collapsed));
  setPref(key, JSON.stringify({
    expanded: [...normalized.expanded].sort(),
    collapsed: [...normalized.collapsed].sort(),
  }));
}

/**
 * What the row should show. An explicit collapse beats search and the default;
 * an explicit expand beats the default. Search only fills in when the user
 * has not chosen.
 */
export function displayedTreeNode(
  pref: TreeExpandPref | null,
  id: string,
  defaultOpen: boolean,
  searchForced: boolean,
): boolean {
  if (pref?.collapsed.has(id)) return false;
  if (pref?.expanded.has(id)) return true;
  return defaultOpen || searchForced;
}

/**
 * Record one manual click. Opening or closing back to the default drops the
 * override. Closing a node that search forced open is stored as collapsed so
 * the next search does not open it again.
 */
export function toggleTreeNode(
  pref: TreeExpandPref | null,
  id: string,
  defaultOpen: boolean,
  displayedOpen: boolean,
  searchForced: boolean,
): TreeExpandPref {
  const expanded = new Set(pref?.expanded);
  const collapsed = new Set(pref?.collapsed);
  expanded.delete(id);
  collapsed.delete(id);
  const nextOpen = !displayedOpen;
  const dismissedSearch = searchForced && !nextOpen;
  if (dismissedSearch || nextOpen !== defaultOpen) {
    if (nextOpen) expanded.add(id);
    else collapsed.add(id);
  }
  return { expanded, collapsed };
}

/** In-memory expand state, mirrored to `prefKey` when one is given. */
export function useTreeExpand(prefKey?: string) {
  const [pref, setPrefState] = useState<TreeExpandPref | null>(() =>
    prefKey ? readTreeExpand(prefKey) : null,
  );

  const isOpen = useCallback((id: string, defaultOpen: boolean, searchForced = false) => (
    displayedTreeNode(pref, id, defaultOpen, searchForced)
  ), [pref]);

  const toggle = useCallback((
    id: string,
    defaultOpen: boolean,
    displayedOpen: boolean,
    searchForced: boolean,
  ) => {
    setPrefState(prev => {
      const next = toggleTreeNode(prev, id, defaultOpen, displayedOpen, searchForced);
      if (prefKey) writeTreeExpand(prefKey, next);
      return next;
    });
  }, [prefKey]);

  return { isOpen, toggle };
}
