import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AddressActions } from './telegramCell';
import type { FilterOption } from '../types/filters';
import { setFilterBranches, useFilterBranch } from '../utils/filterBranchExpansion';
import { BadgeColumn, BadgeColumnScope } from './BadgeColumn';
import { CheckMark } from './filterControls';
import { matchesAnyText } from '../utils/quickFilter';
import { applyToggle, toggleGesture, type ToggleGesture } from '../utils/toggleClick';
import { useRowMarks } from '../hooks/useRowMarks';

interface KnxAddressTreeProps {
  entries: FilterOption[];
  selected: string[];
  /** Group names keyed by address prefix (e.g. {"0": "Zentral", "0/1": "Wetter"} or {"1": "", "1.0": "EG"}) */
  groupNames: Record<string, string>;
  /** separator: '/' for GAs, '.' for PAs */
  separator: '/' | '.';
  onToggle: (addresses: string[]) => void;
  /** Filtered live counts. A zero hides the badge. */
  counts?: Record<string, number>;
  /** Every telegram in the buffer for this address, ignoring the panel filter. Highlights the label. */
  bufferCounts?: Record<string, number>;
  /** Database totals for this address. The gray badge uses these. */
  dbCounts?: Record<string, number>;
  /** Hide leaves and branches whose telegram count is zero. */
  compact?: boolean;
  /** Hide leaves that are not checked. Branches with none left disappear too. */
  checkedOnly?: boolean;
  /** Checked while Verdichten is on, including ones unchecked afterwards. */
  verdichtenKept?: Set<string>;
  /** Checked while Compact is on, including ones unchecked afterwards. */
  compactKept?: Set<string>;
  searchQuery: string;
  onLastSeen?: (address: string | string[], gesture: ToggleGesture, clicked?: string) => void;
  /** Addresses whose focus-list checkbox is on. */
  focused?: readonly string[];
  /** Toggles these addresses in the focus list. Navigation opens the focus list. */
  onFocusToggle?: (addresses: string[], turnOn: boolean, gesture: ToggleGesture) => void;
  /** Addresses whose focus-list filter toggle is on. */
  filtered?: readonly string[];
  onFilterToggle?: (addresses: string[], turnOn: boolean, gesture: ToggleGesture) => void;
  /** Addresses whose focus-list visualize toggle is on. */
  visualized?: readonly string[];
  onVisualizeToggle?: (addresses: string[], turnOn: boolean, gesture: ToggleGesture) => void;
  /** Addresses whose focus-list last-seen toggle is on. */
  lastSeen?: readonly string[];
  /** Shift or alt on a filter checkbox opens the telegram list. */
  onOpenList?: () => void;
  /** Bumped to drop every mouse selection in this tree. */
  markReset?: number;
  writeEnabled?: boolean;
}

type CheckState = 'checked' | 'partial' | 'unchecked';

export function knxBranchKey(separator: '/' | '.', id: string): string {
  return `${separator === '/' ? 'ga' : 'pa'}:${id}`;
}

/** Every main and middle group a category would draw for these addresses. */
export function knxBranchKeys(addresses: Iterable<string | null | undefined>, separator: '/' | '.'): string[] {
  const keys = new Set<string>();
  for (const address of addresses) {
    if (!address) continue;
    const parts = address.split(separator);
    if (!parts[0]) continue;
    keys.add(knxBranchKey(separator, parts[0]));
    if (parts.length >= 2 && parts[1]) keys.add(knxBranchKey(separator, `${parts[0]}${separator}${parts[1]}`));
  }
  return [...keys];
}

function getCheckState(leafAddresses: string[], selected: string[]): CheckState {
  const count = leafAddresses.filter(a => selected.includes(a)).length;
  if (count === 0) return 'unchecked';
  if (count === leafAddresses.length) return 'checked';
  return 'partial';
}

interface TriCheckboxProps {
  state: CheckState;
  onClick: (e: React.MouseEvent) => void;
  label?: string;
}

