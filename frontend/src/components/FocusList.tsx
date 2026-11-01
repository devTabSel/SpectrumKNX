import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FoldVertical, ListChecks, Search, X } from 'lucide-react';
import type { FilterOption } from '../types/filters';
import { compareKnxAddress } from '../utils/knxAddress';
import { useStickyChecked } from '../hooks/useStickyChecked';
import { usePersistedScroll } from '../hooks/usePersistedScroll';
import { AddressActions } from './telegramCell';
import { nextTargetColor, setTargetColor } from '../utils/targetColors';
import { badgeColumnWidth } from './BadgeColumn';
import { CheckMark, toggleButtonColors } from './filterControls';
import { matchesAnyText } from '../utils/quickFilter';
import { nextRowMarks, rowActionTargets } from '../utils/rowMarks';
import { applyToggle, toggleGesture, type ToggleGesture } from '../utils/toggleClick';

/** Height of an icon column, so the controls line up with the address. Width follows the button. */
const ICON_SLOT = '1.625rem';

const IconSlot: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <span data-icon-slot="" style={{ height: ICON_SLOT, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
    {children}
  </span>
);

interface FocusListProps {
  mode: 'ga' | 'pa';
  entries: FilterOption[];
  /** Addresses pinned to the top of this list. */
  focused: string[];
  onFocusedChange: (focused: string[]) => void;
  writeEnabled?: boolean;
  /** Colours of group addresses; only the GA list offers the swatch. */
  targetColors?: Record<string, string>;
  /** Live filter of this list. Persisted by the owner. */
  search: string;
  onSearchChange: (search: string) => void;
  /** Hide entries with no telegram in the buffer. A row with a quick-filter or last-seen toggle on stays. */
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  /** Show only focused entries. Disabled while this list has none. */
  checkedOnly?: boolean;
  onCheckedOnlyChange?: (checkedOnly: boolean) => void;
  /** Telegram counts in the buffer, keyed by address. Absent until counts load. */
  counts?: Record<string, number>;
  /** Unfiltered buffer totals. An address is highlighted when its count is at least 1. */
  bufferCounts?: Record<string, number>;
  /** Addresses whose last-seen toggle is on. The Last Seen table reads this. */
  lastSeen?: string[];
  onLastSeenChange?: (addresses: string[]) => void;
  /** Addresses whose filter toggle is on. Controlled when `onQuickFilterChange` is set. */
  quickFilter?: string[];
  onQuickFilterChange?: (addresses: string[]) => void;
  /** Addresses whose visualization toggle is on. Independent of `focused`. */
  visualized?: string[];
  onVisualizedChange?: (addresses: string[]) => void;
  /** Rendered at the end of the search row, after Compact and Verdichten. */
  toolbarExtra?: React.ReactNode;
  /** Shift or alt on a toggle opens the matching panel. */
  onNavigateFocus?: () => void;
  onNavigateList?: () => void;
  onNavigateVisualizer?: () => void;
  onNavigateLastSeen?: () => void;
  /** Bumped to drop every mouse selection in this list. */
  markReset?: number;
}

type FocusEntry = FilterOption & { address: string };

interface FocusRowProps {
  entry: FocusEntry;
  mode: 'ga' | 'pa';
  focused: boolean;
  /** Quick filter is a local toggle. It does not change the source or target filter. */
  quickFilter: boolean;
  /** Last-seen toggle. The Last Seen table lists these addresses. */
  lastSeen: boolean;
  marked: boolean;
  anchor: boolean;
  /** Absent hides the badge. A focused row still shows a loaded count of 0. */
  count?: number;
  /** Unfiltered buffer total. The address is highlighted when this is at least 1. */
  bufferCount?: number;
  writeEnabled?: boolean;
  color?: string;
  /** Shared width of this list's telegram column, sized to its widest count. */
  badgeWidth: string;
  onMark: (e: React.MouseEvent) => void;
  visualized: boolean;
  onFocus: (gesture: ToggleGesture) => void;
  onQuickFilter: (gesture: ToggleGesture) => void;
  onLastSeen: (gesture: ToggleGesture) => void;
  onVisualize: (gesture: ToggleGesture) => void;
  onColor: () => void;
  onClearColor: () => void;
}

const FocusRow: React.FC<FocusRowProps> = ({
  entry, mode, focused, quickFilter, lastSeen, visualized, marked, anchor, count, bufferCount, writeEnabled, color, badgeWidth, onMark, onFocus, onQuickFilter, onLastSeen, onVisualize, onColor, onClearColor,
}) => {
  const [hovered, setHovered] = useState(false);
  const address = entry.address;
  const inBuffer = (bufferCount ?? 0) > 0;
  const showActions = focused || hovered || quickFilter || lastSeen || visualized || !!color;
  const control = (e: React.MouseEvent, act: (gesture: ToggleGesture) => void) => {
    e.stopPropagation();
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) e.preventDefault();
    const gesture = toggleGesture(e);
    if (gesture.kind === 'none') return;
    act(gesture);
  };

  return (
    <div
      data-focus-address={address}
      data-marked={marked ? 'true' : undefined}
      data-mark-anchor={anchor ? 'true' : undefined}
      onClick={onMark}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', boxSizing: 'border-box',
        display: 'flex', alignItems: 'flex-start', gap: '0.35rem', padding: '0.28rem 0.45rem',
        borderRadius: '6px', transition: 'background 0.15s', userSelect: 'none',
        background: anchor
          ? 'color-mix(in srgb, var(--accent-primary) 34%, transparent)'
          : marked
            ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)'
            : hovered
              ? 'var(--bg-hover)'
              : 'transparent',
      }}
    >
      <div
        role="checkbox"
        aria-checked={focused}
        aria-label={`Focus ${address}`}
        onClick={e => control(e, onFocus)}
        style={{ flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', height: ICON_SLOT }}
      >
        <CheckMark state={focused ? 'checked' : 'unchecked'} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div data-focus-address-line="" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
          <div title={address} style={{
            flex: 1, minWidth: 0, height: '1rem', lineHeight: '1rem',
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem',
            fontWeight: inBuffer ? 700 : 400,
            color: inBuffer ? 'var(--accent-primary)' : 'var(--text-main)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{address}</div>
          <div
            data-focus-actions=""
            style={{
              display: 'flex', alignItems: 'center', gap: '0.125rem', flexShrink: 0,
              opacity: showActions ? 1 : 0,
              pointerEvents: showActions ? 'auto' : 'none',
            }}
          >
            <AddressActions
              inline
              mode={mode}
              address={address}
              name={entry.name}
              dptMain={entry.main}
              dptSub={entry.sub}
              focusOn={focused}
              filterOn={quickFilter}
              visualizeOn={visualized}
              lastSeenOn={lastSeen}
              onFocus={(_address, _mode, gesture) => onFocus(gesture)}
              onFilter={(_address, _mode, gesture) => onQuickFilter(gesture)}
              onVisualize={(_address, _mode, gesture) => onVisualize(gesture)}
              onLastSeen={(_address, _mode, gesture) => onLastSeen(gesture)}
              canSend={writeEnabled}
            />
            <IconSlot>
              <button
                type="button"
                aria-label={`Colour of ${address}`}
                title={color
                  ? (mode === 'ga'
                    ? 'Telegrams to this address are marked in this colour - click for the next colour, ctrl-click clears the selected rows'
                    : 'Telegrams from this device are marked in this colour - click for the next colour, ctrl-click clears the selected rows')
                  : (mode === 'ga'
                    ? 'Mark telegrams to this address with a colour · ctrl-click clears the selected rows'
                    : 'Mark telegrams from this device with a colour · ctrl-click clears the selected rows')}
                onClick={e => {
                  e.stopPropagation();
                  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                    e.preventDefault();
                    onClearColor();
                    return;
                  }
                  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
                  onColor();
                }}
                style={{
                  width: 14, height: 14, flexShrink: 0, padding: 0, borderRadius: '50%', cursor: 'pointer',
                  background: color ?? 'transparent',
                  border: color ? `1.5px solid ${color}` : '1.5px dashed var(--text-dim)',
                }}
              />
            </IconSlot>
          </div>
          <span
            data-badge-slot=""
            style={{
              width: badgeWidth, flexShrink: 0, display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center',
              fontSize: '0.65rem', fontWeight: 600,
            }}
          >
            {count !== undefined && (
              <span title="Telegrams" style={{
                height: '1rem', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.65rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1, minWidth: '1.8rem', textAlign: 'center', flexShrink: 0,
                padding: '0 0.4rem', borderRadius: '999px',
                background: 'rgba(99,102,241,0.15)',
                color: 'var(--accent-primary)',
                border: '1px solid rgba(99,102,241,0.3)',
              }}>{count}</span>
            )}
          </span>
        </div>
        <div data-focus-name="" title={entry.name || undefined} style={{
          height: '0.85rem', lineHeight: '0.85rem',
          fontSize: '0.65rem', color: 'var(--text-dim)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{entry.name}</div>
      </div>
    </div>
  );
};

/**
 * Every project address of one kind. Focused rows stay above a divider, both
 * groups in address order. Toggling focus keeps the surrounding rows in place.
 * A click on the row marks it. A toggle acts on that row, or on every marked
 * row when the clicked one is marked. A plain click turns the others off.
 */
export const FocusList: React.FC<FocusListProps> = ({
  mode, entries, focused, onFocusedChange, writeEnabled, targetColors = {},
  search, onSearchChange, compact, onCompactChange, checkedOnly = false, onCheckedOnlyChange, counts, bufferCounts,
  lastSeen: lastSeenProp, onLastSeenChange,
  quickFilter: quickFilterProp, onQuickFilterChange,
  visualized: visualizedProp, onVisualizedChange, toolbarExtra,
  onNavigateFocus, onNavigateList, onNavigateVisualizer, onNavigateLastSeen, markReset = 0,
}) => {
  const scrollKey = mode === 'ga' ? 'focus-ga' : 'focus-pa';
  const scrollerRef = usePersistedScroll(scrollKey);
  const anchorRef = useRef<{ address: string; top: number } | null>(null);
  const [marked, setMarked] = useState<string[]>([]);
  const [lastMarked, setLastMarked] = useState<string | null>(null);
  const markResetRef = useRef(markReset);
  useEffect(() => {
    if (markResetRef.current === markReset) return;
    markResetRef.current = markReset;
    setMarked([]);
    setLastMarked(null);
  }, [markReset]);
  const [ownQuickFilter, setOwnQuickFilter] = useState<string[]>([]);
  const [ownLastSeen, setOwnLastSeen] = useState<string[]>([]);
  const [ownVisualized, setOwnVisualized] = useState<string[]>([]);
  const lastSeen = onLastSeenChange ? (lastSeenProp ?? []) : ownLastSeen;
  const setLastSeen = (addresses: string[]) => (onLastSeenChange ? onLastSeenChange(addresses) : setOwnLastSeen(addresses));
  const quickFilter = onQuickFilterChange ? (quickFilterProp ?? []) : ownQuickFilter;
  const setQuickFilter = (addresses: string[]) => (onQuickFilterChange ? onQuickFilterChange(addresses) : setOwnQuickFilter(addresses));
  const visualized = onVisualizedChange ? (visualizedProp ?? []) : ownVisualized;
  const setVisualized = (addresses: string[]) => (onVisualizedChange ? onVisualizedChange(addresses) : setOwnVisualized(addresses));
  const focusedSet = useMemo(() => new Set(focused), [focused]);
  const quickFilterSet = useMemo(() => new Set(quickFilter), [quickFilter]);
  const lastSeenSet = useMemo(() => new Set(lastSeen), [lastSeen]);
  const visualizedSet = useMemo(() => new Set(visualized), [visualized]);
  const markedSet = useMemo(() => new Set(marked), [marked]);

  const verdichtenKept = useStickyChecked(compact, focused, false);
  // A colour keeps the row for as long as Verdichten stays on, including after
  // the colour itself is cleared.
  const coloredAddresses = useMemo(
    () => Object.entries(targetColors).filter(([, color]) => !!color).map(([address]) => address),
    [targetColors],
  );
  const colorKept = useStickyChecked(compact, coloredAddresses);
  // While Compact is on, a row that qualified (focus, toggle, or colour) stays
  // after that checkbox, those toggles, and the colour are cleared. Only this
  // list's own entries count, not pins in the other focus list.
  const compactSources = useMemo(() => {
    const own = new Set(entries.flatMap(entry => entry.address ? [entry.address] : []));
    const colored = Object.entries(targetColors)
      .filter(([address, color]) => !!color && own.has(address))
      .map(([address]) => address);
    return [...new Set([...focused, ...quickFilter, ...lastSeen, ...visualized, ...colored].filter(address => own.has(address)))];
  }, [entries, focused, quickFilter, lastSeen, visualized, targetColors]);
  const compactKept = useStickyChecked(checkedOnly, compactSources);
  const compactReady = checkedOnly || compactSources.length > 0;
  const badgeWidth = badgeColumnWidth(counts ? Math.max(0, ...Object.values(counts)) : 0);
  const { pinned, rest, projectEmpty } = useMemo(() => {
    const rows = entries.filter((entry): entry is FocusEntry => !!entry.address);
    const byAddress = (a: FilterOption, b: FilterOption) => compareKnxAddress(a.address ?? '', b.address ?? '');
    const matches = (entry: FocusEntry) => {
      if (!matchesAnyText(search, entry.address, entry.name)) return false;
      const toggleOn = quickFilterSet.has(entry.address) || lastSeenSet.has(entry.address) || visualizedSet.has(entry.address);
      const kept = toggleOn || colorKept.has(entry.address);
      if (compact && counts && (counts[entry.address] ?? 0) === 0 && !verdichtenKept.has(entry.address) && !kept) return false;
      if (checkedOnly && !compactKept.has(entry.address)) return false;
      return true;
    };
    const shown = rows.filter(matches);
    return {
      projectEmpty: rows.length === 0,
      pinned: shown.filter(entry => focusedSet.has(entry.address)).sort(byAddress),
      rest: shown.filter(entry => !focusedSet.has(entry.address)).sort(byAddress),
    };
  }, [entries, focusedSet, quickFilterSet, lastSeenSet, visualizedSet, colorKept, compactKept, search, compact, checkedOnly, counts, verdichtenKept]);

  const shown = useMemo(() => [...pinned, ...rest], [pinned, rest]);

  useLayoutEffect(() => {
    const pending = anchorRef.current;
    const scroller = scrollerRef.current;
    if (!pending || !scroller) return;
    anchorRef.current = null;
    const anchor = [...scroller.querySelectorAll<HTMLElement>('[data-focus-address]')]
      .find(row => row.dataset.focusAddress === pending.address);
    if (!anchor) return;
    scroller.scrollTop += anchor.getBoundingClientRect().top - pending.top;
  });

  const rememberAnchor = (address: string) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const rows = [...scroller.querySelectorAll<HTMLElement>('[data-focus-address]')];
    const index = rows.findIndex(row => row.dataset.focusAddress === address);
    const anchor = rows[index + 1] ?? rows[index - 1];
    if (anchor?.dataset.focusAddress) {
      anchorRef.current = { address: anchor.dataset.focusAddress, top: anchor.getBoundingClientRect().top };
    }
  };

  const markAt = (e: React.MouseEvent, address: string) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }
    const next = nextRowMarks(marked, lastMarked, shown.map(entry => entry.address), address, e);
    setMarked(next.marked);
    setLastMarked(next.lastMarked);
  };

  /** Marked rows when the clicked one is among them; otherwise just that row. */
  const actionTargets = (address: string): string[] =>
    rowActionTargets(marked, shown.map(entry => entry.address), address);

  const commit = (
    address: string,
    current: readonly string[],
    apply: (next: string[]) => void,
    gesture: ToggleGesture,
    navigate?: () => void,
    anchor = false,
  ) => {
    if (gesture.kind === 'none') return;
    if (gesture.kind === 'toggle') {
      const next = applyToggle(current, actionTargets(address), !current.includes(address), gesture.exclusive);
      if (anchor && (next.length !== current.length || next.some((item, index) => item !== current[index]))) rememberAnchor(address);
      apply(next);
      if (!gesture.navigate) return;
    }
    navigate?.();
  };

  const applyColor = (address: string) => {
    const targets = actionTargets(address);
    const inUse = entries.flatMap(item => item.address ? [item.address] : []);
    const color = nextTargetColor(targetColors, address, inUse);
    for (const target of targets) setTargetColor(target, color);
  };

  const clearColor = (address: string) => {
    const targets = marked.length > 0 ? marked : [address];
    for (const target of targets) setTargetColor(target, null);
  };

  const renderRow = (entry: FocusEntry) => {
    const address = entry.address;
    const count = counts?.[address] ?? 0;
    const bufferCount = bufferCounts ? (bufferCounts[address] ?? 0) : undefined;
    return (
      <FocusRow
        key={address}
        entry={entry}
        mode={mode}
        focused={focusedSet.has(address)}
        quickFilter={quickFilterSet.has(address)}
        lastSeen={lastSeenSet.has(address)}
        visualized={visualizedSet.has(address)}
        marked={markedSet.has(address)}
        anchor={markedSet.has(address) && address === lastMarked}
        count={counts != null && (count > 0 || focusedSet.has(address)) ? count : undefined}
        bufferCount={bufferCount}
        writeEnabled={writeEnabled}
        color={targetColors[address]}
        badgeWidth={badgeWidth}
        onMark={e => markAt(e, address)}
        onFocus={gesture => commit(address, focused, onFocusedChange, gesture, onNavigateFocus, true)}
        onQuickFilter={gesture => commit(address, quickFilter, setQuickFilter, gesture, onNavigateList)}
        onLastSeen={gesture => commit(address, lastSeen, setLastSeen, gesture, onNavigateLastSeen)}
        onVisualize={gesture => commit(address, visualized, setVisualized, gesture, onNavigateVisualizer)}
        onColor={() => applyColor(address)}
        onClearColor={() => clearColor(address)}
      />
    );
  };

  const emptyCopy = projectEmpty
    ? (mode === 'ga' ? 'No group addresses in the project.' : 'No devices in the project.')
    : 'No matches.';

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '0.75rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: '0.35rem',
      }}>
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'var(--bg-tag)', border: '1px solid var(--border-color)',
          borderRadius: '7px', padding: '0.45rem 0.65rem',
        }}>
          <Search size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="filter..."
            aria-label={mode === 'ga' ? 'Search group addresses' : 'Search devices'}
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-main)', fontSize: '0.8125rem', flex: 1, minWidth: 0,
              fontFamily: 'inherit',
            }}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearchChange('')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)' }}
            >
              <X size={11} />
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Compact"
          aria-pressed={checkedOnly}
          disabled={!compactReady}
          title={compactReady
            ? 'Show focused entries, active toggles and coloured entries'
            : 'Focus an entry, turn on a toggle, or set a colour to compact the list'}
          onClick={() => onCheckedOnlyChange?.(!checkedOnly)}
          style={{
            flexShrink: 0, borderRadius: '7px',
            display: 'flex', alignItems: 'center', padding: '0.4rem',
            cursor: compactReady ? 'pointer' : 'not-allowed',
            opacity: compactReady ? 1 : 0.4,
            ...toggleButtonColors(checkedOnly),
          }}
        >
          <ListChecks size={14} />
        </button>
        <button
          type="button"
          aria-label="Verdichten"
          aria-pressed={compact}
          title="Hide entries with no telegrams"
          onClick={() => onCompactChange(!compact)}
          style={{
            flexShrink: 0, cursor: 'pointer', borderRadius: '7px',
            display: 'flex', alignItems: 'center', padding: '0.4rem',
            ...toggleButtonColors(compact),
          }}
        >
          <FoldVertical size={14} />
        </button>
        {toolbarExtra}
      </div>
      <div ref={scrollerRef} data-panel-scroll={scrollKey} className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto' }}>
        {pinned.length + rest.length === 0 ? (
          <div style={{ padding: '1rem 0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>{emptyCopy}</div>
        ) : (
          <>
            {pinned.map(renderRow)}
            {pinned.length > 0 && rest.length > 0 && (
              <div style={{ position: 'relative', height: 0 }}>
                <div
                  role="separator"
                  style={{
                    position: 'absolute', left: '0.45rem', right: '0.45rem', top: 0, height: 2,
                    transform: 'translateY(-50%)', borderRadius: 1, background: 'var(--text-dim)',
                    pointerEvents: 'none',
                  }}
                />
              </div>
            )}
            {rest.map(renderRow)}
          </>
        )}
      </div>
    </div>
  );
};
