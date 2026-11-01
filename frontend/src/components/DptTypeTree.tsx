import React, { useMemo, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { dptKey, type FilterOption } from '../types/filters';
import { dptWidthLabel } from '../utils/dpt';
import { filterBranchOpen, setFilterBranch, useFilterBranchRevision } from '../utils/filterBranchExpansion';
import { BadgeColumn, BadgeColumnScope } from './BadgeColumn';
import { CheckMark } from './filterControls';
import { useRowMarks } from '../hooks/useRowMarks';
import { applyToggle, toggleGesture, type ToggleGesture } from '../utils/toggleClick';

interface DptTypeTreeProps {
  entries: FilterOption[];
  /** Active DPT filter keys: "1.001" for one subtype, bare "1" for a whole main type. */
  selected: string[];
  onChange: (keys: string[]) => void;
  counts?: Record<string, number>;
  /** Unfiltered buffer totals. A subtype label is highlighted when its count is at least 1. */
  bufferCounts?: Record<string, number>;
  /** Database totals. A gray badge uses these when the live count is exactly 0. */
  dbCounts?: Record<string, number>;
  /** Hide groups and subtypes whose telegram count is zero. */
  compact?: boolean;
  /** Hide subtypes that are not checked, and groups that then have nothing left. */
  checkedOnly?: boolean;
  /** Checked while Verdichten is on, including ones unchecked afterwards. */
  verdichtenKept?: Set<string>;
  /** Checked while Compact is on, including ones unchecked afterwards. */
  compactKept?: Set<string>;
  searchQuery: string;
  /** Shift or alt on a checkbox opens the telegram list. */
  onOpenList?: () => void;
  /** Bumped to drop every mouse selection in this tree. */
  markReset?: number;
}

type CheckState = 'checked' | 'partial' | 'unchecked';

export function dptBranchKey(main: number): string {
  return `dpt:${main}`;
}

/** One branch per main type present in the category. */
export function dptBranchKeys(entries: { main?: number | null }[]): string[] {
  const mains = new Set<number>();
  for (const entry of entries) {
    if (entry.main != null) mains.add(entry.main);
  }
  return [...mains].map(dptBranchKey);
}

const TriCheckbox: React.FC<{ state: CheckState; onClick: (e: React.MouseEvent) => void; label: string }> = ({ state, onClick, label }) => (
  <div
    role="checkbox"
    aria-checked={state === 'checked' ? true : state === 'partial' ? 'mixed' : false}
    aria-label={label}
    onClick={e => { e.stopPropagation(); onClick(e); }}
    style={{ display: 'flex', cursor: 'pointer' }}
  >
    <CheckMark state={state} />
  </div>
);

const CountBubble: React.FC<{ count: number; tone?: 'telegrams' | 'objects' | 'database' }> = ({ count, tone = 'telegrams' }) => {
  const objects = tone === 'objects';
  const database = tone === 'database';
  const live = !database && count > 0;
  return (
    <span
      title={database ? 'Telegrams in the database' : objects ? 'DPTs in the buffer' : 'Telegrams'}
      style={{
        height: '1rem', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.65rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1, minWidth: '1.8rem', textAlign: 'center',
        padding: '0 0.4rem', borderRadius: '999px', flexShrink: 0,
        background: live
          ? (objects ? 'rgba(168,85,247,0.15)' : 'rgba(99,102,241,0.15)')
          : 'var(--bg-tag)',
        color: live
          ? (objects ? 'var(--accent-secondary)' : 'var(--accent-primary)')
          : 'var(--text-dim)',
        border: live
          ? (objects ? '1px solid rgba(168,85,247,0.35)' : '1px solid rgba(99,102,241,0.3)')
          : '1px solid var(--border-color)',
      }}
    >
      {count}
    </span>
  );
};

/**
 * DPT filter as a tree of main data types (grouped by bit/byte width, #273).
 * The group checkbox toggles the bare main-type key, which the filter logic
 * (`matchesDpt`) already treats as "every subtype of this main type".
 */
export const DptTypeTree: React.FC<DptTypeTreeProps> = ({
  entries, selected, onChange, counts, bufferCounts, dbCounts, compact = false, checkedOnly = false, verdichtenKept, compactKept, searchQuery, onOpenList, markReset = 0,
}) => {
  // A click on the row remembers open or closed, including across reloads.
  // The first selection only decides the starting state, so checking a box later
  // does not expand or collapse the group. An active search still opens every
  // group, because its matches would be hidden, without storing that.
  useFilterBranchRevision();
  const initialOpen = useRef<Record<number, boolean>>({});

  const groups = useMemo(() => {
    const byMain = new Map<number, FilterOption[]>();
    for (const e of entries) {
      if (e.main == null) continue;
      const list = byMain.get(e.main) ?? [];
      list.push(e);
      byMain.set(e.main, list);
    }
    return [...byMain.entries()]
      .sort(([a], [b]) => a - b)
      .map(([main, opts]) => ({
        main,
        options: opts.sort((a, b) => (a.sub ?? 0) - (b.sub ?? 0)),
        childKeys: opts.map(o => dptKey(o.main!, o.sub)),
      }));
  }, [entries]);

  const inGroup = (main: number, key: string) => key === `${main}` || key.startsWith(`${main}.`);

  const groupState = (main: number, childKeys: string[]): CheckState => {
    if (selected.includes(`${main}`)) return 'checked';
    const picked = childKeys.filter(k => selected.includes(k)).length;
    if (picked === 0) return 'unchecked';
    return picked === childKeys.length ? 'checked' : 'partial';
  };

  const toggleGroup = (main: number, childKeys: string[]) => {
    const rest = selected.filter(k => !inGroup(main, k));
    onChange(groupState(main, childKeys) === 'checked' ? rest : [...rest, `${main}`]);
  };

  const covered = (key: string) => {
    const main = key.split('.')[0];
    return selected.includes(main) || selected.includes(key);
  };

  const applySubtypes = (targets: string[], turnOn: boolean) => {
    let next = [...selected];
    for (const { main, childKeys } of groups) {
      if (!next.includes(String(main))) continue;
      if (!childKeys.some(key => targets.includes(key))) continue;
      next = next.filter(key => key !== String(main));
      for (const key of childKeys) if (!next.includes(key)) next.push(key);
    }
    if (turnOn) {
      for (const key of targets) if (!next.includes(key)) next.push(key);
    } else {
      const drop = new Set(targets);
      next = next.filter(key => !drop.has(key));
    }
    onChange(next);
  };

  const finish = (gesture: ToggleGesture) => {
    if (gesture.kind === 'navigate' || (gesture.kind === 'toggle' && gesture.navigate)) onOpenList?.();
  };

  const commitGroup = (main: number, childKeys: string[], gesture: ToggleGesture) => {
    if (gesture.kind === 'none') return;
    if (gesture.kind === 'toggle') {
      const turnOn = groupState(main, childKeys) !== 'checked';
      if (gesture.exclusive) onChange(turnOn ? [`${main}`] : []);
      else toggleGroup(main, childKeys);
    }
    finish(gesture);
  };

  const commitSubtype = (key: string, gesture: ToggleGesture) => {
    if (gesture.kind === 'none') return;
    if (gesture.kind === 'toggle') {
      const targets = targetsFor(key);
      const turnOn = !covered(key);
      if (gesture.exclusive) onChange(applyToggle(selected, targets, turnOn, true));
      else applySubtypes(targets, turnOn);
    }
    finish(gesture);
  };

  const totalFor = (main: number, map?: Record<string, number>): number | undefined => {
    // The bare main key already totals every subtype. Adding the subtype keys
    // on top of it would count each telegram twice.
    if (!map) return undefined;
    const bare = map[`${main}`];
    if (bare !== undefined) return bare;
    return Object.entries(map)
      .filter(([k]) => k.startsWith(`${main}.`))
      .reduce((sum, [, c]) => sum + c, 0);
  };
  const groupCount = (main: number): number => totalFor(main, counts) ?? 0;
  const badgeMax = useMemo(() => {
    let max = 0;
    const take = (n: number | undefined) => { if (n !== undefined && n > max) max = n; };
    for (const map of [counts, dbCounts]) {
      if (!map) continue;
      for (const n of Object.values(map)) take(n);
    }
    for (const { main } of groups) {
      take(totalFor(main, counts));
      take(totalFor(main, dbCounts));
    }
    return max;
  }, [counts, dbCounts, groups]);

  const visibleKeys = groups.flatMap(({ main, options, childKeys }) => {
    const mainKey = String(main);
    const held = (set: Set<string> | undefined, key: string) => !!set && (set.has(key) || set.has(mainKey));
    const groupHeld = held(verdichtenKept, mainKey) || childKeys.some(key => held(verdichtenKept, key));
    if (compact && counts && groupCount(main) === 0 && !groupHeld) return [];
    return options.filter(o => {
      const key = dptKey(o.main!, o.sub);
      const checked = selected.includes(mainKey) || selected.includes(key);
      if (checkedOnly && !checked && !held(compactKept, key)) return false;
      if (compact && counts && (counts[key] ?? 0) === 0 && !held(verdichtenKept, key)) return false;
      return true;
    }).map(o => dptKey(o.main!, o.sub));
  });
  const { marked, lastMarked, markAt, targetsFor } = useRowMarks(visibleKeys, markReset);
  const markedSet = new Set(marked);

  const groupObjects = (main: number): number | undefined => {
    if (!counts) return undefined;
    const subtypes = Object.keys(counts).filter(key => key.startsWith(`${main}.`));
    if (subtypes.length > 0) return subtypes.length;
    return counts[`${main}`] !== undefined ? 1 : undefined;
  };

  return (
    <BadgeColumnScope max={badgeMax}>
    <div>
      {groups.map(({ main, options, childKeys }) => {
        const mainKey = String(main);
        const held = (set: Set<string> | undefined, key: string) => !!set && (set.has(key) || set.has(mainKey));
        const groupHeld = held(verdichtenKept, mainKey) || childKeys.some(key => held(verdichtenKept, key));
        if (compact && counts && groupCount(main) === 0 && !groupHeld) return null;
        const visibleOptions = options.filter(o => {
          const key = dptKey(o.main!, o.sub);
          const checked = selected.includes(mainKey) || selected.includes(key);
          if (checkedOnly && !checked && !held(compactKept, key)) return false;
          if (compact && counts && (counts[key] ?? 0) === 0 && !held(verdichtenKept, key)) return false;
          return true;
        });
        if (visibleOptions.length === 0) return null;
        const state = groupState(main, childKeys);
        if (initialOpen.current[main] === undefined) {
          initialOpen.current[main] = state !== 'unchecked';
        }
        const branchKey = dptBranchKey(main);
        const storedOpen = filterBranchOpen(branchKey, initialOpen.current[main]);
        const open = searchQuery !== '' || storedOpen;
        const width = dptWidthLabel(main);
        const objects = groupObjects(main);
        return (
          <div key={main}>
            <div
              onClick={() => {
                if (storedOpen !== !open) setFilterBranch(branchKey, !open);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.25rem',
                borderRadius: '5px', cursor: 'pointer', userSelect: 'none',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {open ? (
                <ChevronDown size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              ) : (
                <ChevronRight size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              )}
              <TriCheckbox state={state} onClick={e => commitGroup(main, childKeys, toggleGesture(e))} label={`DPT ${main}`} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{ minWidth: 0, flex: '0 1 auto' }}>
                  <div style={{
                    height: '1rem', lineHeight: '1rem',
                    fontSize: '0.75rem', fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: state !== 'unchecked' ? 700 : 400,
                    color: state !== 'unchecked' ? 'var(--accent-primary)' : 'var(--text-main)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{`DPT ${main}`}</div>
                  {width && (
                    <div style={{
                      fontSize: '0.65rem', color: 'var(--text-dim)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{width}</div>
                  )}
                </div>
                {objects !== undefined && <CountBubble count={objects} tone="objects" />}
              </div>
              <BadgeColumn>
                {counts && groupCount(main) > 0 && <CountBubble count={groupCount(main)} />}
                {counts && groupCount(main) === 0 && (totalFor(main, dbCounts) ?? 0) > 0 && (
                  <CountBubble count={totalFor(main, dbCounts) as number} tone="database" />
                )}
              </BadgeColumn>
            </div>

            {open && visibleOptions.map(o => {
              const key = dptKey(o.main!, o.sub);
              const checked = selected.includes(`${main}`) || selected.includes(key);
              const inBuffer = bufferCounts ? (bufferCounts[key] ?? 0) > 0 : false;
              const live = counts ? (counts[key] ?? 0) : undefined;
              const stored = dbCounts ? (dbCounts[key] ?? 0) : undefined;
              return (
                <div
                  key={key}
                  data-marked={markedSet.has(key) ? 'true' : undefined}
                  data-mark-anchor={markedSet.has(key) && lastMarked === key ? 'true' : undefined}
                  onClick={e => markAt(e, key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    padding: '0.3rem 0.25rem', paddingLeft: '1.55rem',
                    borderRadius: '5px', cursor: 'pointer', userSelect: 'none',
                    transition: 'background 0.15s',
                    background: markedSet.has(key) && lastMarked === key
                      ? 'color-mix(in srgb, var(--accent-primary) 34%, transparent)'
                      : markedSet.has(key)
                        ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)'
                        : undefined,
                  }}
                  onMouseEnter={e => { if (!markedSet.has(key)) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={e => { if (!markedSet.has(key)) (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <TriCheckbox
                    state={checked ? 'checked' : 'unchecked'}
                    onClick={e => {
                      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) e.preventDefault();
                      commitSubtype(key, toggleGesture(e));
                    }}
                    label={key}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div title={key} style={{
                      height: '1rem', lineHeight: '1rem',
                      fontSize: '0.75rem', fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: inBuffer ? 700 : 400,
                      color: inBuffer ? 'var(--accent-primary)' : 'var(--text-main)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{key}</div>
                    {o.label && o.label !== key && (
                      <div title={o.label} style={{
                        fontSize: '0.65rem', color: 'var(--text-dim)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{o.label}</div>
                    )}
                  </div>
                  <BadgeColumn>
                    {live !== undefined && live > 0 && <CountBubble count={live} />}
                    {live === 0 && (stored ?? 0) > 0 && <CountBubble count={stored as number} tone="database" />}
                  </BadgeColumn>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
    </BadgeColumnScope>
  );
};