const TriCheckbox: React.FC<TriCheckboxProps> = ({ state, onClick, label }) => (
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

interface LeafRowProps {
  address: string;
  name: string;
  dptMain?: number | null;
  dptSub?: number | null;
  checked: boolean;
  count?: number;
  /** Unfiltered buffer total. The address is highlighted when this is at least 1. */
  bufferCount?: number;
  /** Database total for this address. Shown in gray when the live count is exactly 0. */
  dbCount?: number;
  onToggle: (e: React.MouseEvent) => void;
  onMark: (e: React.MouseEvent) => void;
  marked?: boolean;
  anchor?: boolean;
  onLastSeen?: (gesture: ToggleGesture) => void;
  focused?: boolean;
  onFocusToggle?: (gesture: ToggleGesture) => void;
  filterOn?: boolean;
  onFilter?: (gesture: ToggleGesture) => void;
  visualizeOn?: boolean;
  onVisualize?: (gesture: ToggleGesture) => void;
  lastSeenOn?: boolean;
  isGA?: boolean;
  writeEnabled?: boolean;
}

const LeafRow: React.FC<LeafRowProps> = ({
  address, name, dptMain, dptSub, checked, count, bufferCount, dbCount, onToggle, onMark, marked = false, anchor = false,
  onLastSeen, focused = false, onFocusToggle, filterOn = false, onFilter, visualizeOn = false, onVisualize, lastSeenOn = false, isGA, writeEnabled,
}) => {
  const [hovered, setHovered] = useState(false);
  const inBuffer = (bufferCount ?? 0) > 0;
  const iconsVisible = hovered || checked || focused;
  return (
    <div
      data-marked={marked ? 'true' : undefined}
      data-mark-anchor={anchor ? 'true' : undefined}
      onClick={onMark}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.25rem',
        borderRadius: '5px', cursor: 'pointer', userSelect: 'none',
        transition: 'background 0.15s',
        background: anchor
          ? 'color-mix(in srgb, var(--accent-primary) 34%, transparent)'
          : marked
            ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)'
            : hovered
              ? 'var(--bg-hover)'
              : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <TriCheckbox
        state={checked ? 'checked' : 'unchecked'}
        label={address}
        onClick={onToggle}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div title={address} style={{
          height: '1rem', lineHeight: '1rem',
          fontSize: '0.75rem', fontFamily: "'JetBrains Mono', monospace",
          fontWeight: inBuffer ? 700 : 400,
          color: inBuffer ? 'var(--accent-primary)' : 'var(--text-main)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{address}</div>
        {name && (
          <div title={name} style={{
            fontSize: '0.65rem', color: 'var(--text-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{name}</div>
        )}
      </div>
      <span style={{ display: 'inline-flex', opacity: iconsVisible || focused || filterOn || visualizeOn || lastSeenOn ? 1 : 0, transition: 'opacity 0.15s' }}>
        <AddressActions
          inline
          mode={isGA ? 'ga' : 'pa'}
          address={address}
          name={name}
          dptMain={dptMain}
          dptSub={dptSub}
          focusOn={focused}
          filterOn={filterOn}
          visualizeOn={visualizeOn}
          lastSeenOn={lastSeenOn}
          onFocus={onFocusToggle ? (_address, _mode, gesture) => onFocusToggle(gesture) : undefined}
          onFilter={onFilter ? (_address, _mode, gesture) => onFilter(gesture) : undefined}
          onVisualize={onVisualize ? (_address, _mode, gesture) => onVisualize(gesture) : undefined}
          onLastSeen={onLastSeen ? (_address, _mode, gesture) => onLastSeen(gesture) : undefined}
          canSend={writeEnabled}
        />
      </span>
      <BadgeColumn>
        {(count ?? 0) > 0 && <CountBubble count={count ?? 0} />}
        {count === 0 && (dbCount ?? 0) > 0 && <CountBubble count={dbCount as number} tone="database" />}
      </BadgeColumn>
    </div>
  );
};

const CountBubble: React.FC<{ count: number; tone?: 'telegrams' | 'objects' | 'database'; title?: string }> = ({ count, tone = 'telegrams', title }) => {
  const objects = tone === 'objects';
  const database = tone === 'database';
  return (
    <span
      title={title ?? (database ? 'Telegrams in the database' : objects ? 'Addresses in the buffer' : 'Telegrams')}
      style={{
        height: '1rem', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.65rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1, minWidth: '1.8rem', textAlign: 'center',
        padding: '0 0.4rem', borderRadius: '999px',
        background: database || count === 0
          ? 'var(--bg-tag)'
          : (objects ? 'rgba(168,85,247,0.15)' : 'rgba(99,102,241,0.15)'),
        color: database || count === 0
          ? 'var(--text-dim)'
          : (objects ? 'var(--accent-secondary)' : 'var(--accent-primary)'),
        border: database || count === 0
          ? '1px solid var(--border-color)'
          : (objects ? '1px solid rgba(168,85,247,0.35)' : '1px solid rgba(99,102,241,0.3)'),
        flexShrink: 0,
      }}
    >{count}</span>
  );
};

/**
 * Live telegram count for a group and everything under it. Keys are full
 * addresses, so a group total is the sum of every count whose address is the
 * group itself or lies strictly below it.
 */
function subtreeCount(prefix: string, separator: string, counts?: Record<string, number>): number | undefined {
  if (!counts) return undefined;
  const head = `${prefix}${separator}`;
  let sum = 0;
  for (const [address, n] of Object.entries(counts)) {
    if (address !== prefix && !address.startsWith(head)) continue;
    sum += n;
  }
  return sum;
}

/** How many distinct addresses under a group are present in the buffer. */
function subtreeObjects(prefix: string, separator: string, counts?: Record<string, number>): number | undefined {
  if (!counts) return undefined;
  const head = `${prefix}${separator}`;
  let n = 0;
  for (const address of Object.keys(counts)) {
    if (address === prefix || address.startsWith(head)) n++;
  }
  return n > 0 ? n : undefined;
}

interface GroupNodeProps {
  label: string;
  sublabel?: string;
  leafAddresses: string[];
  selected: string[];
  children: React.ReactNode;
  /** Stable id, e.g. `ga:1/2`. The open state stored under it survives remounts. */
  branchKey: string;
  /** Branch ids under this node. Ctrl/cmd-click applies this node's new open state to them. */
  descendantKeys?: string[];
  defaultOpen?: boolean;
  onToggleAll: (e: React.MouseEvent) => void;
  count?: number;
  /** Database total under this branch. Shown when the live count is exactly 0. */
  dbCount?: number;
  objects?: number;
}

const GroupNode: React.FC<GroupNodeProps> = ({ label, sublabel, leafAddresses, selected, children, branchKey, descendantKeys = [], defaultOpen = true, onToggleAll, count, dbCount, objects }) => {
  const [open, setOpen] = useFilterBranch(branchKey, defaultOpen);
  const state = getCheckState(leafAddresses, selected);
  const toggle = (e: React.MouseEvent) => {
    const next = !open;
    // Ctrl/cmd applies the same open or closed state to every branch underneath.
    if ((e.ctrlKey || e.metaKey) && descendantKeys.length > 0) {
      setFilterBranches(Object.fromEntries([[branchKey, next], ...descendantKeys.map(key => [key, next])]));
      return;
    }
    setOpen(next);
  };
  const toggleTitle = descendantKeys.length > 0
    ? 'Click to expand or collapse · ctrl/cmd-click does the same for every branch underneath'
    : undefined;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.3rem 0.25rem', borderRadius: '5px', cursor: 'pointer',
          userSelect: 'none',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div onClick={toggle} title={toggleTitle} style={{ color: 'var(--text-dim)', flexShrink: 0, display: 'flex' }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
        <TriCheckbox state={state} onClick={onToggleAll} label={label} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }} onClick={toggle} title={toggleTitle}>
          <div style={{ minWidth: 0, flex: '0 1 auto' }}>
            <div title={label} style={{
              height: '1rem', lineHeight: '1rem',
              fontSize: '0.75rem',
              fontWeight: state !== 'unchecked' ? 700 : 400,
              color: state !== 'unchecked' ? 'var(--accent-primary)' : 'var(--text-main)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{label}</div>
            {sublabel && (
              <div title={sublabel} style={{
                fontSize: '0.65rem', color: 'var(--text-dim)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{sublabel}</div>
            )}
          </div>
          {objects !== undefined && <CountBubble count={objects} tone="objects" />}
        </div>
        <BadgeColumn>
          {count !== undefined && count > 0 && <CountBubble count={count} />}
          {count === 0 && (dbCount ?? 0) > 0 && <CountBubble count={dbCount as number} tone="database" />}
        </BadgeColumn>
      </div>
      {open && <div style={{ paddingLeft: '1.25rem' }}>{children}</div>}
    </div>
  );
};

export const KnxAddressTree: React.FC<KnxAddressTreeProps> = ({
  entries, selected, groupNames, separator, onToggle, counts, bufferCounts, dbCounts, compact = false, checkedOnly = false, verdichtenKept, compactKept, searchQuery, onLastSeen, focused = [], onFocusToggle, filtered = [], onFilterToggle, visualized = [], onVisualizeToggle, lastSeen = [], onOpenList, markReset = 0, writeEnabled,
}) => {

  // Build tree structure: level1 → level2 → leaves
  const tree = useMemo(() => {
    const map = new Map<string, Map<string, FilterOption[]>>();
    for (const entry of entries) {
      const parts = entry.address!.split(separator);
      const l1 = parts[0];
      const l2 = parts.length >= 2 ? `${parts[0]}${separator}${parts[1]}` : l1;
      if (!map.has(l1)) map.set(l1, new Map());
      const l1map = map.get(l1)!;
      if (!l1map.has(l2)) l1map.set(l2, []);
      l1map.get(l2)!.push(entry);
    }
    return map;
  }, [entries, separator]);

  // The badge column fits the widest count this tree draws: a leaf, or a group total.
  const badgeMax = useMemo(() => {
    let max = 0;
    const take = (n: number | undefined) => { if (n !== undefined && n > max) max = n; };
    const prefixes = new Set<string>();
    for (const entry of entries) {
      if (!entry.address) continue;
      const parts = entry.address.split(separator);
      prefixes.add(parts[0]);
      if (parts.length >= 2) prefixes.add(`${parts[0]}${separator}${parts[1]}`);
      take(counts?.[entry.address]);
      take(dbCounts?.[entry.address]);
    }
    for (const prefix of prefixes) {
      take(subtreeCount(prefix, separator, counts));
      take(subtreeCount(prefix, separator, dbCounts));
    }
    return max;
  }, [entries, separator, counts, dbCounts]);

  // Search narrows the labels. Compact drops entries whose telegram badge is 0;
  // a missing count is that zero while counts are loaded.
  const shown = (entry: FilterOption) => {
    if (!matchesAnyText(searchQuery, entry.address, entry.name)) return false;
    if (compact && counts && (counts[entry.address!] ?? 0) === 0 && !verdichtenKept?.has(entry.address!)) return false;
    if (checkedOnly && !selected.includes(entry.address!) && !compactKept?.has(entry.address!)) return false;
    return true;
  };

  const visibleOrder = useMemo(() => {
    const order: string[] = [];
    const visible = (entry: FilterOption) => {
      if (!matchesAnyText(searchQuery, entry.address, entry.name)) return false;
      if (compact && counts && (counts[entry.address!] ?? 0) === 0 && !verdichtenKept?.has(entry.address!)) return false;
      if (checkedOnly && !selected.includes(entry.address!) && !compactKept?.has(entry.address!)) return false;
      return true;
    };
    for (const [l1Key, l2map] of tree) {
      const visibleL2 = [...l2map.entries()].filter(([, leaves]) => leaves.some(visible));
      if (visibleL2.length === 0) continue;
      const singleGroup = l2map.size === 1 && [...l2map.keys()][0] === l1Key;
      const lists = singleGroup ? [[...l2map.values()][0]] : visibleL2.map(([, leaves]) => leaves);
      for (const leaves of lists) {
        for (const entry of leaves) if (entry.address && visible(entry)) order.push(entry.address);
      }
    }
    return order;
  }, [tree, searchQuery, compact, checkedOnly, selected, counts, verdichtenKept, compactKept]);
  const { marked, lastMarked, markAt, targetsFor } = useRowMarks(visibleOrder, markReset);
  const markedSet = useMemo(() => new Set(marked), [marked]);

  const toggleLeaves = (address: string, e: React.MouseEvent) => {
    const gesture = toggleGesture(e);
    if (gesture.kind === 'none') return;
    if (gesture.kind === 'toggle') {
      onToggle(applyToggle(selected, targetsFor(address), !selected.includes(address), gesture.exclusive));
      if (!gesture.navigate) return;
    }
    onOpenList?.();
  };
  const toggleGroup = (leaves: string[], e: React.MouseEvent) => {
    const gesture = toggleGesture(e);
    if (gesture.kind === 'none') return;
    if (gesture.kind === 'toggle') {
      const turnOn = getCheckState(leaves, selected) !== 'checked';
      onToggle(applyToggle(selected, leaves, turnOn, gesture.exclusive));
      if (!gesture.navigate) return;
    }
    onOpenList?.();
  };
  const focusLeaves = (address: string, gesture: ToggleGesture) => {
    onFocusToggle?.(targetsFor(address), !focused.includes(address), gesture);
  };
  const leafToggles = (address: string) => ({
    filterOn: filtered.includes(address),
    onFilter: onFilterToggle
      ? (gesture: ToggleGesture) => onFilterToggle(targetsFor(address), !filtered.includes(address), gesture)
      : undefined,
    visualizeOn: visualized.includes(address),
    onVisualize: onVisualizeToggle
      ? (gesture: ToggleGesture) => onVisualizeToggle(targetsFor(address), !visualized.includes(address), gesture)
      : undefined,
    lastSeenOn: lastSeen.includes(address),
  });

  return (
    <BadgeColumnScope max={badgeMax}>
    <div>
      {[...tree.entries()].map(([l1Key, l2map]) => {
        const allL1Leaves = [...l2map.values()].flat().map(e => e.address!);
        const visibleL2 = [...l2map.entries()].filter(([, leaves]) =>
          leaves.some(shown)
        );
        if (visibleL2.length === 0) return null;

        const l1Name = groupNames[l1Key] || '';
        const l1Label = l1Name ? `${l1Key} — ${l1Name}` : l1Key;

        // If all leaves are in a single l2 group with the same key as l1 (2-part address), skip l1 level
        const singleGroup = l2map.size === 1 && [...l2map.keys()][0] === l1Key;

        if (singleGroup) {
          // Only 1 level deep — render leaves directly under a single group node
          const leaves = [...l2map.values()][0].filter(shown);
          return (
            <GroupNode
              key={l1Key}
              branchKey={knxBranchKey(separator, l1Key)}
              label={l1Label}
              leafAddresses={allL1Leaves}
              count={subtreeCount(l1Key, separator, counts)}
              dbCount={subtreeCount(l1Key, separator, dbCounts)}
              objects={subtreeObjects(l1Key, separator, counts)}
              selected={selected}
              onToggleAll={ev => toggleGroup(allL1Leaves, ev)}
            >
              {leaves.map(e => (
                <LeafRow key={e.address} address={e.address!} name={e.name ?? ''} checked={selected.includes(e.address!)}
                  dptMain={e.main} dptSub={e.sub}
                  count={counts ? (counts[e.address!] ?? 0) : undefined}
                  bufferCount={bufferCounts ? (bufferCounts[e.address!] ?? 0) : undefined}
                  dbCount={dbCounts ? (dbCounts[e.address!] ?? 0) : undefined}
                  marked={markedSet.has(e.address!)}
                  anchor={markedSet.has(e.address!) && e.address === lastMarked}
                  onMark={ev => markAt(ev, e.address!)}
                  onToggle={ev => toggleLeaves(e.address!, ev)}
                  onLastSeen={onLastSeen ? gesture => onLastSeen(targetsFor(e.address!), gesture, e.address!) : undefined}
                  focused={focused.includes(e.address!)}
                  onFocusToggle={onFocusToggle ? gesture => focusLeaves(e.address!, gesture) : undefined}
                  {...leafToggles(e.address!)}
                  isGA={separator === '/'} writeEnabled={writeEnabled}
                />
              ))}
            </GroupNode>
          );
        }

        return (
          <GroupNode
            key={l1Key}
            branchKey={knxBranchKey(separator, l1Key)}
            label={l1Label}
            leafAddresses={allL1Leaves}
            count={subtreeCount(l1Key, separator, counts)}
            dbCount={subtreeCount(l1Key, separator, dbCounts)}
            objects={subtreeObjects(l1Key, separator, counts)}
            selected={selected}
            descendantKeys={[...l2map.keys()].map(key => knxBranchKey(separator, key))}
            onToggleAll={ev => toggleGroup(allL1Leaves, ev)}
          >
            {visibleL2.map(([l2Key, leaves]) => {
              const visibleLeaves = leaves.filter(shown);
              if (visibleLeaves.length === 0) return null;
              const l2Leaves = leaves.map(e => e.address!);
              const l2Name = groupNames[l2Key] || '';
              const l2Label = l2Name ? `${l2Key} — ${l2Name}` : l2Key;

              return (
                <GroupNode
                  key={l2Key}
                  branchKey={knxBranchKey(separator, l2Key)}
                  label={l2Label}
                  leafAddresses={l2Leaves}
                  count={subtreeCount(l2Key, separator, counts)}
                  dbCount={subtreeCount(l2Key, separator, dbCounts)}
                  objects={subtreeObjects(l2Key, separator, counts)}
                  selected={selected}
                  defaultOpen={false}
                  onToggleAll={ev => toggleGroup(l2Leaves, ev)}
                >
                  {visibleLeaves.map(e => (
                    <LeafRow key={e.address} address={e.address!} name={e.name ?? ''} checked={selected.includes(e.address!)}
                      dptMain={e.main} dptSub={e.sub}
                      count={counts ? (counts[e.address!] ?? 0) : undefined}
                      bufferCount={bufferCounts ? (bufferCounts[e.address!] ?? 0) : undefined}
                      dbCount={dbCounts ? (dbCounts[e.address!] ?? 0) : undefined}
                      marked={markedSet.has(e.address!)}
                      anchor={markedSet.has(e.address!) && e.address === lastMarked}
                      onMark={ev => markAt(ev, e.address!)}
                      onToggle={ev => toggleLeaves(e.address!, ev)}
                      onLastSeen={onLastSeen ? gesture => onLastSeen(targetsFor(e.address!), gesture, e.address!) : undefined}
                      focused={focused.includes(e.address!)}
                      onFocusToggle={onFocusToggle ? gesture => focusLeaves(e.address!, gesture) : undefined}
                      {...leafToggles(e.address!)}
                      isGA={separator === '/'} writeEnabled={writeEnabled}
                    />
                  ))}
                </GroupNode>
              );
            })}
          </GroupNode>
        );
      })}
    </div>
    </BadgeColumnScope>
  );
};
