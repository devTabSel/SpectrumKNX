import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Telegram } from '../hooks/useWebSocket';
import { ChevronUp, ChevronDown, Filter, LineChart, X, Clock, Plus, Minus, Download, List, Search } from 'lucide-react';
import { enabledFilters, hasActiveFilters, matchesTelegram, type ActiveFilters, type FilterOption } from '../types/filters';
import { capContextWindow } from '../utils/contextWindow';
import {
  contextRailSigns,
  expandWithDeltaContext,
  sideFlagsTristate,
} from '../utils/deltaContextExpansion';
import { nextTriState, triStateAriaChecked, type TriState } from '../utils/triState';
import { SendToGaHost, SendToGaPopover, type ListScrollSnapshot } from './SendToGaPopover';
import { EventTypeLabel } from './EventTypeLabel';
import { type LinkedRowStatus } from './WriteToBusPanel';
import type { SendCorrespondenceKey } from '../utils/sendCorrespondence';
import type { BusPayload } from '../utils/dptValues';
import { GotoTimeControl } from './GotoTimeControl';
import { classifyGotoTarget } from '../utils/gotoTarget';
import { BusValueFacetPair } from './BusValueFacetPair';
import { DateTimeFacetPair } from './DateTimeFacetPair';
import { DurationField } from './DurationField';
import { ThemedDatetimePicker } from './ThemedDatetimePicker';
import { getPref, setPref } from '../utils/prefs';
import type { SortKey, SortLevel, SortConfig } from '../utils/sortConfig';
import type { Interval } from '../services/telegram-coverage-service';
import {
  END_MARKER_PX,
  READING_END_LABEL,
  anchorDisplayEdge,
  anchorEdgeCount,
  contiguousFromAnchor,
  spacerVariantA,
  type ReadingEndCause,
} from '../utils/telegramDisplay';
import {
  activeQuickFilter,
  compileQuickFilters,
  DEFAULT_QUICK_FILTER_COLUMN_ENABLED,
  type QuickCellValue,
  type QuickPatterns,
  type QuickFilterColumnEnabled,
} from '../utils/quickFilter';
import { useTargetColors } from '../utils/targetColors';
import { anchorKey } from '../utils/anchorKey';
import { downloadTelegramsCsv } from '../utils/telegramCsv';
import { adjacentMark } from '../utils/adjacentMark';
import { readListEdge } from '../utils/listEdge';
import { createStripeState } from '../utils/stripeIndex';
import { buildTelegramRows, patchTelegramRows, type TelegramRowOf } from '../utils/telegramRowDeltas';
import { forceIncludeKeys } from '../utils/forceIncludeKeys';
import { peakRate } from '../utils/peakRate';
import { moveColumn, readColumnOrderPref, writeColumnOrderPref } from '../utils/columnOrder';
import { dptDescriptionLabel, dptKeyLabel } from '../utils/dpt';
import { effectiveTelegramDpt, projectDptByAddress } from '../utils/effectiveTelegramDpt';
import { enrichTelegramValueDisplay } from '../utils/telegramValueDisplay';
import { ttTypeClass } from '../utils/telegramCellStyles';
import {
  isGroupRead,
  readAnsweredByNewestVisible,
  readFollowKey,
  responsesFollowingReads,
  rowsIntersectingViewport,
} from '../utils/groupValueEvents';
import { TelegramWhenJump } from './TelegramWhenJump';
import {
  addKeys,
  removeKeys,
  soleKeys,
  toggleKey,
} from '../utils/markReasons';
import {
  getMarkColorIndex,
  MARK_COLOR_PALETTE,
  markColorFromIndex,
  setMarkColorIndex,
  type MarkColorIndexMap,
} from '../utils/markColors';

export type { SortKey, SortLevel, SortConfig };

interface TelegramTableProps {
  telegrams: Telegram[];
  /**
   * Full (unfiltered) buffer used to force-include marked/selected rows that
   * the parent already dropped. Defaults to `telegrams`.
   */
  forceIncludeFrom?: Telegram[];
  /**
   * Telegrams that decide whether a visible Read is answered.
   * The live list passes the full buffer, including the pause backlog.
   * Omitted → the rows passed as `telegrams`.
   */
  readPhaseTelegrams?: Telegram[];
  visibleColumns: { [key: string]: boolean };
  sortConfig: SortConfig;
  /** `additive` (ctrl/cmd-click) adds/toggles a sort level instead of replacing the whole config (#311). */
  onSort: (key: SortKey, opts?: { additive?: boolean }) => void;
  activeFilters: ActiveFilters;
  /**
   * Project GA list (filter-panel targets). Used to fill DPT / decode VALUE
   * when a telegram row carries no dpt_main of its own.
   */
  projectTargets?: FilterOption[];
  onQuickFilter: (key: 'sources' | 'targets' | 'types' | 'dpts', value: string | number) => void;
  onQuickVisualize: (targetAddress: string) => void;
  onQuickLastSeen?: (address: string, mode: 'ga' | 'pa') => void;
  /** Enables the per-row "Send to this GA" quick popover; true only when the bus is writable (#214). */
  canSend?: boolean;
  /** Jump from the send popover's last-value timestamp to the telegram list.
   *  Ctrl/Cmd and Shift match a row click. */
  onGotoTelegram?: (telegram: Telegram, mods?: { additive?: boolean; range?: boolean; load?: boolean }) => void;
  /** Live bus feed for the send popover's wait-for-read-response. */
  latestTelegram?: Telegram | null;
  /** Alt-click on a row send icon → toggle the send panel. */
  onAltSend?: () => void;
  /** Ctrl/Cmd-click on a row send icon → clear or insert that GA in the send panel. */
  onCtrlSend?: (info: {
    address: string;
    name?: string | null;
    dptMain?: number | null;
    dptSub?: number | null;
  }) => void;
  /** GAs present in the send panel (send-icon opaque/blue; panel open/closed irrelevant). */
  sendPanelAddresses?: ReadonlySet<string>;
  /** GAs with a live scheduled send-job (send-icon opaque, green). */
  activeSendJobAddresses?: ReadonlySet<string>;
  /** Live job status by GA — popover shows panel-like status when a job is active. */
  gaJobStatuses?: Record<string, LinkedRowStatus>;
  /** Linked send-panel row status while a popover job is active. */
  linkedStatus?: LinkedRowStatus | null;
  onScheduleCommit?: (draft: SendCorrespondenceKey & { name?: string | null }) => void;
  onWriteWithSchedule?: (
    draft: SendCorrespondenceKey & { name?: string | null },
    payload: BusPayload,
    opts?: { response?: boolean },
  ) => void;
  onReadWithSchedule?: (draft: SendCorrespondenceKey & { name?: string | null }) => void;
  onCancelLinked?: (rowId?: string) => void;
  onClearLinked?: (rowId?: string) => void;

  // Lifted Quick-Filter state (#280, #309, #341)
  quickFilterOpen?: boolean;
  onQuickFilterOpenChange?: (open: boolean) => void;
  quickFilterEnabled?: boolean;
  onQuickFilterEnabledChange?: (enabled: boolean) => void;
  quickPatterns?: QuickPatterns;
  onQuickPatternsChange?: (patterns: QuickPatterns) => void;
  /** Per-column quick-filter on/off. Lifted so it survives navigation and reloads. */
  quickColumnEnabled?: QuickFilterColumnEnabled;
  onQuickColumnEnabledChange?: (enabled: QuickFilterColumnEnabled) => void;
  /** Edits the Time-Delta-Context window when the quick-filter bounds are not lifted. */
  onDeltaContextChange?: (deltaBeforeMs: number, deltaAfterMs: number) => void;
  /**
   * Quick-filter context bounds. `null` follows the applied side-panel window.
   * A typed value above that window is cut down to it.
   */
  qfContext?: { before: number; after: number } | null;
  onQfContextChange?: (next: { before: number; after: number }) => void;
  /** Toggles the window on/off without losing the entered values (#318). */
  onDeltaContextEnabledChange?: (enabled: boolean) => void;

  // Lifted Follow / Anchor state (#203, #341)
  listFollow?: boolean;
  onListFollowChange?: (follow: boolean) => void;
  /**
   * Live follow, the pause backlog and the newer pill. Off while reading
   * forward: new rows stay where the buffer admitted them, and nothing
   * scrolls to the newest edge or resumes Play.
   */
  liveFollow?: boolean;
  /**
   * Read axis. When set, the list shows only the gapless run from the anchor
   * and spacers follow variant A. The anchor sits on the side where that row
   * falls in the current time sort; the reading end is the other side. The
   * anchor pill counts filtered rows scrolled out toward it (plus the
   * backward pause backlog). Omitted keeps the live-edge geometry.
   */
  readDirection?: 'forward' | 'backward';
  /**
   * `chevron` swaps spacers and leaves the scroll where it is. Anything else
   * rebuilds the view onto the anchor.
   */
  directionGesture?: 'chevron' | 'rebuild';
  /** Sorted coverage. With `readDirection`, rows past an open gap stay hidden. */
  covered?: readonly Interval[];
  /** Explicit buffer anchor. Null uses the oldest (forward) or newest (backward) edge. */
  bufferAnchorTs?: number | null;
  /** Why the reading end stopped. Painted on the end marker. */
  readingEnd?: ReadingEndCause;
  listAnchorKey?: string | null;
  onListAnchorKeyChange?: (key: string | null) => void;
  /** Buffer snapshot is frozen; the pause backlog feeds the jump-to-live pill. */
  isPaused?: boolean;
  /** User latched Pause (manual); blocks auto live-follow from newest visibility. */
  isManualPause?: boolean;
  /** Master filter toggle. Backlog rows are matched against `activeFilters` only while this is on. */
  filtersEnabled?: boolean;
  /**
   * Side panel the loaded rows were fetched with. History passes the snapshot
   * from the last refresh so a pending edit does not change the jump icon.
   * Omitted uses `activeFilters` (the monitor applies the panel immediately).
   */
  sidePanelFilters?: ActiveFilters;
  /** Telegrams ingested since the buffer snapshot was frozen. */
  pausedCount?: number;
  /**
   * Pause backlog (newest first). Stable array, mutated in place; pair with
   * `pausedCount` so the pill can classify each arrival without copying it.
   */
  pausedTelegrams?: Telegram[];
  /** Reach the frozen live edge while auto-paused: flush without forcing follow. */
  onPauseFlush?: () => void;
  /**
   * Metered flush while auto-paused: reveal the oldest `n` backlog telegrams
   * (snapshot stays frozen otherwise). The table feeds the backlog in a few
   * rows per fill-axis gesture so it scrolls in line by line; the parent
   * resumes playing once the backlog is empty. A plain newer-pill click while
   * manually paused asks for the whole backlog and stays paused. Without it,
   * the whole backlog is flushed via `onPauseFlush`.
   */
  onPauseReveal?: (n: number) => void;
  /**
   * Newer-pill resume. Called for auto-pause and for a Ctrl-click during
   * manual pause. A plain click while manually paused does not call this.
   */
  onJumpToLive?: () => void;

  // Lifted row flags (#310). Marked, mouse selection, and last selected are
  // independent. Lifted so they survive main-panel navigation.
  markedKeys?: readonly string[];
  onMarkedKeysChange?: (keys: string[]) => void;
  mouseSelectedKeys?: readonly string[];
  onMouseSelectedKeysChange?: (keys: string[]) => void;
  /** The row last chosen by a click or a goto. At most one row. */
  lastSelectedKey?: string | null;
  onLastSelectedKeyChange?: (key: string | null) => void;
  /** Rows left out of the list until the hide flag is cleared. Not a mark reason. */
  hiddenKeys?: readonly string[];
  onHiddenKeysChange?: (keys: string[]) => void;
  /** Per-row colour index into MARK_COLOR_PALETTE (parallel to mark reasons). */
  markColorIndices?: MarkColorIndexMap;
  onMarkColorIndicesChange?: (indices: MarkColorIndexMap) => void;

  // Lifted Quick Info Bar open state (#311, #341)
  infoBarOpen?: boolean;
  onInfoBarOpenChange?: (open: boolean) => void;

  // Lifted per-side Time-Delta-Context flags. A row anchors the quick-filter
  // window on a side only while that side's flag is on.
  flaggedBeforeKeys?: string[];
  onFlaggedBeforeKeysChange?: (keys: string[]) => void;
  flaggedAfterKeys?: string[];
  onFlaggedAfterKeysChange?: (keys: string[]) => void;

  /** Per-row context flag: the row is in the soft Time-Delta-Context window
   * and did not itself match the filters. Not a mark reason. Flagging a row
   * only anchors a window; it does not clear this membership (#343). */
  contextKeys?: ReadonlySet<string>;
  /** Context telegram key → anchor keys whose context includes it. */
  contextParents?: ReadonlyMap<string, readonly string[]>;

  /** Center this telegram in the visible list. `id` changes on every request
   * so repeating the same telegram jumps again. Selection is set only when
   * that exact telegram is in the buffer. */
  gotoRequest?: ListGotoRequest | null;

  /** Raw-buffer oldest/newest bounds (epoch ms). A time inside them only scrolls. */
  bufferOldestMs?: number | null;
  bufferNewestMs?: number | null;
  /**
   * `history` cannot reload a target the server filtered out. The jump icon
   * is then hover-only and does nothing, including on Ctrl-click.
   */
  gotoScope?: 'live' | 'history';
  /** Rows a goto has landed on. Force-visible, separate from marks and context flags. */
  jumpTargetKeys?: readonly string[];
  /** `replace` on a plain goto, `add` on Ctrl when the target is in the buffer. */
  onJumpTarget?: (key: string, mode: 'replace' | 'add') => void;
  /** Target older than the buffer: forward window with x = that time. No buffer wipe. */
  onGotoFillOlder?: (targetMs: number) => Promise<void>;
  /** Target newer than the buffer: backward window with y = that time. No buffer wipe. */
  onGotoFillNewer?: (targetMs: number) => Promise<void>;

  /**
   * Bumped by the parent when an outside action changes what the list shows
   * (e.g. main filter on/off or filter edits). Each bump pins + flashes the
   * preferred row (last selected → first selected → top).
   */
  viewChangeToken?: number;

  /** Switches the Focus panel to Devices (`pa`) or Group Addresses (`ga`). */
  onFocusCategorySelect?: (category: 'ga' | 'pa') => void;
  /** Addresses flagged for the Telegram List in the Focus panel. */
  focusListAddresses?: string[];
  sourceFocusOnly?: boolean;
  onSourceFocusOnlyChange?: (enabled: boolean) => void;
  targetFocusOnly?: boolean;
  onTargetFocusOnlyChange?: (enabled: boolean) => void;
  /** Disables the source/target focus filter toggles (Focus panel reset). */
  focusFilterDisabled?: boolean;

  /**
   * Toolbar above the column headers (not the column-header row).
   * `headerLeading` stays on the left, `headerCenter` is centered.
   * Both omitted → no bar, so history is unchanged.
   */
  headerLeading?: ReactNode;
  headerCenter?: ReactNode;
}

export interface ListGotoRequest {
  id: number;
  /** Prefer telegram jump; if only targetMs, jump nearest time via gotoTime. */
  telegram?: Telegram;
  /** Time-only jump (e.g. rewind to DB oldest after fill). */
  targetMs?: number;
  /** Ctrl/Cmd: toggle this row in the mouse selection, same as a row click. */
  additive?: boolean;
  /** Shift: select the range from the previous last-selected row. */
  range?: boolean;
  /**
   * In-buffer jump: scroll only. Do not change follow or pause. Ctrl still
   * adds a jump target when `additive` is set.
   */
  preserveFollow?: boolean;
  /**
   * Outside the buffer, fill only when the caller already confirmed it
   * (typed time, Ctrl-click, rewind). Default true for an existing request.
   */
  allowFill?: boolean;
}

type ColId = 'time' | 'delta' | 'source' | 'target' | 'type' | 'dpt' | 'value';

const EMPTY_CELL: QuickCellValue = { top: '', bottom: '' };

interface ColumnDef {
  id: ColId;
  label: string;
  sortKey?: SortKey;
  defaultWidth: number;
  minWidth: number;
  /** key in visibleColumns that toggles this column (undefined = always visible) */
  visibleKey?: string;
}

// Ordered column definitions — drives both header and body so they cannot drift.
const COLUMNS: ColumnDef[] = [
  { id: 'time', label: 'TIME', sortKey: 'timestamp', defaultWidth: 120, minWidth: 90 },
  { id: 'delta', label: 'Δt', defaultWidth: 100, minWidth: 60, visibleKey: 'delta' },
  { id: 'source', label: 'SOURCE', sortKey: 'source_address', defaultWidth: 190, minWidth: 90 },
  { id: 'target', label: 'TARGET', sortKey: 'target_address', defaultWidth: 230, minWidth: 90 },
  { id: 'type', label: 'TYPE', sortKey: 'simplified_type', defaultWidth: 95, minWidth: 70, visibleKey: 'type' },
  { id: 'dpt', label: 'DPT', sortKey: 'dpt_name', defaultWidth: 150, minWidth: 80, visibleKey: 'dpt' },
  { id: 'value', label: 'VALUE', sortKey: 'value_numeric', defaultWidth: 220, minWidth: 120 },
];

const COLUMN_WIDTHS_PREF = 'columnWidths';

// Fixed width of the left-edge icon rail, shared by quickinfo/header/quickfilter/rows.
// Wide enough for the centred colour swatch (14px) in the middle third.
const RAIL_WIDTH = '1.25rem';
const RAIL_COLOR_SWATCH_SIZE = 14;
// Mouse-selection washes: stronger for the last selected row.
const MOUSE_LATEST_WASH = 'color-mix(in srgb, var(--accent-primary) 34%, transparent)';
const MOUSE_SELECTED_WASH = 'color-mix(in srgb, var(--accent-primary) 16%, transparent)';
// Soft Time-Delta-Context row wash — also the rail when a context-flagged row is marked.
const CONTEXT_WASH = 'color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)';

// Keys that scroll a list. Modifiers must not count: ctrl-click on a toolbar
// button is not the user scrolling (#435).
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

const getDPTColor = (dpt_main: number | null) => {
  if (dpt_main === 1) return 'var(--dpt-1, #818cf8)';
  if (dpt_main === 5) return 'var(--dpt-5, #34d399)';
  if (dpt_main === 9) return 'var(--dpt-9, #fb923c)';
  return 'var(--dpt-unknown, #6b7280)';
};

const getDPTLabel = (dpt_main: number | null) => {
  if (dpt_main === 1) return 'DPT 1.x – Binary / Switch';
  if (dpt_main === 5) return 'DPT 5.x – 8-bit unsigned';
  if (dpt_main === 9) return 'DPT 9.x – 2-byte float';
  if (dpt_main != null) return `DPT ${dpt_main}.x`;
  return 'Unknown DPT';
};

const SOURCE_NAME_TEXT_STYLE: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--text-main)',
  fontWeight: 500,
  marginTop: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

type TelegramRow = TelegramRowOf<Telegram>;

const cellPadding = '0.25rem 1rem'; // Tight vertical pad so more two-line rows fit
/** Primary line: address/time/value plus the 14px action icons. */
const TT_LINE1 = '1.4rem';
/** Second line: name, date, direction, description, raw, or the other Δt. */
const TT_LINE2 = '1.05rem';
/** Every body cell is exactly two lines, so row height stays uniform. */
const cellBox: React.CSSProperties = {
  padding: cellPadding,
  minWidth: 0,
  overflow: 'hidden',
  display: 'grid',
  gridTemplateRows: `${TT_LINE1} ${TT_LINE2}`,
  alignItems: 'center',
  rowGap: '0.05rem',
  lineHeight: 1.2,
};
const ROW_ESTIMATE = 85; // virtualizer hint; measureElement uses the real two-line height
/** Fill-axis overscroll rubber; rubber-bands back to the edge telegram. */
const FILL_RUBBER_PX = Math.round(ROW_ESTIMATE / 2);
/** Stable empty backlog so a missing prop does not change identity every render. */
const EMPTY_PAUSED: Telegram[] = [];
const EDGE_SCROLL_EPS = 20;
/**
 * Truly empty cells sit on the dark inset. Whitespace-only counts as input
 * (lighter field) even though it still adds no filter predicate.
 */
const qfInputClass = (value: string) =>
  `quick-filter-bar-input${value === '' ? ' idle' : ''}`;

/** Turn `keys` on or off inside a side's flag list. Other keys stay as they are. */
function withSide(current: readonly string[], keys: readonly string[], on: boolean): string[] {
  const drop = new Set(keys);
  const next = current.filter(k => !drop.has(k));
  if (!on) return next;
  const have = new Set(next);
  for (const k of keys) {
    if (have.has(k)) continue;
    have.add(k);
    next.push(k);
  }
  return next;
}

function headerSideTitle(side: 'before' | 'after', state: TriState): string {
  const name = side === 'before' ? 'before (−)' : 'after (+)';
  if (state === 'all') {
    return `Time-Delta-Context ${name}: on for every visible row. Click turns it off. Ctrl/Cmd-click turns it off.`;
  }
  if (state === 'some') {
    return `Time-Delta-Context ${name}: mixed — some visible rows are on. Click turns them off. Ctrl/Cmd-click turns every visible row on.`;
  }
  return `Time-Delta-Context ${name}: off. Click turns every visible row on. Ctrl/Cmd-click turns every visible row on.`;
}

function headerSideLabel(side: 'before' | 'after', state: TriState): string {
  const word = state === 'all' ? 'all' : state === 'some' ? 'some' : 'none';
  return `Time-Delta-Context ${side}: ${word}`;
}

/** One header tristate for a single context side (− before, or + after). */
function ContextSideHeaderToggle({
  side,
  state,
  onClick,
}: {
  side: 'before' | 'after';
  state: TriState;
  onClick: (e: React.MouseEvent) => void;
}) {
  const on = state !== 'none';
  const Icon = side === 'after' ? Plus : Minus;
  return (
    <span
      role="checkbox"
      aria-checked={triStateAriaChecked(state)}
      aria-label={headerSideLabel(side, state)}
      data-context-header-side={side}
      title={headerSideTitle(side, state)}
      onClick={e => {
        e.stopPropagation();
        onClick(e);
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 16, height: 16, flexShrink: 0, boxSizing: 'border-box',
        borderRadius: '50%',
        borderStyle: 'solid',
        borderWidth: 1.5,
        borderColor: on ? 'var(--accent-primary)' : 'var(--text-dim)',
        userSelect: 'none', cursor: 'pointer',
        color: on ? 'var(--accent-primary)' : 'var(--text-dim)',
      }}
    >
      {state === 'all' ? (
        <span
          aria-hidden
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--accent-primary)',
          }}
        />
      ) : (
        <Icon size={10} strokeWidth={1.5} aria-hidden />
      )}
    </span>
  );
}

/**
 * Most pause-backlog rows revealed per step. Must stay below the virtualizer's
 * overscan so the row pinned across the insert is still rendered and can be
 * re-positioned from its real DOM rect (no estimate-based refind).
 */
const REVEAL_MAX = 8;
/** Visual scrollbar track width (matches header paddingRight / index.css). */
const LIST_SB_WIDTH_PX = 8;
const LIST_SB_MIN_THUMB_PX = 20;
// Floating edge pills (newer / marks): inset from the live edge, then half a
// single-line pill height so 1- and 2-line marks stay on the same center as newer.
/** CSS default for one DOM_DELTA_LINE when an overlay must scroll the port itself. */
const WHEEL_LINE_PX = 16;

function wheelAxisPx(delta: number, mode: number, pagePx: number): number {
  if (mode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_PX;
  if (mode === WheelEvent.DOM_DELTA_PAGE) return delta * pagePx;
  return delta;
}
function ReadingSpacer({
  height,
  markerPx,
  markerAt,
  label,
}: {
  height: number;
  markerPx: number;
  markerAt: 'start' | 'end';
  label: string;
}) {
  const marker = markerPx > 0 ? (
    <div
      data-testid="reading-end-marker"
      style={{
        height: markerPx,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-dim)',
        fontSize: '0.75rem',
      }}
    >
      {label}
    </div>
  ) : null;
  return (
    <div
      data-testid="reading-spacer"
      style={{ height, width: '100%', display: 'flex', flexDirection: 'column' }}
    >
      {markerAt === 'start' ? marker : null}
      <div aria-hidden style={{ flex: '1 1 auto' }} />
      {markerAt === 'end' ? marker : null}
    </div>
  );
}

const EDGE_PILL_INSET = '1rem';
const EDGE_PILL_HALF = '0.85rem';
const EDGE_PILL_CENTER = `calc(${EDGE_PILL_INSET} + ${EDGE_PILL_HALF})`;

function timeMs(timestamp: string): number {
  return new Date(timestamp).getTime();
}

interface VirtualEdgeItem {
  index: number;
  start: number;
  size: number;
}

/**
 * Merged rows completely scrolled out toward `edge` (partial overlap does not
 * count). Rows outside the rendered window are fully out; only the
 * already-rendered edge items are inspected, so this stays O(overscan).
 * `leadPx` is scroll content before the virtualizer when item `start` is
 * relative to that block. Display mode puts the same lead in `scrollMargin`,
 * so `start` is already a scroll offset and callers pass 0.
 */
function countMergedScrolledOut(
  rowCount: number,
  edge: 'top' | 'bottom',
  scrollTop: number,
  clientHeight: number,
  virtualItems: readonly VirtualEdgeItem[],
  leadPx = 0,
): number {
  if (rowCount === 0 || clientHeight <= 0 || virtualItems.length === 0) return 0;
  const viewTop = scrollTop - leadPx;
  const viewBottom = scrollTop + clientHeight - leadPx;
  if (edge === 'top') {
    const first = virtualItems[0];
    let extra = 0;
    for (const item of virtualItems) {
      if (item.size > 0 && item.start + item.size <= viewTop) extra++;
      else break;
    }
    return first.index + extra;
  }
  const last = virtualItems[virtualItems.length - 1];
  let extra = 0;
  for (let i = virtualItems.length - 1; i >= 0; i--) {
    const item = virtualItems[i];
    if (item.size > 0 && item.start >= viewBottom) extra++;
    else break;
  }
  return (rowCount - 1 - last.index) + extra;
}

// ── Quick filter bar (#271, #309) ────────────────────────────────────────────
// Two rows per applicable column: a top pattern row (address/DPT-key patterns
// with wildcards and ranges, or a from/range bound) and a bottom text row
// (regex/literal, or a to/range bound). TYPE only uses the top row (a
// comma-separated fixed-value list); DELTA doesn't participate here at all —
// it edits the Time-Delta-Context window instead (#371).

function useLiftedKeyList(
  prop: readonly string[] | undefined,
  onChange?: (keys: string[]) => void,
) {
  const [internal, setInternal] = useState<string[]>([]);
  const list = prop ?? internal;
  const ref = useRef(list);
  // eslint-disable-next-line react-hooks/refs -- setList reads the latest list without stale closures
  ref.current = list;
  const setList = useCallback((val: readonly string[] | ((prev: readonly string[]) => readonly string[])) => {
    const prev = ref.current;
    const next = typeof val === 'function' ? val(prev) : val;
    if (next === prev) return;
    ref.current = next;
    const mutable = next as string[];
    setInternal(mutable);
    onChange?.(mutable);
  }, [onChange]);
  return [list, setList, ref] as const;
}

export const TelegramTable: React.FC<TelegramTableProps> = ({
  telegrams, readPhaseTelegrams, forceIncludeFrom, visibleColumns, sortConfig, onSort, activeFilters, projectTargets, onQuickFilter, onQuickVisualize, onQuickLastSeen, canSend,
  onGotoTelegram, latestTelegram, onAltSend, onCtrlSend, sendPanelAddresses,
  activeSendJobAddresses, gaJobStatuses, linkedStatus = null,
  onScheduleCommit, onWriteWithSchedule, onReadWithSchedule, onCancelLinked, onClearLinked,
  quickFilterOpen, onQuickFilterOpenChange, quickFilterEnabled, onQuickFilterEnabledChange, quickPatterns, onQuickPatternsChange,
  quickColumnEnabled: quickColumnEnabledProp, onQuickColumnEnabledChange,
  onDeltaContextChange,
  onDeltaContextEnabledChange,
  qfContext = null,
  onQfContextChange,
  listFollow, onListFollowChange, liveFollow = true, readDirection, directionGesture = 'rebuild',
  covered, bufferAnchorTs = null, readingEnd,
  listAnchorKey, onListAnchorKeyChange,
  isPaused = false, isManualPause = false, filtersEnabled = true, sidePanelFilters, pausedCount = 0,
  pausedTelegrams = EMPTY_PAUSED,
  onPauseFlush, onPauseReveal, onJumpToLive,
  markedKeys: markedKeysProp, onMarkedKeysChange,
  mouseSelectedKeys: mouseSelectedKeysProp, onMouseSelectedKeysChange,
  lastSelectedKey, onLastSelectedKeyChange,
  hiddenKeys: hiddenKeysProp, onHiddenKeysChange,
  markColorIndices: markColorIndicesProp, onMarkColorIndicesChange,
  infoBarOpen, onInfoBarOpenChange,
  flaggedBeforeKeys, onFlaggedBeforeKeysChange,
  flaggedAfterKeys, onFlaggedAfterKeysChange,
  contextKeys,
  contextParents,
  gotoRequest,
  bufferOldestMs = null,
  bufferNewestMs = null,
  gotoScope = 'live',
  jumpTargetKeys,
  onJumpTarget,
  onGotoFillOlder,
  onGotoFillNewer,
  viewChangeToken,
  onFocusCategorySelect,
  focusListAddresses,
  sourceFocusOnly: sourceFocusOnlyProp,
  onSourceFocusOnlyChange,
  targetFocusOnly: targetFocusOnlyProp,
  onTargetFocusOnlyChange,
  focusFilterDisabled = false,
  headerLeading,
  headerCenter,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  /** Inner virtualizer canvas — used for clamped-pin settle transforms. */
  const listContentRef = useRef<HTMLDivElement>(null);
  // Bumped by display-changing actions; layout effect restores the pending pin.
  const [displayPinNonce, setDisplayPinNonce] = useState(0);
  /** Viewport snapshot taken before a display change (key + offset from list top). */
  const pendingDisplayPinRef = useRef<{ key: string; offset: number } | null>(null);
  /** Last known viewport offset of the preferred selection (survives App-driven refilters). */
  const lastKnownPreferredPinRef = useRef<{ key: string; offset: number } | null>(null);
  /** Skip destructive refilter handling in the list-update layout effect once. */
  const suppressListRefilterEffectRef = useRef(false);
  const requestDisplayPinRef = useRef<(explicitKey?: string) => void>(() => {});
  /** Mousedown on a row's context button: that row, before context rows appear. */
  const contextButtonPinRef = useRef<(key: string) => void>(() => {});

  // ── Column widths (persisted, shared across live & history views) ──
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    for (const c of COLUMNS) defaults[c.id] = c.defaultWidth;
    try {
      const saved = getPref(COLUMN_WIDTHS_PREF);
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch {
      // Ignore malformed stored value
    }
    return defaults;
  });

  // ── Column order (persisted, shared across live & history views) ──
  // Drag a column header onto another to move it before or after that column.
  const [columnOrder, setColumnOrder] = useState<string[]>(() => readColumnOrderPref(COLUMNS.map(c => c.id)));
  const [draggingColumn, setDraggingColumn] = useState<ColId | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: ColId; side: 'before' | 'after' } | null>(null);
  // Where the press that may become a drag started: a drag must not begin from
  // a text field or the resize handle inside a header cell.
  const dragOriginRef = useRef<EventTarget | null>(null);

  const endColumnDrag = useCallback(() => {
    setDraggingColumn(null);
    setDropTarget(null);
  }, []);

  const dropColumn = useCallback((target: ColId, side: 'before' | 'after') => {
    if (draggingColumn && draggingColumn !== target) {
      setColumnOrder(prev => {
        const next = moveColumn(prev, draggingColumn, target, side);
        writeColumnOrderPref(next);
        return next;
      });
    }
    endColumnDrag();
  }, [draggingColumn, endColumnDrag]);

  const widthFor = useCallback(
    (id: ColId) => columnWidths[id] ?? COLUMNS.find(c => c.id === id)!.defaultWidth,
    [columnWidths],
  );

  const persistWidths = useCallback((widths: Record<string, number>) => {
    setPref(COLUMN_WIDTHS_PREF, JSON.stringify(widths));
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent, col: ColumnDef) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthFor(col.id);
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(col.minWidth, Math.round(startWidth + (ev.clientX - startX)));
      setColumnWidths(prev => ({ ...prev, [col.id]: next }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setColumnWidths(prev => { persistWidths(prev); return prev; });
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [widthFor, persistWidths]);

  // Double-click a handle to reset that column to its default width.
  const handleResetWidth = useCallback((col: ColumnDef) => {
    setColumnWidths(prev => {
      const next = { ...prev, [col.id]: col.defaultWidth };
      persistWidths(next);
      return next;
    });
  }, [persistWidths]);

  // ── Quick filter bar (#271): per-column regex/literal filter on top of the
  // complex filter. Expanding enables it, collapsing disables it; the toggle
  // in the bar switches it without losing the patterns.
  const [internalQuickOpen, setInternalQuickOpen] = useState(false);
  const [internalQuickEnabled, setInternalQuickEnabled] = useState(false);
  const [internalQuickPatterns, setInternalQuickPatterns] = useState<QuickPatterns>({});

  const quickOpen = quickFilterOpen ?? internalQuickOpen;
  const setQuickOpen = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(quickOpen) : val;
    setInternalQuickOpen(next);
    onQuickFilterOpenChange?.(next);
  }, [quickOpen, onQuickFilterOpenChange]);

  const quickEnabled = quickFilterEnabled ?? internalQuickEnabled;
  const setQuickEnabled = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(quickEnabled) : val;
    setInternalQuickEnabled(next);
    onQuickFilterEnabledChange?.(next);
  }, [quickEnabled, onQuickFilterEnabledChange]);

  const currentPatterns = quickPatterns ?? internalQuickPatterns;
  const setQuickPatterns = useCallback((val: QuickPatterns | ((prev: QuickPatterns) => QuickPatterns)) => {
    const next = typeof val === 'function' ? val(currentPatterns) : val;
    setInternalQuickPatterns(next);
    onQuickPatternsChange?.(next);
  }, [currentPatterns, onQuickPatternsChange]);

  const [internalQuickColumnEnabled, setInternalQuickColumnEnabled] = useState<QuickFilterColumnEnabled>(
    () => ({ ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED }),
  );
  const quickColumnEnabled = quickColumnEnabledProp ?? internalQuickColumnEnabled;
  const quickColumnEnabledRef = useRef(quickColumnEnabled);
  quickColumnEnabledRef.current = quickColumnEnabled;
  const setQuickColumnEnabled = useCallback((val: QuickFilterColumnEnabled | ((prev: QuickFilterColumnEnabled) => QuickFilterColumnEnabled)) => {
    const prev = quickColumnEnabledRef.current;
    const next = typeof val === 'function' ? val(prev) : val;
    if (next === prev) return;
    quickColumnEnabledRef.current = next;
    setInternalQuickColumnEnabled(next);
    onQuickColumnEnabledChange?.(next);
  }, [onQuickColumnEnabledChange]);

  // Applied side-panel window is the ceiling. History passes the last refresh;
  // the monitor applies the panel immediately, so the live filters are that ceiling.
  const appliedContext = sidePanelFilters ?? activeFilters;
  const contextCap = useMemo(
    () => ({ before: appliedContext.deltaBeforeMs, after: appliedContext.deltaAfterMs }),
    [appliedContext.deltaBeforeMs, appliedContext.deltaAfterMs],
  );
  const contextEnabled = appliedContext.deltaContextEnabled;
  const [qfInternal, setQfInternal] = useState<{ before: number; after: number } | null>(null);
  const qfControlled = onQfContextChange != null;
  const qfExplicit = qfControlled ? qfContext : qfInternal;
  const qfShown = qfExplicit ? capContextWindow(qfExplicit, contextCap) : contextCap;
  const qfBeforeMs = qfShown.before;
  const qfAfterMs = qfShown.after;
  const deltaBeforeMs = contextEnabled ? qfBeforeMs : 0;
  const deltaAfterMs = contextEnabled ? qfAfterMs : 0;

  const publishQf = useCallback((before: number, after: number) => {
    const next = capContextWindow({ before, after }, contextCap);
    if (qfControlled) onQfContextChange?.(next);
    else {
      setQfInternal(next);
      onDeltaContextChange?.(next.before, next.after);
    }
  }, [contextCap, qfControlled, onQfContextChange, onDeltaContextChange]);

  // A later, smaller applied window cuts bounds the user already entered.
  useEffect(() => {
    if (!qfExplicit) return;
    const next = capContextWindow(qfExplicit, contextCap);
    if (next.before === qfExplicit.before && next.after === qfExplicit.after) return;
    publishQf(next.before, next.after);
  }, [qfExplicit, contextCap, publishQf]);

  /** True when at least one quick-filter cell of the column has a value (blanks count). */
  const columnHasQuickContent = useCallback((id: ColId) => {
    if (id === 'delta') {
      return qfBeforeMs > 0 || qfAfterMs > 0;
    }
    const cell = currentPatterns[id];
    return !!(cell?.top || cell?.bottom);
  }, [qfBeforeMs, qfAfterMs, currentPatterns]);

  /** Turn a column filter on the first time an empty cell receives text. */
  const enableQuickColumnOnInput = useCallback((id: ColId) => {
    setQuickColumnEnabled(prev => (prev[id] === false ? { ...prev, [id]: true } : prev));
    setQuickEnabled(true);
  }, [setQuickColumnEnabled, setQuickEnabled]);

  /** Turn a column filter off when both of its quick-filter cells are empty. */
  const disableQuickColumnWhenEmpty = useCallback((id: ColId) => {
    setQuickColumnEnabled(prev => (prev[id] === false ? prev : { ...prev, [id]: false }));
  }, [setQuickColumnEnabled]);

  /** Updates one row (top/bottom) of a quick-filter cell, preserving the other row. */
  const patternPinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setQuickCell = useCallback((id: ColId, row: 'top' | 'bottom', text: string) => {
    const prevCell = currentPatterns[id] ?? EMPTY_CELL;
    const nextCell = { ...prevCell, [row]: text };
    setQuickPatterns(prev => ({ ...prev, [id]: nextCell }));
    // Whitespace-only still counts as input for enable/idle; trim only for filter match.
    const bothEmpty = nextCell.top === '' && nextCell.bottom === '';
    if (bothEmpty) disableQuickColumnWhenEmpty(id);
    else if (prevCell[row] === '' && text !== '') enableQuickColumnOnInput(id);
    // Debounce pin/flash while typing so each keystroke does not thrash the list.
    if (patternPinTimerRef.current) clearTimeout(patternPinTimerRef.current);
    patternPinTimerRef.current = setTimeout(() => requestDisplayPinRef.current(), 250);
  }, [setQuickPatterns, currentPatterns, enableQuickColumnOnInput, disableQuickColumnWhenEmpty]);

  const setDeltaContextCell = useCallback((beforeMs: number, afterMs: number) => {
    const prevEmpty = qfBeforeMs <= 0 && qfAfterMs <= 0;
    const next = capContextWindow({ before: beforeMs, after: afterMs }, contextCap);
    const nextEmpty = next.before <= 0 && next.after <= 0;
    publishQf(next.before, next.after);
    if (prevEmpty && !nextEmpty) {
      enableQuickColumnOnInput('delta');
      if (!activeFilters.deltaContextEnabled) onDeltaContextEnabledChange?.(true);
    } else if (!prevEmpty && nextEmpty) {
      disableQuickColumnWhenEmpty('delta');
    }
    requestDisplayPinRef.current();
  }, [
    qfBeforeMs, qfAfterMs, contextCap, publishQf,
    activeFilters.deltaContextEnabled,
    onDeltaContextEnabledChange, enableQuickColumnOnInput, disableQuickColumnWhenEmpty,
  ]);

  const clearQuickColumnInputs = useCallback((id: ColId) => {
    if (id === 'delta') {
      publishQf(0, 0);
      disableQuickColumnWhenEmpty('delta');
      return;
    }
    setQuickPatterns(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    disableQuickColumnWhenEmpty(id);
  }, [publishQf, setQuickPatterns, disableQuickColumnWhenEmpty]);

  const clearAllQuickInputs = useCallback(() => {
    setQuickPatterns({});
    publishQf(0, 0);
    setQuickColumnEnabled(prev => {
      const next = { ...prev };
      for (const id of Object.keys(DEFAULT_QUICK_FILTER_COLUMN_ENABLED)) next[id] = false;
      return next;
    });
  }, [publishQf, setQuickPatterns, setQuickColumnEnabled]);

  // A column filter is only on when it is toggled on and has at least one cell value.
  const isQuickColumnEnabled = useCallback(
    (id: ColId) => quickColumnEnabled[id] !== false && columnHasQuickContent(id),
    [quickColumnEnabled, columnHasQuickContent],
  );

  const toggleQuickColumnEnabled = useCallback((id: ColId) => {
    setQuickColumnEnabled(prev => {
      const storedOn = prev[id] !== false;
      const hasContent = columnHasQuickContent(id);
      if (storedOn && hasContent) return { ...prev, [id]: false };
      if (!hasContent) return storedOn ? { ...prev, [id]: false } : prev;
      return { ...prev, [id]: true };
    });
  }, [setQuickColumnEnabled, columnHasQuickContent]);

  const handleQuickColumnToggleClick = useCallback((e: React.MouseEvent, id: ColId) => {
    if (e.ctrlKey || e.metaKey) {
      // DELTA: ctrl toggles the Time-Delta-Context window without clearing values (#318).
      if (id === 'delta') {
        if (!columnHasQuickContent('delta') && !activeFilters.deltaContextEnabled) return;
        onDeltaContextEnabledChange?.(!activeFilters.deltaContextEnabled);
        requestDisplayPinRef.current();
        return;
      }
      clearQuickColumnInputs(id);
      requestDisplayPinRef.current();
      return;
    }
    toggleQuickColumnEnabled(id);
    requestDisplayPinRef.current();
  }, [
    clearQuickColumnInputs, toggleQuickColumnEnabled, onDeltaContextEnabledChange,
    activeFilters.deltaContextEnabled, columnHasQuickContent,
  ]);

  const handleQuickEnabledToggleClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      clearAllQuickInputs();
      requestDisplayPinRef.current();
      return;
    }
    setQuickEnabled(prev => !prev);
    requestDisplayPinRef.current();
  }, [clearAllQuickInputs, setQuickEnabled]);

  const toggleQuickOpen = () => {
    const nextOpen = !quickOpen;
    setQuickOpen(nextOpen);
    setQuickEnabled(nextOpen);
    requestDisplayPinRef.current();
  };

  // ── Quick info bar (#311): collapsible summary row above the header. ──────
  const [internalInfoBarOpen, setInternalInfoBarOpen] = useState(false);
  const infoOpen = infoBarOpen ?? internalInfoBarOpen;
  const toggleInfoOpen = useCallback(() => {
    const next = !infoOpen;
    setInternalInfoBarOpen(next);
    onInfoBarOpenChange?.(next);
  }, [infoOpen, onInfoBarOpenChange]);
  const showInfoBarToggle = !infoOpen;

  // ── Focus filter toggles (header SOURCE/TARGET) ───────────────────────────
  const [internalSourceFocusOnly, setInternalSourceFocusOnly] = useState(
    () => getPref('telegramTable.sourceFocusOnly') === '1',
  );
  const [internalTargetFocusOnly, setInternalTargetFocusOnly] = useState(
    () => getPref('telegramTable.targetFocusOnly') === '1',
  );
  const sourceFocusOnly = sourceFocusOnlyProp ?? internalSourceFocusOnly;
  const targetFocusOnly = targetFocusOnlyProp ?? internalTargetFocusOnly;
  const setSourceFocusOnly = useCallback((next: boolean) => {
    if (onSourceFocusOnlyChange) onSourceFocusOnlyChange(next);
    else setInternalSourceFocusOnly(next);
  }, [onSourceFocusOnlyChange]);
  const setTargetFocusOnly = useCallback((next: boolean) => {
    if (onTargetFocusOnlyChange) onTargetFocusOnlyChange(next);
    else setInternalTargetFocusOnly(next);
  }, [onTargetFocusOnlyChange]);
  useEffect(() => {
    setPref('telegramTable.sourceFocusOnly', sourceFocusOnly ? '1' : '0');
  }, [sourceFocusOnly]);
  useEffect(() => {
    setPref('telegramTable.targetFocusOnly', targetFocusOnly ? '1' : '0');
  }, [targetFocusOnly]);

  // ── Hide repeated values when a non-time column is sorted (alt-click) ─────
  const [hideRepeatedOverrides, setHideRepeatedOverrides] = useState<Partial<Record<ColId, boolean>>>({});
  const isHideRepeatedWhenSortedEnabled = useCallback((id: ColId): boolean => {
    const override = hideRepeatedOverrides[id];
    if (override !== undefined) return override;
    return true;
  }, [hideRepeatedOverrides]);
  const toggleHideRepeatedWhenSortedForColumn = useCallback((id: ColId) => {
    if (id === 'time' || id === 'delta') return;
    setHideRepeatedOverrides(prev => {
      const current = prev[id] ?? true;
      return { ...prev, [id]: !current };
    });
  }, []);

  // ── Row flags (#310) ─────────────────────────────────────────────────────
  // Controlled when App lifts them (so they survive navigation), otherwise a
  // local fallback. `marked` is the only mark. Mouse selection and last
  // selected are separate flags. Context is `contextKeys`. `lastSelectedKey`
  // may legitimately be null, so distinguish "not lifted" (undefined) from
  // "lifted, nothing last" (null).
  const [markedKeyList, setMarkedKeyList, markedKeyListRef] = useLiftedKeyList(markedKeysProp, onMarkedKeysChange);
  const [mouseKeyList, setMouseKeyList, mouseKeyListRef] = useLiftedKeyList(mouseSelectedKeysProp, onMouseSelectedKeysChange);
  const [internalLastSelectedKey, setInternalLastSelectedKey] = useState<string | null>(null);

  const [internalMarkColorIndices, setInternalMarkColorIndices] = useState<MarkColorIndexMap>({});
  const markColorIndices = markColorIndicesProp ?? internalMarkColorIndices;
  const markColorIndicesRef = useRef(markColorIndices);
  markColorIndicesRef.current = markColorIndices;
  /** Last colour a swatch click applied. Ctrl-click clears rows without forgetting it. */
  const lastSetColorRef = useRef<number | null>(null);
  const setMarkColorIndices = useCallback((val: MarkColorIndexMap | ((prev: MarkColorIndexMap) => MarkColorIndexMap)) => {
    const prev = markColorIndicesRef.current;
    const next = typeof val === 'function' ? val(prev) : val;
    if (next === prev) return;
    markColorIndicesRef.current = next;
    setInternalMarkColorIndices(next);
    onMarkColorIndicesChange?.(next);
  }, [onMarkColorIndicesChange]);

  const [internalHiddenKeys, setInternalHiddenKeys] = useState<string[]>([]);
  const hiddenKeyList = hiddenKeysProp ?? internalHiddenKeys;
  const hiddenKeyListRef = useRef(hiddenKeyList);
  hiddenKeyListRef.current = hiddenKeyList;
  /** Rows whose hide flag a ctrl-click on Show hidden can invert. */
  const hideToggleKeysRef = useRef<readonly string[]>([]);
  const setHiddenKeyList = useCallback((val: string[] | ((prev: readonly string[]) => string[])) => {
    const prev = hiddenKeyListRef.current;
    const next = typeof val === 'function' ? val(prev) : val;
    if (next === prev) return;
    hiddenKeyListRef.current = next;
    setInternalHiddenKeys(next);
    onHiddenKeysChange?.(next);
  }, [onHiddenKeysChange]);

  const lastSelected = lastSelectedKey !== undefined ? lastSelectedKey : internalLastSelectedKey;
  const lastSelectedRef = useRef(lastSelected);
  lastSelectedRef.current = lastSelected;
  const setLastSelected = useCallback((val: string | null) => {
    setInternalLastSelectedKey(val);
    onLastSelectedKeyChange?.(val);
  }, [onLastSelectedKeyChange]);

  const hiddenKeySet = useMemo(() => new Set(hiddenKeyList), [hiddenKeyList]);
  const markedKeySet = useMemo(() => new Set(markedKeyList), [markedKeyList]);
  const mouseKeySet = useMemo(() => new Set(mouseKeyList), [mouseKeyList]);
  // Mouse-selected keys — rail colour / mark actions apply to this set when
  // the clicked row is part of the selection.
  const targetsForSelectionAction = useCallback((key: string) => {
    if (mouseKeyList.includes(key)) return new Set(mouseKeyList);
    return new Set([key]);
  }, [mouseKeyList]);
  // The marks pill counts the marked flag only. Hidden rows leave the list;
  // their mark comes back when they are shown. Mouse selection stays in the
  // list too, without counting as a mark.
  const visibleMarkedKeys = useMemo(
    () => markedKeyList.filter(k => !hiddenKeySet.has(k)),
    [markedKeyList, hiddenKeySet],
  );
  const actionableMarkedKeys = visibleMarkedKeys;
  const actionableMarkedSet = useMemo(
    () => new Set(actionableMarkedKeys),
    [actionableMarkedKeys],
  );
  const pinnedKeySet = useMemo(() => {
    const keys = new Set<string>();
    for (const key of markedKeyList) if (!hiddenKeySet.has(key)) keys.add(key);
    for (const key of mouseKeyList) if (!hiddenKeySet.has(key)) keys.add(key);
    if (lastSelected && !hiddenKeySet.has(lastSelected)) keys.add(lastSelected);
    for (const key of jumpTargetKeys ?? []) if (!hiddenKeySet.has(key)) keys.add(key);
    return keys;
  }, [markedKeyList, mouseKeyList, lastSelected, jumpTargetKeys, hiddenKeySet]);
  // Two-line pill: one nav button per row; single-line keeps prev+next.
  const twoLineMarksPill = actionableMarkedKeys.length > 0 && hiddenKeyList.length > 0;
  // Row the prev/next-mark jumps continue from (#442); null after a user scroll.
  const markCursorRef = useRef<string | null>(null);
  // Plain mousedrag is text selection: record pointer down so click can skip
  // marking when the pointer moved (a mark re-render would wipe the selection).
  const markPointerRef = useRef<{ x: number; y: number } | null>(null);
  // Click on a visible row: hold its viewport offset from mousedown until mouseup.
  const clickPinHoldRef = useRef(false);
  /** Mouseup asked the next layout to release the hold and fill the viewport. */
  const settleClickPinRef = useRef(false);
  const clickGestureRef = useRef<{
    key: string;
    index: number;
    x: number;
    y: number;
    additive: boolean;
    range: boolean;
    selected: boolean;
  } | null>(null);
  /** The click that follows mouseup must not select a second time. */
  const swallowNextRowClickRef = useRef(false);
  const clickGestureEndRef = useRef<(e: Event) => void>(() => {});
  const onClickGestureEnd = useRef((e: Event) => { clickGestureEndRef.current(e); }).current;
  // Scroll anchor (#435): the last-selected row, from a click or a goto.
  const selectedKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = lastSelected;
    selectedKeyRef.current = key && !hiddenKeySet.has(key) ? key : null;
  }, [lastSelected, hiddenKeySet]);

  // Clear the marked flag on rows that are still shown. Hidden rows keep the
  // flag. Mouse selection, last selected, and context stay.
  const clearMarks = useCallback(() => {
    const hidden = new Set(hiddenKeyListRef.current);
    const toClear = markedKeyListRef.current.filter(k => !hidden.has(k));
    if (toClear.length === 0) return;
    setMarkedKeyList(prev => removeKeys(prev, toClear));
    setMarkColorIndices(prev => {
      let next = prev;
      for (const key of toClear) next = setMarkColorIndex(next, key, null);
      return next;
    });
    requestDisplayPinRef.current();
  }, [setMarkedKeyList, setMarkColorIndices]);

  const hideMarkedRows = useCallback(() => {
    const hidden = new Set(hiddenKeyListRef.current);
    const marks = markedKeyListRef.current.filter(k => !hidden.has(k));
    if (marks.length === 0) return;
    setHiddenKeyList(prev => {
      const next = new Set(prev);
      for (const k of marks) next.add(k);
      return [...next];
    });
    requestDisplayPinRef.current();
  }, [setHiddenKeyList]);

  const showHiddenRows = useCallback(() => {
    if (hiddenKeyListRef.current.length === 0) return;
    setHiddenKeyList([]);
    requestDisplayPinRef.current();
  }, [setHiddenKeyList]);

  const toggleAllRowHidden = useCallback(() => {
    const hidden = new Set(hiddenKeyListRef.current);
    const next: string[] = [];
    for (const key of hideToggleKeysRef.current) {
      if (!hidden.has(key)) next.push(key);
    }
    setHiddenKeyList(next);
    requestDisplayPinRef.current();
  }, [setHiddenKeyList]);

  // ── Per-side Time-Delta-Context flags ────────────────────────────────────
  const [internalBeforeKeys, setInternalBeforeKeys] = useState<string[]>([]);
  const [internalAfterKeys, setInternalAfterKeys] = useState<string[]>([]);
  const beforeList = flaggedBeforeKeys ?? internalBeforeKeys;
  const afterList = flaggedAfterKeys ?? internalAfterKeys;
  const setBeforeList = useCallback((val: string[]) => {
    setInternalBeforeKeys(val);
    onFlaggedBeforeKeysChange?.(val);
  }, [onFlaggedBeforeKeysChange]);
  const setAfterList = useCallback((val: string[]) => {
    setInternalAfterKeys(val);
    onFlaggedAfterKeysChange?.(val);
  }, [onFlaggedAfterKeysChange]);
  const beforeSet = useMemo(() => new Set(beforeList), [beforeList]);
  const afterSet = useMemo(() => new Set(afterList), [afterList]);

  // Colours given to target filters (#509) apply while the address is in the
  // filter, switched off or not; a colour of a removed filter is kept for when
  // it comes back, but marks nothing meanwhile.
  const targetColors = useTargetColors();
  const activeTargetColors = useMemo(() => {
    const active: Record<string, string> = {};
    for (const address of activeFilters.targets) {
      if (targetColors[address]) active[address] = targetColors[address];
    }
    return active;
  }, [targetColors, activeFilters.targets]);

  // Focus filter runs before quick-filter once the parent supplies a focus list.
  // Without `focusListAddresses` the header toggles stay visual-only (no Focus
  // panel wired yet). An empty list means no matches.
  const focusFilteringActive =
    (sourceFocusOnly || targetFocusOnly) && !focusFilterDisabled && focusListAddresses != null;

  // Context rows are already the result of the Time-Delta-Context expansion,
  // which the parent runs on quick-filter matches too. Filtering them here
  // again would drop the context (#520). A context button does not keep a
  // non-matching row. Visible marks and mouse selections are always kept;
  // hide-flagged rows are always dropped.
  // Prefer `forceIncludeFrom` (full buffer) so marks survive even when the parent
  // already dropped them from `telegrams`. List pool stays published-only so
  // pause backlog never leaks into rows; pill pool adds paused for mark restore.
  const applyTableVisibility = useCallback((rows: Telegram[], pool: Telegram[]) => {
    if (
      !focusFilteringActive &&
      !(quickOpen && quickEnabled) &&
      hiddenKeySet.size === 0 &&
      pinnedKeySet.size === 0
    ) {
      return rows;
    }
    let list = rows;
    if (focusFilteringActive) {
      const focusListSet = new Set(focusListAddresses);
      list = list.filter(t =>
        (!sourceFocusOnly || focusListSet.has(t.source_address)) &&
        (!targetFocusOnly || focusListSet.has(t.target_address)),
      );
    }
    if (quickOpen && quickEnabled) {
      const matches = compileQuickFilters(currentPatterns, quickColumnEnabled);
      list = list.filter(t => matches(t) || !!contextKeys?.has(anchorKey(t)));
    }
    list = list.filter(t => !hiddenKeySet.has(anchorKey(t)));
    return forceIncludeKeys(pool, list, anchorKey, pinnedKeySet)
      .filter(t => !hiddenKeySet.has(anchorKey(t)));
  }, [
    focusFilteringActive, focusListAddresses, sourceFocusOnly, targetFocusOnly,
    quickOpen, quickEnabled, currentPatterns, quickColumnEnabled, contextKeys,
    hiddenKeySet, pinnedKeySet,
  ]);

  const listForcePool = forceIncludeFrom ?? telegrams;
  // Zebra parity follows this pool index (not the compacted visible index), so
  // filter / QF toggles do not recolour surviving telegrams.
  const [stripeState] = useState(createStripeState<Telegram>);
  const stripeIndexByKey = useMemo(
    () => stripeState.update(listForcePool, anchorKey),
    [stripeState, listForcePool],
  );
  const quickFiltered = useMemo(
    () => applyTableVisibility(telegrams, listForcePool),
    [applyTableVisibility, telegrams, listForcePool],
  );
  // Same row array when the gapless run does not drop anything, so a coverage
  // tick that only moves the live tail does not look like a new list.
  const contigCacheRef = useRef<{ sig: string; rows: Telegram[] }>({ sig: '', rows: [] });
  const coverageFiltered = useMemo(() => {
    if (readDirection == null || covered == null) return quickFiltered;
    const anchorTs = bufferAnchorTs ?? (
      readDirection === 'forward' ? bufferOldestMs : bufferNewestMs
    );
    if (anchorTs == null) return quickFiltered;
    const kept = contiguousFromAnchor(quickFiltered, anchorTs, readDirection, covered);
    if (kept === quickFiltered) return quickFiltered;
    const sig = kept.map(anchorKey).join('\n');
    if (sig === contigCacheRef.current.sig) return contigCacheRef.current.rows;
    contigCacheRef.current = { sig, rows: kept };
    return kept;
  }, [
    quickFiltered, readDirection, covered, bufferAnchorTs, bufferOldestMs, bufferNewestMs,
  ]);

  // Pill count: main filter + QF + delta window + focus + marks. Full scan only
  // when those inputs change; each paused arrival classifies the new row.
  const pillFilters = useMemo(() => enabledFilters(activeFilters), [activeFilters]);
  const noMainFilter = !filtersEnabled || (
    pillFilters.sources.length === 0 &&
    pillFilters.targets.length === 0 &&
    pillFilters.types.length === 0 &&
    pillFilters.directions.length === 0 &&
    pillFilters.dpts.length === 0
  );
  const pillQuick = useMemo(
    () => activeQuickFilter(quickOpen, quickEnabled, currentPatterns, quickColumnEnabled),
    [quickOpen, quickEnabled, currentPatterns, quickColumnEnabled],
  );
  const responseFailsSidePanel = useCallback((row: Telegram) => {
    if (sidePanelFilters) {
      return hasActiveFilters(sidePanelFilters) && !matchesTelegram(row, sidePanelFilters);
    }
    return !noMainFilter && !matchesTelegram(row, pillFilters);
  }, [sidePanelFilters, noMainFilter, pillFilters]);
  const focusAddressSet = useMemo(
    () => (focusFilteringActive ? new Set(focusListAddresses) : null),
    [focusFilteringActive, focusListAddresses],
  );
  const primaryMatch = (t: Telegram) =>
    (noMainFilter || matchesTelegram(t, pillFilters)) && (!pillQuick || pillQuick(t));
  const visiblePausedCount = useMemo(() => {
    if (pausedTelegrams.length === 0) return 0;
    const combined = listForcePool.concat(pausedTelegrams);
    const matches = combined.map(t => {
      const key = anchorKey(t);
      if (hiddenKeySet.has(key)) return false;
      if (focusAddressSet) {
        if (sourceFocusOnly && !focusAddressSet.has(t.source_address)) return false;
        if (targetFocusOnly && !focusAddressSet.has(t.target_address)) return false;
      }
      return primaryMatch(t);
    });
    const pinned = new Set<string>();
    for (const key of pinnedKeySet) if (!hiddenKeySet.has(key)) pinned.add(key);
    const expanded = expandWithDeltaContext(
      combined, matches, anchorKey,
      { before: beforeSet, after: afterSet },
      deltaBeforeMs, deltaAfterMs,
      {
        contextEnabled,
        pinnedKeys: pinned,
      },
    );
    const poolKeys = new Set(listForcePool.map(anchorKey));
    let count = 0;
    for (const t of expanded.items) if (!poolKeys.has(anchorKey(t))) count++;
    return count;
  }, [
    pausedTelegrams, pausedCount, listForcePool, hiddenKeySet, focusAddressSet,
    sourceFocusOnly, targetFocusOnly, noMainFilter, pillFilters, pillQuick, pinnedKeySet,
    beforeSet, afterSet, deltaBeforeMs, deltaAfterMs, contextEnabled,
  ]);
  const visiblePausedCountRef = useRef(0);
  visiblePausedCountRef.current = visiblePausedCount;

  const timeSortDirection: 'asc' | 'desc' | null =
    sortConfig[0]?.key === 'timestamp' ? sortConfig[0].direction : null;

  // Time deltas between consecutive rows, by visual (sorted) order — always
  // computed regardless of sort column, respecting whatever hierarchy is
  // active (#311). Top row = gap to previous, bottom = gap to next.
  // A later Response on the same GA. The live list passes the full buffer,
  // including the pause backlog, so the goto target stays available when the
  // Response is off screen. Without the prop, `telegrams` is the buffer.
  const responseByRead = useMemo(
    () => responsesFollowingReads(readPhaseTelegrams ?? telegrams),
    [readPhaseTelegrams, telegrams],
  );
  // History answers a Read from the loaded set, including a Response the quick
  // filter has dropped from `telegrams`. The live list keeps its own source.
  const historyLoadedByRead = useMemo(
    () => (gotoScope === 'history'
      ? responsesFollowingReads(forceIncludeFrom ?? telegrams)
      : null),
    [gotoScope, forceIncludeFrom, telegrams],
  );
  const shownKeySet = useMemo(
    () => new Set(coverageFiltered.map(anchorKey)),
    [coverageFiltered],
  );
  const [rowCache] = useState(() => ({ source: null as readonly Telegram[] | null, rows: [] as TelegramRow[] }));
  const naturalTelegramRows = useMemo<TelegramRow[]>(() => {
    if (rowCache.source === coverageFiltered) return rowCache.rows;
    const edge = readListEdge(coverageFiltered);
    if (edge && rowCache.source && edge.prev === rowCache.source && timeSortDirection) {
      const patched = patchTelegramRows(coverageFiltered, rowCache.rows, edge, timeSortDirection);
      if (patched) {
        rowCache.source = coverageFiltered;
        rowCache.rows = patched;
        return patched;
      }
    }
    const rows = buildTelegramRows(coverageFiltered, timeSortDirection);
    rowCache.source = coverageFiltered;
    rowCache.rows = rows;
    return rows;
  }, [coverageFiltered, timeSortDirection, rowCache]);
  // Sorting by the Δt column is a self-referential operation (deltas are
  // derived from row order), so it freezes a snapshot instead of participating
  // in the normal sortConfig: buffer/live-follow pause, deltas stop
  // recalculating, and only the frozen set's order changes on repeat clicks.
  // Any other column header exits the mode and restores the prior live state.
  const [deltaSortActive, setDeltaSortActive] = useState(false);
  const [deltaSortDirection, setDeltaSortDirection] = useState<'asc' | 'desc'>('desc');
  const [deltaFrozenRows, setDeltaFrozenRows] = useState<TelegramRow[] | null>(null);
  const preDeltaSortFollowRef = useRef<boolean | null>(null);

  const sortByDelta = useCallback((rows: TelegramRow[], direction: 'asc' | 'desc') =>
    [...rows].sort((a, b) => {
      if (a.deltaMs == null && b.deltaMs == null) return 0;
      if (a.deltaMs == null) return 1;
      if (b.deltaMs == null) return -1;
      return direction === 'desc' ? b.deltaMs - a.deltaMs : a.deltaMs - b.deltaMs;
    }), []);

  const handleDeltaHeaderClick = useCallback(() => {
    if (!deltaSortActive) {
      setDeltaFrozenRows(sortByDelta(naturalTelegramRows, 'desc'));
      setDeltaSortDirection('desc');
      setDeltaSortActive(true);
      if (onListFollowChange) {
        preDeltaSortFollowRef.current = listFollow ?? true;
        onListFollowChange(false);
      }
    } else {
      const nextDir = deltaSortDirection === 'desc' ? 'asc' : 'desc';
      setDeltaSortDirection(nextDir);
      setDeltaFrozenRows(prev => (prev ? sortByDelta(prev, nextDir) : prev));
    }
    requestDisplayPinRef.current();
  }, [deltaSortActive, deltaSortDirection, naturalTelegramRows, sortByDelta, listFollow, onListFollowChange]);

  const exitDeltaSort = useCallback(() => {
    if (!deltaSortActive) return;
    setDeltaSortActive(false);
    setDeltaFrozenRows(null);
    if (onListFollowChange && preDeltaSortFollowRef.current !== null) {
      onListFollowChange(preDeltaSortFollowRef.current);
    }
    preDeltaSortFollowRef.current = null;
  }, [deltaSortActive, onListFollowChange]);

  // A real column header click always exits delta-sort before applying its own sort.
  // The sortConfig effect pins + flashes once the new order is committed.
  const handleColumnSort = useCallback((key: SortKey, opts?: { additive?: boolean }) => {
    exitDeltaSort();
    onSort(key, opts);
  }, [exitDeltaSort, onSort]);

  const telegramRows = deltaSortActive && deltaFrozenRows ? deltaFrozenRows : naturalTelegramRows;
  hideToggleKeysRef.current = (() => {
    const keys: string[] = [];
    const seen = new Set<string>();
    const add = (key: string) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    };
    for (const t of telegrams) add(anchorKey(t));
    for (const t of telegramRows) add(anchorKey(t));
    for (const key of hiddenKeyList) add(key);
    return keys;
  })();

  const parentTimestampByKey = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of listForcePool) out.set(anchorKey(t), timeMs(t.timestamp));
    return out;
  }, [listForcePool]);
  const selectedParentTimes = useCallback((key: string): number[] => {
    const parents = contextParents?.get(key);
    if (!parents || parents.length === 0) return [];
    const out: number[] = [];
    for (const parent of parents) {
      if (!mouseKeySet.has(parent)) continue;
      const ts = parentTimestampByKey.get(parent);
      if (ts != null) out.push(ts);
    }
    return out;
  }, [contextParents, mouseKeySet, parentTimestampByKey]);

  // ── Quick info bar metrics (#311) ───────────────────────────────────────────
  // Summarizes the currently visible (sorted + filtered) rows; oldest/newest
  // and min/max Δt jump to their row via gotoIndex regardless of sort order.
  const infoMetrics = useMemo(() => {
    // Keep the bar usable when the view is empty (no rows / all filtered out).
    if (telegramRows.length === 0) {
      return {
        count: 0,
        oldestIdx: -1,
        newestIdx: -1,
        minDeltaIdx: -1,
        maxDeltaIdx: -1,
        peak: null,
        sourceCount: 0,
        targetCount: 0,
        dptCount: 0,
        typeCounts: [] as [string, number][],
        contextCount: 0,
      };
    }
    let oldestIdx = 0, newestIdx = 0;
    let minDeltaIdx = -1, maxDeltaIdx = -1;
    const sources = new Set<string>();
    const targets = new Set<string>();
    const dpts = new Set<string>();
    const typeCounts = new Map<string, number>();
    let contextCount = 0;
    const times = telegramRows.map(t => new Date(t.timestamp).getTime());
    telegramRows.forEach((t, i) => {
      if (times[i] < times[oldestIdx]) oldestIdx = i;
      if (times[i] > times[newestIdx]) newestIdx = i;
      if (t.deltaMs != null) {
        if (minDeltaIdx === -1 || t.deltaMs < telegramRows[minDeltaIdx].deltaMs!) minDeltaIdx = i;
        if (maxDeltaIdx === -1 || t.deltaMs > telegramRows[maxDeltaIdx].deltaMs!) maxDeltaIdx = i;
      }
      sources.add(t.source_address);
      targets.add(t.target_address);
      dpts.add(t.dpt_name ?? (t.dpt_main != null ? `DPT ${t.dpt_main}` : 'unknown'));
      const type = t.simplified_type || t.telegram_type;
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      if (contextKeys?.has(anchorKey(t))) contextCount++;
    });
    return {
      count: telegramRows.length,
      oldestIdx, newestIdx,
      minDeltaIdx, maxDeltaIdx,
      // Busiest second of the view (#441); pointless for a single row.
      peak: telegramRows.length > 1 ? peakRate(times) : null,
      sourceCount: sources.size,
      targetCount: targets.size,
      dptCount: dpts.size,
      typeCounts: [...typeCounts.entries()].sort((a, b) => b[1] - a[1]),
      contextCount,
    };
  }, [telegramRows, contextKeys]);

  // ── ETS-style scroll anchoring (#202) ───────────────────────────────────────
  // Auto-scroll only while the scrollbar sits at the live edge (top for
  // newest-first, bottom for oldest-first). Scrolled away, the viewed rows are
  // anchored. The jump-to-live pill counts telegrams newer than the newest one
  // on screen, so it stays hidden while that newest telegram is visible —
  // which is always the case in live mode. Only meaningful for the timestamp
  // sort, where the live edge exists.
  //
  // Rows are dynamically measured (ResizeObserver), so a new row enters the
  // layout at the 85px estimate and later shrinks to its real height. Estimate-
  // based math therefore can't keep an anchored row still. Instead we track a
  // concrete anchor row by key and, after each update, correct scrollTop by the
  // real pixel delta of that row's position — re-run on the next frame so the
  // async re-measure of prepended rows is absorbed too.
  // Only the *primary* level's key matters for the live edge — a secondary
  // TIME tiebreaker doesn't make the list time-ordered top-to-bottom (#311).
  const primarySort = sortConfig[0];
  const isTimeSort = primarySort?.key === 'timestamp' && !deltaSortActive;
  const liveEdge = primarySort?.direction === 'asc' ? 'bottom' : 'top';
  // Display mode (a read direction from the monitor). History and the existing
  // live-edge tests leave `readDirection` unset and keep the geometry below.
  // The anchor side is where the anchor row sits in the current time sort
  // (oldest forward, newest backward). Sort and direction are independent.
  const displayEdges = readDirection != null;
  const anchorEdge: 'top' | 'bottom' = !displayEdges || readDirection == null
    ? liveEdge
    : anchorDisplayEdge(readDirection, isTimeSort ? timeSortDirection : null);
  const readingEdge: 'top' | 'bottom' = anchorEdge === 'top' ? 'bottom' : 'top';
  const [viewportHeight, setViewportHeight] = useState(0);

  // Half-row rubber exists only while a scroll gesture is overscrolling that
  // side. At rest the table sits on telegrams. A pause backlog or a manual
  // hold still keeps the fill slot; that slot is not scroll rubber. The
  // reading end keeps its end marker either way. Legacy live-edge geometry
  // (no read direction) keeps the resting half-row so overscroll has a range.
  const pauseSlotPx =
    ((isPaused && !isManualPause && pausedCount > 0 && !!onPauseReveal)
      || (isManualPause && visiblePausedCount > 0))
      ? FILL_RUBBER_PX
      : 0;
  const [scrollRubber, setScrollRubber] = useState<null | 'fill' | 'opposite'>(null);
  const scrollRubberRef = useRef<null | 'fill' | 'opposite'>(null);
  scrollRubberRef.current = scrollRubber;
  const pauseSlotRef = useRef(0);
  pauseSlotRef.current = pauseSlotPx;
  const rubberPxRef = useRef({ fill: 0, opposite: 0 });
  const readingIsLiveEdge = displayEdges && anchorEdge !== liveEdge;
  const fillAmount = !displayEdges
    ? (telegramRows.length > 0 ? FILL_RUBBER_PX : 0)
    : Math.max(pauseSlotPx, scrollRubber === 'fill' ? FILL_RUBBER_PX : 0);
  const oppositeAmount = !displayEdges
    ? (telegramRows.length > 0 ? FILL_RUBBER_PX : 0)
    : (scrollRubber === 'opposite' ? FILL_RUBBER_PX : 0);
  const displayPlan = displayEdges
    ? spacerVariantA({
      markerPx: END_MARKER_PX,
      anchorRubberPx: readingIsLiveEdge ? oppositeAmount : fillAmount,
      readingRubberPx: readingIsLiveEdge ? fillAmount : oppositeAmount,
      temporal: isTimeSort,
      hasRows: telegramRows.length > 0,
    })
    : null;
  const readingIsLive = displayPlan != null && anchorEdge !== liveEdge;
  const readingBlockPx = displayPlan ? displayPlan.markerPx + displayPlan.readingPx : 0;
  const liveFillRubberPx = displayPlan
    ? (readingIsLive ? displayPlan.readingRubberPx : displayPlan.anchorRubberPx)
    : fillAmount;
  const liveFillPadPx = displayPlan
    ? (readingIsLive ? 0 : displayPlan.anchorRubberPx)
    : liveFillRubberPx;

  // Opposite-edge spacer (DOM sibling): when the list is shorter than the
  // viewport, only the unfilled remainder, plus a ½-row rubber overscroll.
  // A longer list keeps the rubber alone, so the viewport stays full of rows.
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  type ScrollGeom = {
    fillRubberPx: number;
    fillPadPx: number;
    oppositeSpacerPx: number;
    /** Virtualizer block height at lock — keeps scrollHeight stable on prepend. */
    virtTotalPx: number;
  };
  // Snapshot while scrollbar is held or rubber is active so scrollHeight / spacer
  // do not wobble from live prepend or remeasure mid-gesture.
  const [frozenGeom, setFrozenGeom] = useState<ScrollGeom | null>(null);
  const fillRubberPx = frozenGeom?.fillRubberPx ?? liveFillRubberPx;
  const fillPadPx = frozenGeom?.fillPadPx ?? liveFillPadPx;
  // Lead of the spacer painted before the list. Item `start` includes it
  // (scrollMargin) so the window is in scroll-element coordinates. Sticky
  // growth is applied just below, once that state exists. Legacy keeps 0.
  const liveOppositeForLead = displayPlan
    ? (readingIsLive ? displayPlan.anchorPx : readingBlockPx)
    : 0;
  const oppositeForLead = displayPlan
    ? (frozenGeom?.oppositeSpacerPx ?? liveOppositeForLead)
    : 0;
  const scrollLeadPx = !displayPlan
    ? 0
    : readingEdge === 'top'
      ? (readingIsLive ? readingBlockPx : oppositeForLead)
      : (liveEdge === 'bottom' ? oppositeForLead : 0);

  const virtualizer = useVirtualizer({
    count: telegramRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE, // Better estimate for multi-line rows
    overscan: 10,
    scrollMargin: scrollLeadPx,
    paddingStart: liveEdge === 'top' ? fillPadPx : 0,
    paddingEnd: liveEdge === 'bottom' ? fillPadPx : 0,
    getItemKey: (index) => {
      const t = telegramRows[index];
      // Match `anchorKey` — falsy `raw_hex` must not fall back to index or
      // filter/reorders recycle the wrong virtual row identity.
      return anchorKey(t);
    },
  });

  const liveVirtTotalPx = virtualizer.getTotalSize();
  const virtTotalPx = frozenGeom?.virtTotalPx ?? liveVirtTotalPx;
  const rowsHeight = Math.max(0, liveVirtTotalPx - fillPadPx);
  const contentWithFill = fillPadPx + rowsHeight;
  const oppositeSettlePadPx = displayPlan
    ? 0
    : viewportHeight > 0 && contentWithFill < viewportHeight
      ? Math.max(0, viewportHeight - contentWithFill)
      : 0;
  const oppositeRubberPx = displayPlan
    ? (readingIsLive ? displayPlan.anchorRubberPx : displayPlan.readingRubberPx)
    : (telegramRows.length > 0 ? FILL_RUBBER_PX : 0);
  rubberPxRef.current = { fill: fillRubberPx, opposite: oppositeRubberPx };
  // Legacy: settle pad + rubber on the side opposite the newer edge.
  // Display mode: that side is the anchor rubber, or the reading block
  // (marker + rubber) when the anchor sits on the newer edge.
  const liveOppositeSpacerPx = displayPlan
    ? (readingIsLive ? displayPlan.anchorPx : readingBlockPx)
    : oppositeSettlePadPx + oppositeRubberPx;
  const liveGeomRef = useRef<ScrollGeom>({
    fillRubberPx: liveFillRubberPx,
    fillPadPx: liveFillPadPx,
    oppositeSpacerPx: liveOppositeSpacerPx,
    virtTotalPx: liveVirtTotalPx,
  });
  liveGeomRef.current = {
    fillRubberPx: liveFillRubberPx,
    fillPadPx: liveFillPadPx,
    oppositeSpacerPx: liveOppositeSpacerPx,
    virtTotalPx: liveVirtTotalPx,
  };
  // Short-list settle pad held across a metered reveal: the pad drops to 0 the
  // moment the growing list exceeds the viewport, which would clamp scrollTop
  // and snap the viewport. Kept until scrollTop fits the live geometry again.
  const [stickyOppositeSpacerPx, setStickyOppositeSpacerPx] = useState(0);
  const oppositeSpacerPx =
    frozenGeom?.oppositeSpacerPx ?? Math.max(liveOppositeSpacerPx, stickyOppositeSpacerPx);
  // Spacers painted before the virtualizer in display mode. `scrollMargin`
  // folds this lead into item `start`, so pill math compares it to scrollTop
  // directly. The row transform subtracts it: the list box begins after the
  // spacer. The reading block leads when it is on top; otherwise the anchor
  // rubber leads only while it is a sibling (newest-at-bottom). The two never
  // stack. Legacy live-edge geometry keeps a lead of 0.
  const rowsLeadPx = !displayPlan
    ? 0
    : readingEdge === 'top'
      ? (readingIsLive ? readingBlockPx : oppositeSpacerPx)
      : (liveEdge === 'bottom' ? oppositeSpacerPx : 0);
  if (virtualizer.options.scrollMargin !== rowsLeadPx) {
    virtualizer.setOptions({ ...virtualizer.options, scrollMargin: rowsLeadPx });
  }
  const rubberBandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rubberBandRafRef = useRef<number | null>(null);
  /** Active rubber-band animation; survives live prepends (no retarget). */
  const rubberAnimRef = useRef<{
    side: 'fill' | 'opposite';
    from: number;
    to: number;
    t0: number;
    duration: number;
  } | null>(null);
  const atEdgeRef = useRef(liveFollow && (listFollow ?? true));
  if (!liveFollow) atEdgeRef.current = false;
  // After an intentional unfollow, ignore newestFullyVisible until the newest
  // row has left full visibility once — otherwise a short list or edge-row
  // click would re-enable follow immediately.
  const detachedFromEdgeRef = useRef(!(listFollow ?? true));
  // Last positive newer-pill count; held across the flush gap until a real
  // newerCount is measured again. Overlay thumb reads the same value.
  const stickyNewerCountRef = useRef(0);
  const displayNewerCountRef = useRef(0);
  // Mirrors atEdgeRef for render. Pill still shows when a backlog exists.
  const [followingLive, setFollowingLive] = useState(listFollow ?? true);
  // Armed on every pause flush; forces pin (never scrollToEdge) until the
  // merged list actually changes the live-edge key.
  const flushPinRef = useRef(false);
  // In-flight metered reveal: backlog size when requested and rows asked for.
  // Lets the merge effect tell "reveal landed but every row was filtered out"
  // (pausedCount dropped, edge key unchanged) from an unrelated publish.
  const revealRef = useRef<{ before: number; n: number } | null>(null);
  // Newer-pill jump: next merge must scrollToEdge (not pin) after Play/flush.
  const jumpToLiveRef = useRef(false);
  // The row held still while anchored, and its offset from the scroll-container
  // top: the selected (last-marked) row while it is on screen (#435), otherwise
  // the top-most visible one. Captured from user scrolls and row clicks only.
  const anchorRef = useRef<{ key: string; offset: number } | null>(
    listAnchorKey ? { key: listAnchorKey, offset: 0 } : null
  );
  // Non-time sort: the topmost row at the moment the list last settled.
  const fixedTopRef = useRef<{ key: string; offset: number } | null>(null);
  // A chevron does not change the sort. If a sort update lands in the same
  // commit anyway, skip that pin once so scrollTop stays put; the spacers
  // still swap.
  const chevronSortHoldRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  // Whether the user is scrolling right now — wheel, touch, keys, or a held
  // scrollbar. Lets pinAnchor tell "the anchor left the rendered window
  // because the user jumped away" from "because rows were inserted" (#435).
  const scrollbarHeldRef = useRef(false);
  const userScrollUntilRef = useRef(0);
  const noteUserScroll = () => { userScrollUntilRef.current = performance.now() + 300; };
  const userScrolling = () => scrollbarHeldRef.current || performance.now() < userScrollUntilRef.current;
  // Wheel/key delta to apply into the merged list after a pause-buffer flush pin.
  const pendingFlushScrollDeltaRef = useRef<number | null>(null);
  // Latest toward-newer live-edge helpers for the global key listener (empty deps).
  const engageLiveTowardNewerRef = useRef<(deltaY: number) => void>(() => {});
  const keyTowardNewerRef = useRef<(key: string) => boolean>(() => false);
  const syncOverlayScrollbarRef = useRef(() => {});
  const keyScrollDeltaRef = useRef<(key: string) => number>(() => 0);
  const scheduleRubberBandRef = useRef(() => {});
  const unlockScrollGeometryIfSettledRef = useRef(() => {});
  const releaseScrollRubberRef = useRef(() => {});
  const inFillRubberZoneRef = useRef<() => boolean>(() => false);
  const inOppositeRubberZoneRef = useRef<() => boolean>(() => false);
  // Thumb drag state: only the last pointer Y. Each move becomes an incremental
  // scroll delta (live geometry), exactly like successive wheel events.
  const sbDragRef = useRef<{
    pointerId: number;
    lastY: number;
  } | null>(null);
  useEffect(() => {
    const release = () => {
      if (!scrollbarHeldRef.current) return;
      scrollbarHeldRef.current = false;
      if (sbDragRef.current) sbDragRef.current = null;
      noteUserScroll();
      if (inFillRubberZoneRef.current() || inOppositeRubberZoneRef.current()) {
        scheduleRubberBandRef.current();
      } else {
        unlockScrollGeometryIfSettledRef.current();
        releaseScrollRubberRef.current();
      }
      syncOverlayScrollbarRef.current();
    };
    // Keys scroll the list without it holding focus, so listen globally.
    const onKey = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key)) return;
      userScrollUntilRef.current = performance.now() + 300;
      if (keyTowardNewerRef.current(e.key)) {
        engageLiveTowardNewerRef.current(keyScrollDeltaRef.current(e.key));
      }
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  // The row list the anchor was last seen in. Unchanged list + missing anchor
  // can only mean the viewport moved, never that rows were inserted.
  const anchorRowsRef = useRef<typeof telegramRows | null>(null);
  // Latest rows for callbacks that outlive a render (scroll handlers, frames).
  const telegramRowsRef = useRef(telegramRows);
  useLayoutEffect(() => { telegramRowsRef.current = telegramRows; });
  // Bounds captureAnchor's wait for the virtualizer to draw rows on screen.
  const captureRetriesRef = useRef(0);
  // Set while pinAnchor is bringing back an anchor that left the virtualized
  // window; the scrolls that causes are ours, not the user's.
  const refindingAnchorRef = useRef(false);
  // After an action pins a row: keep it still via instant scroll when possible.
  // Only if the scroll edge clamps (row must move) do we ease that visual shift.
  const animateNextPinRef = useRef(false);
  const pinAnimRafRef = useRef(0);
  useEffect(() => () => {
    if (pinAnimRafRef.current) cancelAnimationFrame(pinAnimRafRef.current);
    if (listContentRef.current) listContentRef.current.style.transform = '';
    document.removeEventListener('mouseup', onClickGestureEnd);
    document.removeEventListener('pointercancel', onClickGestureEnd);
  }, [onClickGestureEnd]);

  // Temporary inner-border flash on a row (scheme-aware via --row-flash-border).
  // Clearing first then re-setting restarts the CSS animation for the same key.
  const [rowFlash, setRowFlash] = useState<{ key: string; gen: number } | null>(null);
  const flashRow = useCallback((key: string) => {
    setRowFlash(null);
    requestAnimationFrame(() => {
      setRowFlash(prev => ({ key, gen: (prev?.gen ?? 0) + 1 }));
    });
  }, []);
  // Zebra stripes stay with a telegram (#266): colour uses the unfiltered pool
  // index (stripeIndexByKey) so filter/QF compaction cannot flip survivors.
  // Live-edge prepends/drops still shift every pool index uniformly — this
  // offset accumulates that shift and is added back to the pool-index parity.
  const [stripeOffset, setStripeOffset] = useState(0);
  const prevPoolEdgeRef = useRef<{ firstKey: string | null; lastKey: string | null; len: number }>({
    firstKey: null, lastKey: null, len: 0,
  });
  useLayoutEffect(() => {
    const pool = listForcePool;
    const prev = prevPoolEdgeRef.current;
    const firstKey = pool.length > 0 ? anchorKey(pool[0]) : null;
    const lastKey = pool.length > 0 ? anchorKey(pool[pool.length - 1]) : null;
    prevPoolEdgeRef.current = { firstKey, lastKey, len: pool.length };

    if (pool.length === 0) {
      setStripeOffset(0);
      return;
    }
    if (!isTimeSort || prev.len === 0) return;

    const edgeKey = liveEdge === 'top' ? firstKey : lastKey;
    const prevEdgeKey = liveEdge === 'top' ? prev.firstKey : prev.lastKey;
    if (!prevEdgeKey || edgeKey === prevEdgeKey) return;

    let added = -1;
    if (liveEdge === 'top') {
      for (let i = 0; i < pool.length; i++) {
        if (anchorKey(pool[i]) === prevEdgeKey) { added = i; break; }
      }
    } else {
      for (let i = pool.length - 1; i >= 0; i--) {
        if (anchorKey(pool[i]) === prevEdgeKey) { added = pool.length - 1 - i; break; }
      }
    }
    if (added <= 0) {
      setStripeOffset(0);
      return;
    }
    const dropped = prev.len + added - pool.length;
    const indexShift = liveEdge === 'top' ? added : -dropped;
    setStripeOffset(o => (((o + indexShift) % 2) + 2) % 2);
  }, [listForcePool, isTimeSort, liveEdge]);

  // Sync follow prop. Unfollow always leaves the live edge and arms the detach
  // latch; follow from the parent clears the latch. Follow must NOT claim we
  // are at the edge — that would scrollToEdge on the next pause-buffer flush.
  // jumpToLive / handleScroll set atEdge themselves.
  useEffect(() => {
    if (!liveFollow) {
      setFollowingLive(false);
      atEdgeRef.current = false;
      detachedFromEdgeRef.current = true;
      return;
    }
    if (listFollow === undefined) return;
    setFollowingLive(listFollow);
    if (!listFollow) {
      atEdgeRef.current = false;
      detachedFromEdgeRef.current = true;
    } else {
      detachedFromEdgeRef.current = false;
    }
  }, [listFollow, liveFollow]);

  useEffect(() => {
    if (listAnchorKey !== undefined) {
      if (listAnchorKey === null) {
        anchorRef.current = null;
      } else if (!anchorRef.current || anchorRef.current.key !== listAnchorKey) {
        anchorRef.current = { key: listAnchorKey, offset: 0 };
      }
    }
  }, [listAnchorKey]);

  // Suppress edge/anchor tracking for scrolls we cause ourselves. Auto-clears on
  // the next frame so a no-op programmatic scroll can't swallow a later real one.
  const markProgrammatic = () => {
    programmaticScrollRef.current = true;
    requestAnimationFrame(() => { programmaticScrollRef.current = false; });
  };

  const rowOffset = (key: string): number | null => {
    const el = parentRef.current;
    if (!el) return null;
    const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(key)}"]`);
    if (!row) return null;
    return row.getBoundingClientRect().top - el.getBoundingClientRect().top;
  };

  /** True when the rendered row overlaps the scrollport. A missing node is off-screen. */
  const rowInViewport = (key: string): boolean => {
    const el = parentRef.current;
    if (!el) return false;
    const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(key)}"]`);
    if (!row) return false;
    const rr = row.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    return rr.bottom > cr.top && rr.top < cr.bottom;
  };

  /**
   * Scroll range that shows rows. Rubber insets apply only while that side's
   * spacer is open (a scroll overscroll, or the pause fill slot).
   */
  const contentScrollRange = (el: HTMLElement) => {
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const fill = rubberPxRef.current.fill;
    const opposite = rubberPxRef.current.opposite;
    const fillAtStart = liveEdge === 'top';
    const lo = Math.min(max, fillAtStart ? fill : opposite);
    const hi = Math.max(lo, max - (fillAtStart ? opposite : fill));
    return { max, lo, hi };
  };

  /** Settled live-edge scrollTop (edge telegram flush; not into the fill rubber). */
  const settledEdgeScrollTop = () => {
    const el = parentRef.current;
    const fill = rubberPxRef.current.fill;
    if (!el) return fill;
    if (liveEdge === 'top') return fill;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return Math.max(0, max - fill);
  };

  /**
   * Settled opposite-edge scrollTop (not into the opposite rubber).
   * Independent of the fill inset: on a short list the two rubbers overlap,
   * and this edge can sit at 0 while the fill edge sits at the fill rubber.
   */
  const settledOppositeScrollTop = () => {
    const el = parentRef.current;
    const opposite = rubberPxRef.current.opposite;
    if (!el) return 0;
    if (liveEdge === 'bottom') return opposite;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return Math.max(0, max - opposite);
  };

  /**
   * Drop a scroll-only rubber spacer and keep the same telegrams on screen.
   * A leading spacer shifts the scroll origin; an end spacer does not.
   */
  const releaseScrollRubber = () => {
    if (!displayEdges || scrollRubberRef.current == null) return;
    const el = parentRef.current;
    const side = scrollRubberRef.current;
    const padBefore = side === 'fill' ? liveEdge === 'top' : liveEdge === 'bottom';
    const nextTop = el
      ? (padBefore ? Math.max(0, el.scrollTop - FILL_RUBBER_PX) : el.scrollTop)
      : 0;
    scrollRubberRef.current = null;
    flushSync(() => {
      setScrollRubber(null);
      setFrozenGeom(null);
    });
    if (!el) return;
    markProgrammatic();
    el.scrollTop = nextTop;
  };

  /** True while overscrolled into the fill-axis rubber zone (outer fillRubber only). */
  const inFillRubberZone = () => {
    const el = parentRef.current;
    if (!el || fillRubberPx <= 0) return false;
    if (liveEdge === 'top') return el.scrollTop < fillRubberPx - 0.5;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return el.scrollTop > max - fillRubberPx + 0.5;
  };

  /**
   * Auto-paused with a backlog the parent can meter out: the fill padding is
   * then the insert slot for the next backlog rows, not a rubber band.
   */
  const backlogFeedActive = () =>
    isPaused && !isManualPause && pausedCount > 0 && !!onPauseReveal;

  /**
   * Manually paused with newer rows for this view: the fill spacer is a hard
   * stop that stays on screen (with its "...paused manually..." label) instead
   * of rubber-banding away. A raw backlog the active filter hides is not
   * newer — the spacer animates closed and the label leaves with it.
   * Switching to auto pause fills the held spacer with the oldest backlog row.
   */
  const manualHoldActive = () => isManualPause && visiblePausedCountRef.current > 0;

  /** Fill overscroll that should rubber-band back (nothing waiting to fill it). */
  const inFillRubberBand = () =>
    inFillRubberZone() && !backlogFeedActive() && !manualHoldActive();

  /**
   * Scroll range a pin may land in. A pin never pushes the viewport into a
   * rubber zone: that overscroll only settles on a user scroll, so the spacer
   * would stay open when the pinned row cannot hold its place. A viewport
   * already inside a zone keeps the raw range — except for action pins
   * (filter / QF toggle), which settle unless a manual-pause hold parks the
   * fill spacer on screen.
   */
  const pinScrollBounds = (el: HTMLElement, action: boolean) => {
    const { max, lo, hi } = contentScrollRange(el);
    const fillAtStart = liveEdge === 'top';
    const keepRaw = (inZone: boolean, fillSide: boolean) =>
      inZone && (!action || (fillSide && manualHoldActive()));
    return {
      lo: keepRaw(el.scrollTop < lo - 0.5, fillAtStart) ? 0 : lo,
      hi: keepRaw(el.scrollTop > hi + 0.5, !fillAtStart) ? max : hi,
    };
  };

  /** Fill spacer fully in the viewport (not partially scrolled away). */
  const fillRubberFullyVisible = () => {
    const el = parentRef.current;
    if (!el || fillRubberPx <= 0) return false;
    if (liveEdge === 'top') return el.scrollTop <= 0.5;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return el.scrollTop >= max - 0.5;
  };

  const [showFillPauseLabels, setShowFillPauseLabels] = useState(false);
  /** Bumps to remount labels so the highlight→dim fade restarts. */
  const [fillPauseFadeKey, setFillPauseFadeKey] = useState(0);
  const fillPauseLabelsShownRef = useRef(false);
  /** One highlight pulse per scrollbar drag past the fill hard-stop. */
  const fillPauseSbPulsedRef = useRef(false);
  const pulseFillPauseLabels = () => {
    setFillPauseFadeKey(k => k + 1);
  };
  const syncFillPauseLabels = () => {
    const next = !!isManualPause && fillRubberFullyVisible();
    if (next && !fillPauseLabelsShownRef.current) {
      pulseFillPauseLabels();
    }
    if (!next) fillPauseSbPulsedRef.current = false;
    fillPauseLabelsShownRef.current = next;
    setShowFillPauseLabels(next);
  };
  useLayoutEffect(() => {
    syncFillPauseLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManualPause, fillRubberPx, liveEdge, telegramRows.length]);

  /** True while overscrolled into the opposite-axis rubber zone. */
  const inOppositeRubberZone = () => {
    const el = parentRef.current;
    if (!el || oppositeRubberPx <= 0) return false;
    const settle = settledOppositeScrollTop();
    if (liveEdge === 'top') return el.scrollTop > settle + 0.5;
    return el.scrollTop < settle - 0.5;
  };

  const lockScrollGeometry = () => {
    // A metered reveal needs the live virtualizer height: a frozen scrollHeight
    // would clamp the pin and snap the viewport.
    if (flushPinRef.current) return;
    setFrozenGeom(prev => prev ?? { ...liveGeomRef.current });
  };

  const unlockScrollGeometryIfSettled = () => {
    if (scrollbarHeldRef.current) return;
    if (rubberAnimRef.current) return;
    if (inOppositeRubberZone() || inFillRubberBand()) return;
    setFrozenGeom(null);
  };

  /** Drop the sticky short-list pad once scrollTop fits the live geometry. */
  const releaseStickySpacerIfFits = () => {
    if (stickyOppositeSpacerPx <= 0 || flushPinRef.current) return;
    const el = parentRef.current;
    if (!el) return;
    const liveMax = Math.max(0, liveVirtTotalPx + liveOppositeSpacerPx - el.clientHeight);
    if (el.scrollTop <= liveMax + 0.5) setStickyOppositeSpacerPx(0);
  };

  const checkAtEdge = () => {
    const el = parentRef.current;
    if (!el) return true;
    // Settled edge or fill-rubber overscroll both count as at the live edge.
    if (liveEdge === 'top') return el.scrollTop <= fillRubberPx + EDGE_SCROLL_EPS;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return el.scrollTop >= Math.max(0, max - fillRubberPx) - EDGE_SCROLL_EPS;
  };

  /**
   * How far (px, ≥ 0) a fill-axis move of `deltaY` would carry the viewport
   * past the settled live edge into the fill slot. 0 when it stays on rows.
   */
  const fillOverrunFor = (deltaY: number) => {
    const el = parentRef.current;
    if (!el) return 0;
    const target = el.scrollTop + deltaY;
    const settled = settledEdgeScrollTop();
    return Math.max(0, liveEdge === 'top' ? settled - target : target - settled);
  };

  const cancelRubberBand = () => {
    if (rubberBandTimerRef.current != null) {
      clearTimeout(rubberBandTimerRef.current);
      rubberBandTimerRef.current = null;
    }
    if (rubberBandRafRef.current != null) {
      cancelAnimationFrame(rubberBandRafRef.current);
      rubberBandRafRef.current = null;
    }
    rubberAnimRef.current = null;
  };

  /** Opposite rubber must always finish — ignore pause-flush pins. */
  const oppositeRubberBusy = () =>
    rubberAnimRef.current?.side === 'opposite' || inOppositeRubberZone();

  /** Animate scrollTop to `target` on the given rubber side (ease + settle timer). */
  const startRubberBandTo = (
    target: number,
    side: 'fill' | 'opposite',
    onDone?: () => void,
  ) => {
    const el = parentRef.current;
    if (!el) return;
    // Opposite rubber always runs to completion, including during pause flush.
    if (
      side !== 'opposite'
      && (flushPinRef.current || pendingFlushScrollDeltaRef.current != null)
    ) return;
    if (jumpToLiveRef.current) return;
    const start = el.scrollTop;
    const delta = target - start;
    let finished = false;
    const finish = (node: HTMLElement, to: number) => {
      if (finished) return;
      finished = true;
      markProgrammatic();
      node.scrollTop = to;
      syncFillPauseLabels();
      rubberAnimRef.current = null;
      if (rubberBandTimerRef.current != null) {
        clearTimeout(rubberBandTimerRef.current);
        rubberBandTimerRef.current = null;
      }
      if (rubberBandRafRef.current != null) {
        cancelAnimationFrame(rubberBandRafRef.current);
        rubberBandRafRef.current = null;
      }
      unlockScrollGeometryIfSettled();
      releaseScrollRubber();
      onDone?.();
    };
    lockScrollGeometry();
    if (Math.abs(delta) < 0.5) {
      finish(el, target);
      return;
    }

    // Keep side/progress; replace timers/frames only.
    if (rubberBandTimerRef.current != null) {
      clearTimeout(rubberBandTimerRef.current);
      rubberBandTimerRef.current = null;
    }
    if (rubberBandRafRef.current != null) {
      cancelAnimationFrame(rubberBandRafRef.current);
      rubberBandRafRef.current = null;
    }

    markProgrammatic();
    const duration = 180;
    const t0 = performance.now();
    rubberAnimRef.current = { side, from: start, to: target, t0, duration };
    const step = (now: number) => {
      const node = parentRef.current;
      const anim = rubberAnimRef.current;
      if (!node || !anim) {
        rubberBandRafRef.current = null;
        return;
      }
      markProgrammatic();
      const t = Math.min(1, Math.max(0, (now - anim.t0) / anim.duration));
      const ease = 1 - (1 - t) ** 3;
      node.scrollTop = anim.from + (anim.to - anim.from) * ease;
      syncFillPauseLabels();
      if (t < 1) {
        rubberBandRafRef.current = requestAnimationFrame(step);
      } else {
        rubberBandRafRef.current = null;
        finish(node, anim.to);
      }
    };
    rubberBandRafRef.current = requestAnimationFrame(step);
    rubberBandTimerRef.current = setTimeout(() => {
      rubberBandTimerRef.current = null;
      if (rubberBandRafRef.current != null) {
        cancelAnimationFrame(rubberBandRafRef.current);
        rubberBandRafRef.current = null;
      }
      const node = parentRef.current;
      const anim = rubberAnimRef.current;
      if (!node || !anim) return;
      finish(node, anim.to);
    }, duration);
  };

  const rubberBandFromZone = () => {
    if (inFillRubberBand()) {
      startRubberBandTo(settledEdgeScrollTop(), 'fill');
      return;
    }
    if (inOppositeRubberZone()) {
      startRubberBandTo(settledOppositeScrollTop(), 'opposite');
      return;
    }
    // The gesture left the spacer before the retract ran. Drop it.
    releaseScrollRubber();
  };

  const scheduleRubberBand = () => {
    // Do not fight a held scrollbar thumb — rubber runs on pointerup instead.
    if (scrollbarHeldRef.current) return;
    if (fillRubberPx <= 0 && oppositeRubberPx <= 0) return;
    if (rubberBandTimerRef.current != null) clearTimeout(rubberBandTimerRef.current);
    rubberBandTimerRef.current = setTimeout(() => {
      rubberBandTimerRef.current = null;
      rubberBandFromZone();
    }, 90);
  };
  scheduleRubberBandRef.current = scheduleRubberBand;
  // When a filter drops this view's newer count to zero while the fill spacer
  // is open, animate it closed. Mount is a no-op (the count is unchanged).
  const prevVisiblePausedRef = useRef(visiblePausedCount);
  useLayoutEffect(() => {
    const prev = prevVisiblePausedRef.current;
    prevVisiblePausedRef.current = visiblePausedCount;
    if (prev === visiblePausedCount || visiblePausedCount > 0) return;
    if (!inFillRubberBand()) return;
    scheduleRubberBand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePausedCount]);
  unlockScrollGeometryIfSettledRef.current = unlockScrollGeometryIfSettled;
  releaseScrollRubberRef.current = releaseScrollRubber;
  inFillRubberZoneRef.current = inFillRubberBand;
  inOppositeRubberZoneRef.current = inOppositeRubberZone;

  useEffect(() => () => cancelRubberBand(), []);

  // Newest live-edge row fully inside the scrollport. Empty list → false.
  // When layout boxes are unreliable (jsdom), fall back to checkAtEdge().
  const newestFullyVisible = () => {
    const rows = telegramRowsRef.current;
    if (rows.length === 0) return false;
    const el = parentRef.current;
    if (!el) return false;
    const key = anchorKey(rows[liveEdge === 'top' ? 0 : rows.length - 1]);
    const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(key)}"]`);
    if (!row) return false;
    const rr = row.getBoundingClientRect();
    const pr = el.getBoundingClientRect();
    const eps = 2;
    const layoutReliable =
      Math.abs(rr.height - pr.height) > 1 || Math.abs(rr.top - pr.top) > 1;
    if (!layoutReliable) return checkAtEdge();
    return rr.top >= pr.top - eps && rr.bottom <= pr.bottom + eps;
  };

  const enableLiveFollow = () => {
    if (!liveFollow) return;
    detachedFromEdgeRef.current = false;
    atEdgeRef.current = true;
    setFollowingLive(true);
    onListFollowChange?.(true);
    anchorRef.current = null;
    onListAnchorKeyChange?.(null);
  };

  const syncFollowFromNewestVisibility = () => {
    if (isManualPause) return;
    if (detachedFromEdgeRef.current) return;
    // A backlog still waits: following would flush it all at once.
    if (backlogFeedActive()) return;
    if (!newestFullyVisible()) return;
    enableLiveFollow();
  };

  /**
   * Backlog rows to reveal for a fill-axis move of `px`: enough to cover the
   * move plus the fill slot (so the viewport never runs into blank padding),
   * one spare for rows measuring shorter than the estimate, capped so the
   * pinned row stays rendered. Any shortfall is topped up by the merge effect.
   */
  const revealCountFor = (px: number) => {
    const need = Math.ceil((Math.abs(px) + fillRubberPx) / ROW_ESTIMATE) + 1;
    return Math.max(1, Math.min(pausedCount, need, REVEAL_MAX));
  };

  /**
   * Ask the parent for the next metered slice. The edge-most visible row is
   * pinned (selection ignored: a marked row elsewhere must not steer the
   * flush); the gesture delta is applied once the rows have landed.
   */
  const requestReveal = (deltaY: number, n: number) => {
    flushPinRef.current = true;
    captureAnchor(null, { ignoreSelection: true });
    pendingFlushScrollDeltaRef.current = deltaY;
    revealRef.current = { before: pausedCount, n };
    onPauseReveal?.(n);
  };

  /**
   * Start a metered step from rest: a few rows inserted into the fill slot.
   * Rows must grow scrollHeight, so no frozen geometry; a short list keeps its
   * settle pad until the viewport fits the live geometry again.
   */
  const armMeteredReveal = (deltaY: number, n: number) => {
    setFrozenGeom(null);
    setStickyOppositeSpacerPx(prev => Math.max(prev, liveGeomRef.current.oppositeSpacerPx));
    requestReveal(deltaY, n);
  };

  // Scroll along the pause-buffer fill axis (toward the live edge) at the frozen
  // fill end: feed the backlog and continue the gesture seamlessly. Against
  // the fill axis never flushes (handleScroll has no flush). Empty list: no-op.
  // Without backlog, follow re-engages; fill-rubber overscroll rubber-bands back.
  const engageLiveTowardNewer = (deltaY: number) => {
    if (telegramRowsRef.current.length === 0) return;
    if (flushPinRef.current) {
      // Rows of the previous step have not landed yet: fold this move into the
      // pending delta; the merge effect tops the reveal up if the slot is
      // still open afterwards.
      pendingFlushScrollDeltaRef.current = (pendingFlushScrollDeltaRef.current ?? 0) + deltaY;
      return;
    }
    // A move that would run past the settled edge into the fill slot counts
    // too while a backlog waits (e.g. right after a slot fill left the edge
    // row 73px in): the browser clamps that part of the scroll, so without a
    // reveal the gesture would lose it.
    const overrun = fillOverrunFor(deltaY);
    if (!checkAtEdge() && !(backlogFeedActive() && overrun > 0)) return;
    if (isPaused && pausedCount > 0) {
      // Manual pause does not meter the backlog. With view-newer the fill
      // edge stays a hard stop; without it the caller rubber-bands the spacer.
      if (isManualPause) return;
      detachedFromEdgeRef.current = false;
      // Flush must never claim the live edge — that would scrollToEdge on merge.
      // Pin + pending delta keep the viewport moving line-wise into the backlog.
      // Opposite rubber always finishes — do not cancel it for pause flush.
      if (!oppositeRubberBusy()) cancelRubberBand();
      atEdgeRef.current = false;
      if (onPauseReveal) {
        armMeteredReveal(deltaY, revealCountFor(overrun));
        return;
      }
      flushPinRef.current = true;
      if (!anchorRef.current) captureAnchor();
      pendingFlushScrollDeltaRef.current = deltaY;
      onPauseFlush?.();
      return;
    }
    if (!liveFollow) return;
    detachedFromEdgeRef.current = false;
    enableLiveFollow();
    scheduleRubberBand();
  };
  const wheelTowardNewer = (deltaY: number) =>
    liveEdge === 'top' ? deltaY < 0 : deltaY > 0;
  const keyTowardNewer = (key: string) => {
    if (liveEdge === 'top') return key === 'ArrowUp' || key === 'PageUp' || key === 'Home';
    return key === 'ArrowDown' || key === 'PageDown' || key === 'End' || key === ' ';
  };
  const keyScrollDelta = (key: string) => {
    const page = parentRef.current?.clientHeight ?? 800;
    const sign = liveEdge === 'top' ? -1 : 1;
    if (key === 'PageUp' || key === 'PageDown' || key === 'Home' || key === 'End' || key === ' ') {
      return sign * page;
    }
    return sign * 40;
  };
  engageLiveTowardNewerRef.current = engageLiveTowardNewer;
  keyTowardNewerRef.current = keyTowardNewer;
  keyScrollDeltaRef.current = keyScrollDelta;

  // Record the row to pin across list updates. `selectedKey` is the row the
  // user is working on; it wins while any part of it is inside the viewport, so
  // rows arriving above it (a reload, Time-Delta-Context) can't push it away
  // (#435). Without one on screen, the top-most visible row is pinned (#202).
  const captureAnchor = (
    selectedKey: string | null = selectedKeyRef.current,
    opts?: { ignoreSelection?: boolean },
  ) => {
    const el = parentRef.current;
    if (!el) return;
    const cRect = el.getBoundingClientRect();
    const cTop = cRect.top;
    if (selectedKey && !opts?.ignoreSelection) {
      const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(selectedKey)}"]`);
      const rr = row?.getBoundingClientRect();
      if (rr && rr.bottom > cTop && rr.top < cRect.bottom) {
        anchorRef.current = { key: selectedKey, offset: rr.top - cTop };
        anchorRowsRef.current = telegramRowsRef.current;
        onListAnchorKeyChange?.(selectedKey);
        return;
      }
    }
    for (const row of el.querySelectorAll<HTMLElement>('.log-row')) {
      const rr = row.getBoundingClientRect();
      if (rr.bottom - cTop > 0 && rr.top < cRect.bottom) {
        const key = row.getAttribute('data-akey');
        if (key) {
          anchorRef.current = { key, offset: rr.top - cTop };
          anchorRowsRef.current = telegramRowsRef.current;
          onListAnchorKeyChange?.(key);
          captureRetriesRef.current = 0;
        }
        return;
      }
    }
    // Nothing rendered is on screen: after a long jump (scrollbar drag) the
    // virtualizer has not drawn the new rows yet. A row from the old position
    // must not become the anchor — pinAnchor would scroll back to it — so
    // wait for the next frames instead.
    anchorRef.current = null;
    if (captureRetriesRef.current < 5) {
      captureRetriesRef.current++;
      requestAnimationFrame(() => {
        if (!atEdgeRef.current && !anchorRef.current) captureAnchor();
      });
    } else {
      captureRetriesRef.current = 0;
    }
  };

  // Paint-only overlay thumb — mutate DOM (no useState) so sync cannot trigger
  // an extra render that would clear the sticky newer-pill across a flush gap.
  const sbTrackRef = useRef<HTMLDivElement | null>(null);
  const sbThumbRef = useRef<HTMLDivElement | null>(null);

  /**
   * Virtual backlog px for the overlay thumb — same basis as the newer pill:
   * displayNewerCount minus merged rows already in scrollHeight (fill-offscreen).
   * Virtual backlog px for the overlay thumb. Steady state is the filter-visible
   * pause count; during a flush gap the sticky pill count is held so the thumb
   * does not collapse before the merged rows are measured. Merged-out rows are
   * already in scrollHeight and are not walked via getOffsetForIndex.
   */
  const overlayBacklogPx = (scrollTop: number, clientHeight: number) => {
    const newer = Math.max(0, displayNewerCountRef.current);
    const pausedPx = Math.max(0, visiblePausedCountRef.current) * ROW_ESTIMATE;
    if (!isTimeSort || telegramRows.length === 0) return Math.max(pausedPx, newer * ROW_ESTIMATE);
    const items = virtualizer.getVirtualItems();
    if (!items.some(item => item.size > 0) || virtualizer.getTotalSize() <= 0) {
      return Math.max(pausedPx, newer * ROW_ESTIMATE);
    }
    const mergedOut = countMergedScrolledOut(
      telegramRows.length, liveEdge, scrollTop, clientHeight, items,
    );
    return Math.max(0, newer - mergedOut) * ROW_ESTIMATE;
  };
  /**
   * Paint-only thumb: size/position from the newer-pill backlog (not raw
   * pausedCount). Always computed from live state — also while the thumb is held.
   */
  const syncOverlayScrollbar = () => {
    const el = parentRef.current;
    const track = sbTrackRef.current;
    const thumb = sbThumbRef.current;
    if (!el || !track || !thumb) return;
    const { clientHeight, scrollHeight, scrollTop } = el;
    const backlogPx = overlayBacklogPx(scrollTop, clientHeight);
    const virtSH = scrollHeight + backlogPx;
    if (virtSH <= clientHeight + 0.5) {
      track.style.display = 'none';
      return;
    }
    track.style.display = '';
    const thumbHeight = Math.max(LIST_SB_MIN_THUMB_PX, (clientHeight * clientHeight) / virtSH);
    const virtMaxScroll = Math.max(0, virtSH - clientHeight);
    const trackTravel = Math.max(0, clientHeight - thumbHeight);
    const virtScrollTop = liveEdge === 'top'
      ? Math.min(virtMaxScroll, Math.max(0, scrollTop + backlogPx))
      : Math.min(virtMaxScroll, Math.max(0, scrollTop));
    const top = virtMaxScroll > 0 ? (virtScrollTop / virtMaxScroll) * trackTravel : 0;
    thumb.style.top = `${top}px`;
    thumb.style.height = `${thumbHeight}px`;
  };
  syncOverlayScrollbarRef.current = syncOverlayScrollbar;

  /**
   * Open the half-row spacer when this gesture would cross a content edge.
   * Runs before the scroll is applied, so the new range can absorb it.
   * Display mode only — legacy geometry already reserves the rubber.
   */
  const armScrollRubber = (deltaY: number) => {
    if (!displayEdges || deltaY === 0) return;
    const el = parentRef.current;
    if (!el || telegramRowsRef.current.length === 0) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const fill = rubberPxRef.current.fill;
    const opposite = rubberPxRef.current.opposite;
    const towardFill = liveEdge === 'top' ? deltaY < 0 : deltaY > 0;
    const settled = towardFill
      ? (liveEdge === 'top' ? fill : Math.max(0, max - fill))
      : (liveEdge === 'bottom' ? opposite : Math.max(0, max - opposite));
    const next = el.scrollTop + deltaY;
    const into = towardFill
      ? (liveEdge === 'top' ? next < settled - 0.5 : next > settled + 0.5)
      : (liveEdge === 'bottom' ? next < settled - 0.5 : next > settled + 0.5);
    if (!into) return;
    const side = towardFill ? 'fill' as const : 'opposite' as const;
    if (scrollRubberRef.current === side) return;
    if (side === 'fill' && pauseSlotRef.current > 0) return;
    scrollRubberRef.current = side;
    flushSync(() => {
      setFrozenGeom(null);
      setScrollRubber(side);
    });
  };

  /**
   * One user scroll gesture of `deltaY` px along the scroll axis — the single
   * entry for wheel and scrollbar-thumb drag. Runs BEFORE the actual scroll
   * (native for wheel, explicit for thumb) so the pause-buffer step arms its
   * pin/anchor while the viewport is still at rest.
   */
  const handleScrollGesture = (deltaY: number, opts?: { pulseOnce?: boolean }) => {
    noteUserScroll();
    armScrollRubber(deltaY);
    if (wheelTowardNewer(deltaY)) {
      engageLiveTowardNewer(deltaY);
      // Hard-stop overscroll: scrollTop may not change, so remount to
      // restart the pause-label highlight fade on each attempt.
      if (isManualPause && fillRubberFullyVisible()) {
        if (!opts?.pulseOnce) {
          pulseFillPauseLabels();
        } else if (!fillPauseSbPulsedRef.current) {
          fillPauseSbPulsedRef.current = true;
          pulseFillPauseLabels();
        }
      }
    }
    // While a backlog step is pending the geometry must stay live.
    if (flushPinRef.current) return;
    // Refs: armScrollRubber may have flushed a new rubber size into them.
    const inFill = inFillRubberZoneRef.current();
    const inOpposite = inOppositeRubberZoneRef.current();
    if (inOpposite || inFill) {
      lockScrollGeometry();
    } else {
      unlockScrollGeometryIfSettledRef.current();
    }
    if (inFill || inOpposite) scheduleRubberBandRef.current();
  };

  const handleScrollGestureRef = useRef(handleScrollGesture);
  handleScrollGestureRef.current = handleScrollGesture;

  // Pills sit outside the scrollport, so a wheel over them never reaches it.
  // Non-passive: React's root wheel listener cannot preventDefault. Run the
  // gesture while scrollTop is still the pre-tick value, then scroll the port
  // the way the browser would have if the cursor had been on a row.
  const attachPillWheel = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      const scroller = parentRef.current;
      if (!scroller) return;
      e.preventDefault();
      e.stopPropagation();
      handleScrollGestureRef.current(e.deltaY);
      scroller.scrollBy({
        top: wheelAxisPx(e.deltaY, e.deltaMode, scroller.clientHeight),
        left: wheelAxisPx(e.deltaX, e.deltaMode, scroller.clientWidth),
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  /**
   * Thumb pixels → scroll pixels with the CURRENT virtual geometry (recomputed
   * on every move, never frozen), so the handle always spans what is painted.
   */
  const thumbPxToScrollPx = (thumbDy: number) => {
    const el = parentRef.current;
    if (!el) return 0;
    const { clientHeight, scrollHeight, scrollTop } = el;
    const virtSH = scrollHeight + overlayBacklogPx(scrollTop, clientHeight);
    const thumbHeight = Math.max(LIST_SB_MIN_THUMB_PX, (clientHeight * clientHeight) / Math.max(virtSH, 1));
    const trackTravel = Math.max(0, clientHeight - thumbHeight);
    const virtMaxScroll = Math.max(0, virtSH - clientHeight);
    if (trackTravel <= 0 || virtMaxScroll <= 0) return 0;
    return (thumbDy / trackTravel) * virtMaxScroll;
  };

  const onSbThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = parentRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrollbarHeldRef.current = true;
    lockScrollGeometry();
    sbDragRef.current = { pointerId: e.pointerId, lastY: e.clientY };
  };

  // Each move is one wheel-equivalent delta: same gesture handler (metered
  // pause-buffer mixing, pending-step accumulation, hard stop), then the scroll
  // itself, then an immediate live repaint of the handle.
  const onSbThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sbDragRef.current;
    const el = parentRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el) return;
    const dy = e.clientY - drag.lastY;
    drag.lastY = e.clientY;
    if (dy === 0) return;
    const scrollDelta = thumbPxToScrollPx(dy);
    if (scrollDelta === 0) return;
    handleScrollGesture(scrollDelta, { pulseOnce: true });
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.max(0, Math.min(maxScroll, el.scrollTop + scrollDelta));
    syncOverlayScrollbar();
  };

  const onSbThumbPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sbDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    sbDragRef.current = null;
    fillPauseSbPulsedRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    syncOverlayScrollbar();
    // Global pointerup listener also clears scrollbarHeldRef + rubber/unlock.
  };

  const onSbTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const el = parentRef.current;
    const thumb = sbThumbRef.current;
    if (!el || !thumb || thumb.clientHeight <= 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const thumbTop = thumb.offsetTop;
    const thumbHeight = thumb.offsetHeight;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    if (maxScroll <= 0) return;
    noteUserScroll();
    // Page toward the click; keep real scroll range (no virtual backlog travel).
    // A page toward the fill from the live edge feeds the backlog like PageUp/Down.
    const before = el.scrollTop;
    if (y < thumbTop) {
      // Arm before the native move so the anchor is captured at rest.
      if (liveEdge === 'top' && backlogFeedActive()) engageLiveTowardNewer(-el.clientHeight);
      el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight);
      if (isManualPause && liveEdge === 'top' && before === el.scrollTop && fillRubberFullyVisible()) {
        pulseFillPauseLabels();
      }
    } else if (y > thumbTop + thumbHeight) {
      if (liveEdge === 'bottom' && backlogFeedActive()) engageLiveTowardNewer(el.clientHeight);
      el.scrollTop = Math.min(maxScroll, el.scrollTop + el.clientHeight);
      if (isManualPause && liveEdge === 'bottom' && before === el.scrollTop && fillRubberFullyVisible()) {
        pulseFillPauseLabels();
      }
    }
  };

  useLayoutEffect(() => {
    syncOverlayScrollbar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePausedCount, telegramRows.length, virtTotalPx, oppositeSpacerPx, liveEdge, fillRubberPx, viewportHeight]);

  const rawNewerCountRef = useRef(0);
  // Bumped when a scroll changes the newer-pill count without moving the
  // virtualizer window, so the pill re-renders against the new scrollTop.
  const [newerScrollEpoch, setNewerScrollEpoch] = useState(0);

  const handleScroll = () => {
    // The virtualizer skips a re-render when the overscan window does not
    // change. A short filtered list is entirely inside that window, so the
    // newer pill would keep the count from the previous scroll position.
    const scrollElNow = parentRef.current;
    if (scrollElNow && isTimeSort) {
      const rowsNow = telegramRowsRef.current;
      const itemsNow = virtualizer.getVirtualItems();
      const measuredNow = itemsNow.some(item => item.size > 0);
      const countEdge = displayEdges ? anchorEdge : liveEdge;
      let nextRaw = displayEdges && readDirection
        ? anchorEdgeCount(0, visiblePausedCountRef.current, readDirection)
        : visiblePausedCountRef.current;
      if (rowsNow.length > 0 && measuredNow && virtualizer.getTotalSize() > 0) {
        const mergedOut = countMergedScrolledOut(
          rowsNow.length,
          countEdge,
          scrollElNow.scrollTop,
          scrollElNow.clientHeight,
          itemsNow,
          0,
        );
        nextRaw = displayEdges && readDirection
          ? anchorEdgeCount(mergedOut, visiblePausedCountRef.current, readDirection)
          : mergedOut + visiblePausedCountRef.current;
      }
      if (nextRaw !== rawNewerCountRef.current) {
        rawNewerCountRef.current = nextRaw;
        setNewerScrollEpoch(epoch => epoch + 1);
      }
    }
    // Labels track fill visibility even for programmatic rubber/settle scrolls.
    syncFillPauseLabels();
    syncOverlayScrollbar();
    // Ignore the scrolls our own compensation triggers.
    if (programmaticScrollRef.current || refindingAnchorRef.current) return;
    // A pending backlog step owns the anchor until its rows land: the native
    // scroll of the gesture that armed it must not re-anchor or re-follow.
    if (flushPinRef.current) return;
    markCursorRef.current = null;
    releaseStickySpacerIfFits();
    if (inOppositeRubberZone() || inFillRubberBand() || scrollbarHeldRef.current) {
      lockScrollGeometry();
    } else {
      unlockScrollGeometryIfSettled();
    }
    // Keep a viewport snapshot of the preferred selection for App-driven refilters.
    const pref = lastSelectedRef.current;
    if (pref) {
      const o = rowOffset(pref);
      if (o != null) lastKnownPreferredPinRef.current = { key: pref, offset: o };
    }
    if (inFillRubberBand() || inOppositeRubberZone()) scheduleRubberBand();
    if (inFillRubberZone() && backlogFeedActive()) {
      // The empty fill slot is on screen with a backlog waiting: fill it.
      engageLiveTowardNewer(0);
      return;
    }
    const newestVisible = newestFullyVisible();

    if (detachedFromEdgeRef.current) {
      // Stay unfollowed until newest has left full visibility at least once.
      // Flush is fill-axis-only (engageLiveTowardNewer), never from scroll alone.
      if (!newestVisible) {
        detachedFromEdgeRef.current = false;
        atEdgeRef.current = false;
      }
      captureAnchor();
      return;
    }

    // Returning to the newest row re-follows — unless a backlog waits, which
    // would flush all at once; it is fed in by fill-axis gestures instead.
    if (newestVisible && !isManualPause && !backlogFeedActive()) {
      enableLiveFollow();
      return;
    }

    if (atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      if (liveFollow) onListFollowChange?.(false);
      detachedFromEdgeRef.current = true;
    }
    captureAnchor();
  };

  // Pin a row for a user action. Prefer keeping it visually still (instant
  // scroll correction). Only animate when the scroll edge clamps and the row
  // must move (e.g. context collapse while already scrolled to the top).
  // Preferred pin target after a display-changing action: last selected →
  // first selected (list order) → topmost visible row.
  const preferredPinKey = (rows: typeof telegramRowsRef.current = telegramRowsRef.current): string | null => {
    if (rows.length === 0) return null;
    const present = new Set(rows.map(anchorKey));
    const latest = lastSelectedRef.current;
    if (latest && present.has(latest)) return latest;
    for (const r of rows) {
      const key = anchorKey(r);
      if (mouseKeyListRef.current.includes(key)) return key;
    }
    return anchorKey(rows[0]);
  };

  // Snapshot a row's viewport offset from the CURRENT DOM, then schedule a
  // restore after the upcoming display update. Call this in the same event
  // turn as setState, before React commits the new list. An explicit key
  // (the context button's row) wins over the preferred selection.
  const requestDisplayPin = (explicitKey?: string) => {
    const rows = telegramRowsRef.current;
    let key: string | null = explicitKey ?? null;
    if (!key) {
      // Prefer last selected / mouse selection even if the current rows snapshot is
      // about to be replaced — the key must survive via force-include.
      const latest = lastSelectedRef.current;
      if (latest) key = latest;
      else {
        for (const r of rows) {
          const k = anchorKey(r);
          if (mouseKeyListRef.current.includes(k)) { key = k; break; }
        }
      }
      if (!key) key = preferredPinKey(rows);
    }
    if (key) {
      const armed = pendingDisplayPinRef.current;
      const live = rowOffset(key);
      const known = lastKnownPreferredPinRef.current;
      const offset = (armed?.key === key ? armed.offset : null)
        ?? live
        ?? (known?.key === key ? known.offset : 0);
      pendingDisplayPinRef.current = { key, offset };
      lastKnownPreferredPinRef.current = { key, offset };
    } else {
      pendingDisplayPinRef.current = null;
    }
    if (atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    // Drop any in-flight seek/settle so the layout-effect pin is not skipped
    // by `refindingAnchorRef` / `pinAnimRafRef` guards.
    refindingAnchorRef.current = false;
    if (pinAnimRafRef.current) {
      cancelAnimationFrame(pinAnimRafRef.current);
      pinAnimRafRef.current = 0;
    }
    if (listContentRef.current) listContentRef.current.style.transform = '';
    suppressListRefilterEffectRef.current = true;
    setDisplayPinNonce(n => n + 1);
  };
  requestDisplayPinRef.current = requestDisplayPin;
  contextButtonPinRef.current = (key: string) => {
    const offset = rowOffset(key) ?? 0;
    pendingDisplayPinRef.current = { key, offset };
    lastKnownPreferredPinRef.current = { key, offset };
    captureAnchor(key);
  };

  // Restore the pre-change viewport offset once the new list has painted.
  useLayoutEffect(() => {
    if (displayPinNonce === 0) return;
    const pending = pendingDisplayPinRef.current;
    pendingDisplayPinRef.current = null;
    const rows = telegramRowsRef.current;
    if (rows.length === 0) return;

    let key = pending?.key ?? null;
    if (!key || !rows.some(r => anchorKey(r) === key)) {
      key = preferredPinKey(rows);
    }
    if (!key) return;

    const offset = pending && pending.key === key ? pending.offset : 0;
    if (atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    anchorRef.current = { key, offset };
    // Keep anchorRowsRef on the *previous* list identity. pinAnchor only
    // scrollToIndex's a missing row when it sees a list change; assigning the
    // new rows here made QF/filter pins no-op and left the row off-screen.
    onListAnchorKeyChange?.(key);
    animateNextPinRef.current = true;
    pinAnchor();
    flashRow(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPinNonce]);

  // Parent-driven view changes (main filter toggle / edits). Snapshot from
  // lastKnown — the DOM may already reflect the new filtered list.
  const viewChangeSeenRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (viewChangeToken == null) return;
    if (viewChangeSeenRef.current === undefined) {
      viewChangeSeenRef.current = viewChangeToken;
      return;
    }
    if (viewChangeSeenRef.current === viewChangeToken) return;
    viewChangeSeenRef.current = viewChangeToken;
    const known = lastKnownPreferredPinRef.current;
    const key = lastSelectedRef.current ?? known?.key ?? preferredPinKey();
    if (key) {
      const offset = known?.key === key ? known.offset : 0;
      pendingDisplayPinRef.current = { key, offset };
    }
    if (atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    suppressListRefilterEffectRef.current = true;
    setDisplayPinNonce(n => n + 1);
  }, [viewChangeToken]);

  // Header tristate for one side, from the rows on screen right now.
  const beforeFlagState: TriState = useMemo(
    () => sideFlagsTristate(telegramRows.map(t => beforeSet.has(anchorKey(t)))),
    [telegramRows, beforeSet],
  );
  const afterFlagState: TriState = useMemo(
    () => sideFlagsTristate(telegramRows.map(t => afterSet.has(anchorKey(t)))),
    [telegramRows, afterSet],
  );

  const handleHeaderSideClick = useCallback((side: 'before' | 'after', e: React.MouseEvent) => {
    const state = side === 'before' ? beforeFlagState : afterFlagState;
    const next = nextTriState(state, { ctrl: e.ctrlKey || e.metaKey });
    const visible = telegramRows.map(t => anchorKey(t));
    const current = side === 'before' ? beforeList : afterList;
    const updated = withSide(current, visible, next === 'all');
    if (side === 'before') setBeforeList(updated);
    else setAfterList(updated);
    requestDisplayPinRef.current();
  }, [
    beforeFlagState, afterFlagState, telegramRows, beforeList, afterList,
    setBeforeList, setAfterList,
  ]);

  // + toggles after, - toggles before. Ctrl/Cmd applies the clicked side's
  // next state to every side that has a quick-filter window. A click inside
  // an existing selection applies to every selected row. Pin the clicked row
  // so the list does not scroll.
  const handleContextSideClick = useCallback((
    e: React.MouseEvent,
    key: string,
    side: 'before' | 'after',
  ) => {
    e.stopPropagation();
    requestDisplayPinRef.current(key);

    const alsoOther = e.ctrlKey || e.metaKey;
    const selected = mouseKeyListRef.current;
    const targets = selected.includes(key) ? selected : [key];
    const clickedOn = side === 'before' ? beforeSet.has(key) : afterSet.has(key);
    const nextOn = !clickedOn;
    const beforeOpen = deltaBeforeMs > 0;
    const afterOpen = deltaAfterMs > 0;
    if ((side === 'before' || alsoOther) && beforeOpen) {
      setBeforeList(withSide(beforeList, targets, nextOn));
    }
    if ((side === 'after' || alsoOther) && afterOpen) {
      setAfterList(withSide(afterList, targets, nextOn));
    }
  }, [
    beforeSet, afterSet, beforeList, afterList, setBeforeList, setAfterList,
    deltaBeforeMs, deltaAfterMs,
  ]);

  // Selection is applied on mousedown, after the clicked row is pinned, so the
  // new selection is visible while the button is still down. Shift/Ctrl cancel
  // a browser text selection before it starts. A click without this mousedown
  // still selects.
  const MARK_DRAG_THRESHOLD_PX = 4;
  const rowClickIgnoredTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    const btn = target.closest('button, [role="button"]');
    if (!btn) return false;
    // Context flag: let the row mouse-selection handlers run as well.
    if (btn.hasAttribute('data-context-flag')) return false;
    return true;
  };
  const detachLiveFollow = () => {
    if (!liveFollow) return;
    if (!(isTimeSort && atEdgeRef.current)) return;
    atEdgeRef.current = false;
    detachedFromEdgeRef.current = true;
    setFollowingLive(false);
    onListFollowChange?.(false);
  };
  const beginClickPin = (key: string) => {
    if (!rowInViewport(key)) return;
    detachLiveFollow();
    captureAnchor(key);
    const offset = rowOffset(key);
    if (offset != null) lastKnownPreferredPinRef.current = { key, offset };
    clickPinHoldRef.current = true;
    animateNextPinRef.current = false;
  };

  // Mouse selection (#310): plain click makes this the sole selected row;
  // ctrl/cmd toggles it; shift ranges from the previous last-selected row.
  // Does not change the marked flag. A goto uses the same rules.
  // A click-pin already holds the pressed row; do not replace that anchor.
  const applyRowSelection = (
    key: string,
    index: number,
    mods: { additive: boolean; range: boolean },
    opts?: { keepClickPin?: boolean; preserveFollow?: boolean },
  ) => {
    const { additive, range } = mods;
    let next = mouseKeyList;
    if (range) {
      const anchorIdx = lastSelected ? telegramRows.findIndex(r => anchorKey(r) === lastSelected) : -1;
      let rangeKeys: string[];
      if (anchorIdx === -1) {
        rangeKeys = [key];
      } else {
        const lo = Math.min(anchorIdx, index);
        const hi = Math.max(anchorIdx, index);
        rangeKeys = telegramRows.slice(lo, hi + 1).map(r => anchorKey(r));
      }
      next = additive ? addKeys(next, rangeKeys) : soleKeys(rangeKeys);
    } else if (additive) {
      next = toggleKey(next, key);
    } else {
      next = soleKeys([key]);
    }
    setMouseKeyList(next);
    setLastSelected(key);
    markCursorRef.current = key;
    const selectedKey = next.includes(key) ? key : null;

    if (!opts?.preserveFollow) detachLiveFollow();
    else atEdgeRef.current = false;
    if (!opts?.keepClickPin && !clickPinHoldRef.current && !atEdgeRef.current) {
      captureAnchor(selectedKey);
    }
    if (!opts?.keepClickPin && selectedKey) {
      const o = rowOffset(selectedKey);
      if (o != null) lastKnownPreferredPinRef.current = { key: selectedKey, offset: o };
    }
  };

  const handleMarkMouseDown = (e: React.MouseEvent, key: string, index: number) => {
    if (e.button !== 0 || rowClickIgnoredTarget(e.target)) return;
    markPointerRef.current = { x: e.clientX, y: e.clientY };
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    beginClickPin(key);
    const gesture = { key, index, x: e.clientX, y: e.clientY, additive, range, selected: false };
    clickGestureRef.current = gesture;
    document.addEventListener('mouseup', onClickGestureEnd);
    document.addEventListener('pointercancel', onClickGestureEnd);
    if (additive || range) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }
    applyRowSelection(key, index, { additive, range }, { keepClickPin: true });
    gesture.selected = true;
  };

  const handleMarkClick = (e: React.MouseEvent, key: string, index: number) => {
    // Modifier mousedown already selected. A later click must not run the
    // range again from the row that mousedown just made last-selected.
    if (swallowNextRowClickRef.current || clickGestureRef.current?.selected) {
      swallowNextRowClickRef.current = false;
      markPointerRef.current = null;
      return;
    }
    const origin = markPointerRef.current;
    markPointerRef.current = null;
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    // Drag without modifiers = text selection; leave the row unmarked so the
    // selection isn't destroyed by a mark-state re-render.
    if (!additive && !range && origin) {
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (dx * dx + dy * dy > MARK_DRAG_THRESHOLD_PX * MARK_DRAG_THRESHOLD_PX) {
        return;
      }
    }
    if (additive || range) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }

    applyRowSelection(key, index, { additive, range });
  };

  // Rail toggles the marked flag. When the clicked row is mouse-selected, the
  // same action applies to the whole selection. The flag stays when the
  // selection moves away.
  const handleRailMarkClick = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const targets = targetsForSelectionAction(key);
    setMarkedKeyList(prev => markedKeySet.has(key) ? removeKeys(prev, targets) : addKeys(prev, targets));
    markCursorRef.current = key;
  };

  // Colour swatch: apply the last chosen colour to the selection. If the
  // clicked row already has that colour, step one palette colour forward.
  // Ctrl/Cmd clears the selection's colour without forgetting the last one.
  // Alt sets the hide flag (rows leave the list; marks are kept).
  const handleRailColorClick = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const targets = targetsForSelectionAction(key);
    if (e.altKey) {
      setHiddenKeyList(prev => {
        const next = new Set(prev);
        for (const k of targets) next.add(k);
        return [...next];
      });
      requestDisplayPinRef.current();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setMarkColorIndices(prev => {
        let colors = prev;
        for (const k of targets) colors = setMarkColorIndex(colors, k, null);
        return colors;
      });
      return;
    }
    setMarkColorIndices(prev => {
      const own = getMarkColorIndex(prev, key);
      const last = lastSetColorRef.current;
      const index = last != null && own === last
        ? (last + 1) % MARK_COLOR_PALETTE.length
        : (last ?? own ?? 0);
      lastSetColorRef.current = index;
      let colors = prev;
      for (const k of targets) colors = setMarkColorIndex(colors, k, index);
      return colors;
    });
  };

  /**
   * Programmatic scroll onto a content edge. Drops a scroll rubber first so
   * the landing is not inside a spacer. `live` is the newer edge; `anchor`
   * is that edge, or the opposite one when the anchor sits there.
   */
  const scrollToContentEdge = (which: 'live' | 'anchor') => {
    cancelRubberBand();
    releaseScrollRubber();
    const el = parentRef.current;
    if (!el) return;
    const top = which === 'anchor' && anchorEdge !== liveEdge
      ? settledOppositeScrollTop()
      : settledEdgeScrollTop();
    markProgrammatic();
    el.scrollTop = top;
  };

  const scrollToEdge = () => {
    scrollToContentEdge('live');
  };

  /** Settled anchor end: the anchor row flush, not into a scroll spacer. */
  const scrollToAnchor = () => {
    scrollToContentEdge('anchor');
    atEdgeRef.current = false;
    detachedFromEdgeRef.current = true;
  };

  const jumpToLive = (releaseManual = false, revealBacklog = false) => {
    if (!liveFollow) return;
    // Pill path wants the jump to the merged newest — not a seamless pin.
    flushPinRef.current = false;
    pendingFlushScrollDeltaRef.current = null;
    revealRef.current = null;
    setStickyOppositeSpacerPx(0);
    // Plain click while manually paused: publish the backlog and scroll to
    // the newest telegram, but stay paused and do not follow. Ctrl-click
    // resumes (Play + follow + flush), same as a click while auto-paused.
    // `revealBacklog` is only set by that pill click — a mount-time fallback
    // must not empty the pause buffer.
    if (isManualPause && !releaseManual) {
      if (revealBacklog && pausedCount > 0) {
        jumpToLiveRef.current = true;
        atEdgeRef.current = true;
        onPauseReveal?.(pausedCount);
      } else {
        jumpToLiveRef.current = false;
      }
      scrollToEdge();
      return;
    }
    jumpToLiveRef.current = true;
    enableLiveFollow();
    onJumpToLive?.();
    scrollToEdge();
  };

  // Scrolls to a specific row by index. A goto that lands inside the buffer
  // only scrolls (`preserveFollow`): direction, anchor and pause stay.
  // Info-bar and mark jumps still leave live-follow. The scroll spacer is not
  // part of this jump — it exists only while the user is scrolling.
  const gotoIndex = (idx: number, opts?: { preserveFollow?: boolean }) => {
    if (idx < 0 || idx >= telegramRows.length) return;
    const preserveFollow = !!opts?.preserveFollow;
    if (!preserveFollow) {
      detachedFromEdgeRef.current = true;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    anchorRef.current = null;
    cancelRubberBand();
    releaseScrollRubber();
    const settleInContent = () => {
      const el = parentRef.current;
      if (!el) return;
      if (manualHoldActive() && inFillRubberZone()) return;
      const { lo, hi } = contentScrollRange(el);
      const next = Math.min(hi, Math.max(lo, el.scrollTop));
      if (Math.abs(next - el.scrollTop) > 0.5) {
        markProgrammatic();
        el.scrollTop = next;
      }
      const onEdge = Math.abs(el.scrollTop - settledEdgeScrollTop()) <= 0.5;
      atEdgeRef.current = preserveFollow && onEdge;
      if (preserveFollow && onEdge) detachedFromEdgeRef.current = false;
    };
    markProgrammatic();
    virtualizer.scrollToIndex(idx, { align: 'center' });
    settleInContent();
    // Rows are dynamically measured, so give the virtualizer two frames
    // before the landing is captured. The clamp keeps a centered edge row
    // out of a legacy rubber inset.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      settleInContent();
      captureAnchor();
      if (!preserveFollow) {
        atEdgeRef.current = false;
        detachedFromEdgeRef.current = true;
        setFollowingLive(false);
        onListFollowChange?.(false);
      }
    }));
  };

  // Jump between unhidden marked rows (#442), in display order. Hidden rows
  // are not in this list. The starting point is the mark last jumped to or
  // clicked; once the user scrolls away it is whatever row sits in the middle
  // of the viewport instead. Context-flagged rows are not marks.
  const markedIndices = useMemo(() => {
    if (actionableMarkedSet.size === 0) return [];
    const out: number[] = [];
    telegramRows.forEach((r, i) => {
      if (actionableMarkedSet.has(anchorKey(r))) out.push(i);
    });
    return out;
  }, [telegramRows, actionableMarkedSet]);

  const viewportCenterIndex = () => {
    const el = parentRef.current;
    if (!el) return 0;
    const center = el.scrollTop + el.clientHeight / 2;
    const item = virtualizer.getVirtualItems().find(v => v.start <= center && center < v.end);
    return item ? item.index : 0;
  };

  const markNavFromIndex = () => {
    const cursor = markCursorRef.current;
    const cursorIdx = cursor ? telegramRows.findIndex(r => anchorKey(r) === cursor) : -1;
    return cursorIdx !== -1 ? cursorIdx : viewportCenterIndex();
  };

  const jumpToMark = (dir: 1 | -1) => {
    if (markedIndices.length === 0) return;
    const target = adjacentMark(markedIndices, markNavFromIndex(), dir);
    if (target == null) return;
    const key = anchorKey(telegramRows[target]);
    markCursorRef.current = key;
    gotoIndex(target);
    flashRow(key);
  };

  const markNavFrom = markNavFromIndex();
  const canJumpMarkPrev = adjacentMark(markedIndices, markNavFrom, -1) != null;
  const canJumpMarkNext = adjacentMark(markedIndices, markNavFrom, 1) != null;

  // "Quick goto time" (#282): jump to the telegram nearest a given time. Only
  // meaningful for the timestamp sort, where rows are ordered by time — the
  // info bar's jumps use gotoIndex directly since they already know the index.
  // A target inside the raw buffer only scrolls. Outside, a confirmed goto
  // fills forward from an older time or backward from a newer one.
  const gotoTimeGenRef = useRef(0);
  const noteJump = (row: TelegramRow | undefined, additive: boolean) => {
    if (!row) return;
    onJumpTarget?.(anchorKey(row), additive ? 'add' : 'replace');
  };
  const nearestTimeIndex = (rows: readonly TelegramRow[], targetMs: number): number | null => {
    if (rows.length === 0) return null;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const diff = Math.abs(new Date(rows[i].timestamp).getTime() - targetMs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    return bestIdx;
  };

  const gotoTime = (
    targetMs: number,
    mods?: { allowFill?: boolean; additive?: boolean; preserveFollow?: boolean },
  ): number | null => {
    const rows = telegramRows;
    if (rows.length === 0 && bufferOldestMs == null && bufferNewestMs == null) return null;

    const place = classifyGotoTarget(targetMs, bufferOldestMs, bufferNewestMs);
    const inBuffer = place === 'inside';
    const allowFill = mods?.allowFill !== false;
    const preserveFollow = mods?.preserveFollow ?? inBuffer;

    const jumpAfterFill = (fill: Promise<void> | void) => {
      const gen = ++gotoTimeGenRef.current;
      onListFollowChange?.(false);
      void Promise.resolve(fill).then(() => {
        if (gotoTimeGenRef.current !== gen) return;
        const idx = nearestTimeIndex(telegramRowsRef.current, targetMs);
        if (idx == null) return;
        gotoIndex(idx, { preserveFollow: false });
        noteJump(telegramRowsRef.current[idx], false);
      });
    };

    if (inBuffer) {
      const bestIdx = nearestTimeIndex(rows, targetMs);
      if (bestIdx == null) return null;
      gotoIndex(bestIdx, { preserveFollow });
      noteJump(rows[bestIdx], !!mods?.additive);
      return bestIdx;
    }

    // History cannot fetch a row the server already left out.
    if (gotoScope === 'history' || place === 'unknown') {
      if (place === 'unknown') {
        const bestIdx = nearestTimeIndex(rows, targetMs);
        if (bestIdx == null) return null;
        gotoIndex(bestIdx, { preserveFollow });
        noteJump(rows[bestIdx], !!mods?.additive);
        return bestIdx;
      }
      return null;
    }

    if (!allowFill) return null;
    if (place === 'older' && onGotoFillOlder) {
      jumpAfterFill(onGotoFillOlder(targetMs));
      return null;
    }
    if (place === 'newer' && onGotoFillNewer) {
      jumpAfterFill(onGotoFillNewer(targetMs));
      return null;
    }
    // No loader: the published list is all we can scroll.
    const bestIdx = nearestTimeIndex(rows, targetMs);
    if (bestIdx == null) return null;
    gotoIndex(bestIdx, { preserveFollow: false });
    noteJump(rows[bestIdx], false);
    return bestIdx;
  };

  // Newest telegram time, used to seed the goto-time input.
  const newestMs = telegramRows.length > 0
    ? new Date(telegramRows[liveEdge === 'top' ? 0 : telegramRows.length - 1].timestamp).getTime()
    : null;

  const cancelPinAnim = () => {
    if (pinAnimRafRef.current) {
      cancelAnimationFrame(pinAnimRafRef.current);
      pinAnimRafRef.current = 0;
    }
    if (listContentRef.current) listContentRef.current.style.transform = '';
  };

  // Slow cubic ease-out, no overshoot — only for clamped (unavoidable) pin moves.
  const pinSettleEase = (t: number) => 1 - (1 - t) ** 3;

  /** Ease a visual remainder the scroll edge could not absorb (transform settle). */
  const animatePinVisualError = (visualError: number, flashKey?: string) => {
    const content = listContentRef.current;
    if (!content) {
      animateNextPinRef.current = false;
      return;
    }
    cancelPinAnim();
    animateNextPinRef.current = false;
    if (flashKey) flashRow(flashKey);
    // Row is `visualError` px away from the pin; shift content so it looks pinned,
    // then ease that fake offset away.
    const startY = -visualError;
    content.style.transform = `translateY(${startY}px)`;
    const durationMs = 700;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      const y = startY * (1 - pinSettleEase(t));
      programmaticScrollRef.current = true;
      content.style.transform = Math.abs(y) < 0.5 ? '' : `translateY(${y}px)`;
      if (t < 1) {
        pinAnimRafRef.current = requestAnimationFrame(tick);
        return;
      }
      pinAnimRafRef.current = 0;
      content.style.transform = '';
      anchorRowsRef.current = telegramRowsRef.current;
      const anchor = anchorRef.current;
      if (anchor) {
        const o = rowOffset(anchor.key);
        if (o != null) anchor.offset = o;
      }
      requestAnimationFrame(() => { programmaticScrollRef.current = false; });
    };
    pinAnimRafRef.current = requestAnimationFrame(tick);
  };

  const heldTranslateY = () => {
    const raw = listContentRef.current?.style.transform ?? '';
    const match = /translateY\((-?[\d.]+)px\)/.exec(raw);
    return match ? Number(match[1]) : 0;
  };

  /**
   * After mouseup: scroll just enough to close a gap above the first row or
   * below the last one, and ease away a transform the hold used when the
   * scroll range clamped. The anchor then keeps the row's new offset.
   */
  const settleClickPinFill = () => {
    const el = parentRef.current;
    if (!el) return;
    const rowNodes = el.querySelectorAll<HTMLElement>('.log-row');
    if (rowNodes.length === 0) return;
    const cr = el.getBoundingClientRect();
    const first = rowNodes[0].getBoundingClientRect();
    const last = rowNodes[rowNodes.length - 1].getBoundingClientRect();
    const { lo, hi } = pinScrollBounds(el, true);
    let scrollDelta = 0;
    if (last.bottom < cr.bottom - 0.5 && el.scrollTop < hi - 0.5) {
      scrollDelta = Math.min(cr.bottom - last.bottom, hi - el.scrollTop);
    } else if (first.top > cr.top + 0.5 && el.scrollTop > lo + 0.5) {
      scrollDelta = -Math.min(first.top - cr.top, el.scrollTop - lo);
    }
    const heldY = heldTranslateY();
    if (Math.abs(scrollDelta) < 0.5 && Math.abs(heldY) < 0.5) return;

    const content = listContentRef.current;
    cancelPinAnim();
    if (content && Math.abs(heldY) >= 0.5) content.style.transform = `translateY(${heldY}px)`;
    const startTop = el.scrollTop;
    const t0 = performance.now();
    const durationMs = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      const eased = pinSettleEase(t);
      programmaticScrollRef.current = true;
      if (Math.abs(scrollDelta) >= 0.5) el.scrollTop = startTop + scrollDelta * eased;
      if (content) {
        const y = heldY * (1 - eased);
        content.style.transform = Math.abs(y) < 0.5 ? '' : `translateY(${y}px)`;
      }
      if (t < 1) {
        pinAnimRafRef.current = requestAnimationFrame(tick);
        return;
      }
      pinAnimRafRef.current = 0;
      if (content) content.style.transform = '';
      if (Math.abs(scrollDelta) >= 0.5) el.scrollTop = startTop + scrollDelta;
      const anchor = anchorRef.current;
      if (anchor) {
        const offset = rowOffset(anchor.key);
        if (offset != null) anchor.offset = offset;
      }
      anchorRowsRef.current = telegramRowsRef.current;
      requestAnimationFrame(() => { programmaticScrollRef.current = false; });
    };
    pinAnimRafRef.current = requestAnimationFrame(tick);
  };

  const requestClickPinSettle = () => {
    settleClickPinRef.current = true;
    requestAnimationFrame(() => {
      if (!settleClickPinRef.current) return;
      settleClickPinRef.current = false;
      clickPinHoldRef.current = false;
      settleClickPinFill();
    });
  };

  clickGestureEndRef.current = () => {
    document.removeEventListener('mouseup', onClickGestureEnd);
    document.removeEventListener('pointercancel', onClickGestureEnd);
    const gesture = clickGestureRef.current;
    clickGestureRef.current = null;
    if (!gesture) return;
    swallowNextRowClickRef.current = true;
    setTimeout(() => { swallowNextRowClickRef.current = false; }, 0);
    if (!gesture.selected) {
      applyRowSelection(gesture.key, gesture.index, {
        additive: gesture.additive,
        range: gesture.range,
      }, { keepClickPin: true });
    }
    requestClickPinSettle();
  };

  /**
   * Keep the pinned row still via scrollTop when possible. If an action-pin
   * cannot be restored because the scroll edge clamps, ease the remaining
   * visual jump; never animate a correctable (still-holding) pin.
   */
  const applyPinDelta = (el: HTMLElement, delta: number) => {
    if (Math.abs(delta) <= 0.5) {
      // Layout may still be settling after an action — keep the flag briefly.
      if (animateNextPinRef.current) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (animateNextPinRef.current && !pinAnimRafRef.current) {
              animateNextPinRef.current = false;
            }
          });
        });
      }
      return;
    }

    const wantClampAnim = animateNextPinRef.current;
    const { lo, hi } = pinScrollBounds(el, wantClampAnim || clickPinHoldRef.current);
    const clamped = Math.min(hi, Math.max(lo, el.scrollTop + delta));
    markProgrammatic();
    el.scrollTop = clamped;

    if (clickPinHoldRef.current) {
      const anchor = anchorRef.current;
      const after = anchor ? rowOffset(anchor.key) : null;
      const content = listContentRef.current;
      if (anchor && after != null && content) {
        const visualError = after - anchor.offset;
        content.style.transform = Math.abs(visualError) > 0.5
          ? `translateY(${-visualError}px)`
          : '';
      }
      return;
    }

    if (!wantClampAnim) return;

    const anchor = anchorRef.current;
    const after = anchor ? rowOffset(anchor.key) : null;
    if (!anchor || after == null) {
      animateNextPinRef.current = false;
      return;
    }
    const visualError = after - anchor.offset;
    if (Math.abs(visualError) > 0.5) {
      animatePinVisualError(visualError, anchor.key);
    } else {
      animateNextPinRef.current = false;
    }
  };

  /**
   * Jump the virtualizer so `anchor` lands at its saved viewport offset.
   * Used after list identity changes (QF/filter): set scrollTop from measured
   * item offsets in this layout turn so the row is not missing for a frame.
   */
  const seekPinnedRow = (el: HTMLElement, anchor: { key: string; offset: number }, idx: number) => {
    cancelPinAnim();
    refindingAnchorRef.current = true;
    // Ensure measurement cache is warm before reading offsets.
    void virtualizer.getTotalSize();
    // Prefer measurementsCache: getOffsetForIndex clamps to virtTotal-viewport,
    // which is 0 for short lists and would hide the fill-rubber start (43px).
    // The range comes from the scrollport (it includes the DOM opposite
    // spacer) minus the rubber zones — see pinScrollBounds.
    const itemStart =
      virtualizer.measurementsCache[idx]?.start
      ?? virtualizer.getOffsetForIndex(idx, 'start')?.[0]
      ?? fillRubberPx + idx * ROW_ESTIMATE;
    const { lo, hi } = pinScrollBounds(el, animateNextPinRef.current || clickPinHoldRef.current);
    const target = Math.min(hi, Math.max(lo, itemStart - anchor.offset));
    markProgrammatic();
    // Set scrollTop directly: scrollToOffset can re-clamp against virtTotal
    // (excluding the opposite spacer) and undo the short-list target.
    el.scrollTop = target;

    const finish = (found: number | null) => {
      if (found != null && anchorRef.current === anchor) {
        applyPinDelta(el, found - anchor.offset);
        if (!pinAnimRafRef.current) anchorRowsRef.current = telegramRowsRef.current;
      } else {
        animateNextPinRef.current = false;
      }
      requestAnimationFrame(() => {
        refindingAnchorRef.current = false;
        if (found == null) captureAnchor();
        else if (!pinAnimRafRef.current) pinAnchor();
      });
    };

    // Scroll notify often mounts the row before paint; fine-tune immediately.
    const immediate = rowOffset(anchor.key);
    if (immediate != null) {
      finish(immediate);
      return;
    }
    // Otherwise wait for the virtualizer to paint the new window.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      finish(rowOffset(anchor.key));
    }));
  };

  // Correct scrollTop so the anchored row keeps its recorded viewport offset.
  const pinAnchor = () => {
    const el = parentRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor || atEdgeRef.current) return;
    const listChanged = anchorRowsRef.current !== telegramRows;
    // Action pins cancel an in-flight clamp settle so QF/filter is not dropped.
    if (pinAnimRafRef.current) {
      if (!animateNextPinRef.current) return;
      cancelPinAnim();
    }
    const now = rowOffset(anchor.key);
    // After a list change, even a non-null offset can be a stale virtual cell —
    // always re-seek so the preferred row keeps its place on the first paint.
    const needsSeek = now == null || (animateNextPinRef.current && listChanged);
    if (needsSeek) {
      if (refindingAnchorRef.current) return;
      // A changed row list means rows were inserted, even while the user's
      // gesture that triggered the flush still counts as scrolling. Only an
      // unchanged list with a missing anchor is the user having jumped away.
      const inserted = listChanged || !userScrolling();
      const idx = inserted ? telegramRows.findIndex(r => anchorKey(r) === anchor.key) : -1;
      if (idx === -1) {
        animateNextPinRef.current = false;
        captureAnchor();
        return;
      }
      // Metered flush: pin from the virtualizer layout before paint — an async
      // scrollToIndex would flash the live edge. Display pins keep seekPinnedRow
      // (optional clamp animation).
      if (flushPinRef.current) {
        const start = virtualizer.measurementsCache[idx]?.start
          ?? virtualizer.getOffsetForIndex(idx, 'start')?.[0];
        if (start != null) {
          const max = Math.max(0, el.scrollHeight - el.clientHeight);
          markProgrammatic();
          el.scrollTop = Math.min(max, Math.max(0, start - anchor.offset));
          anchorRowsRef.current = telegramRows;
          refindingAnchorRef.current = true;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            refindingAnchorRef.current = false;
            if (anchorRef.current !== anchor) return;
            const found = rowOffset(anchor.key);
            if (found == null) captureAnchor();
            else if (Math.abs(found - anchor.offset) > 0.5) {
              markProgrammatic();
              el.scrollTop += found - anchor.offset;
            }
          }));
          return;
        }
      }
      if (!listChanged && userScrolling()) return;
      seekPinnedRow(el, anchor, idx);
      return;
    }
    if (refindingAnchorRef.current) return;
    const delta = now - anchor.offset;
    applyPinDelta(el, delta);
    if (!pinAnimRafRef.current) anchorRowsRef.current = telegramRows;
  };

  // Changing sort moves (or removes) the live edge — drop the anchor state.
  // Skipped on mount: this effect and the restore-on-mount effect below both
  // run in the same commit, in declaration order, and the DOM has zero
  // scrollTop before either has scrolled anywhere — so without this guard,
  // checkAtEdge() always reads "at edge" here first and clobbers a restored
  // anchor (e.g. a cross-panel goto, #308) before it ever gets applied.
  const sortEffectMounted = useRef(false);
  const prevReadDirectionRef = useRef(readDirection);
  const prevRebuildDirRef = useRef(readDirection);
  useEffect(() => {
    const prev = prevReadDirectionRef.current;
    prevReadDirectionRef.current = readDirection;
    if (prev === readDirection) return;
    if (directionGesture === 'chevron') chevronSortHoldRef.current = true;
  }, [readDirection, directionGesture]);
  useEffect(() => {
    if (!sortEffectMounted.current) {
      sortEffectMounted.current = true;
      // Undo the flag on cleanup so StrictMode's dev-only double-invoke
      // (mount → cleanup → mount) still skips on both simulated mounts,
      // instead of treating the second one as a real sortConfig change.
      return () => { sortEffectMounted.current = false; };
    }
    if (chevronSortHoldRef.current) {
      chevronSortHoldRef.current = false;
      return;
    }
    setStripeOffset(0);
    // Sort reorders the list — pin + flash the preferred working row.
    requestDisplayPinRef.current();
  }, [sortConfig]);
  // A direction change other than the chevron scrolls back to the anchor.
  // The chevron leaves scrollTop alone; only the spacers move.
  useLayoutEffect(() => {
    const prev = prevRebuildDirRef.current;
    prevRebuildDirRef.current = readDirection;
    if (!displayEdges || prev === readDirection) return;
    if (directionGesture === 'chevron') return;
    const el = parentRef.current;
    if (!el) return;
    scrollToContentEdge('anchor');
    // displayPlan/anchorEdge belong to the direction that just changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readDirection, directionGesture, displayEdges]);

  // Settled follow depends on the measured viewport. A backward ascending
  // follow (newest at the bottom) would otherwise settle while clientHeight is
  // still 0 and stay on the older rows. Re-seat while still following once the
  // edge geometry is known. A later spacer change (a short list growing) must
  // not pull the viewport out of a rubber hold. A flush or a rubber band owns
  // the scroll until it finishes.
  const seatedForViewportRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!liveFollow || !isTimeSort || !atEdgeRef.current) return;
    if (rubberAnimRef.current || flushPinRef.current) return;
    // A scroll gesture owns the spacer it just opened. Re-seating here would
    // drop that rubber before the overscroll lands.
    if (userScrolling() || scrollRubberRef.current) return;
    const viewportKnown = seatedForViewportRef.current === viewportHeight;
    seatedForViewportRef.current = viewportHeight;
    if (viewportKnown && (inFillRubberZone() || inOppositeRubberZone())) return;
    scrollToEdge();
    // scrollToEdge reads the latest spacer sizes; the deps are that geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportHeight, liveFillRubberPx, liveOppositeSpacerPx, liveEdge, liveFollow, isTimeSort]);

  // Restore scroll position/anchor on mount (#203, #341)
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || telegramRows.length === 0) return;
    restoredRef.current = true;

    if (liveFollow && atEdgeRef.current) {
      scrollToEdge();
    } else if (listAnchorKey) {
      const idx = telegramRows.findIndex(t => anchorKey(t) === listAnchorKey);
      if (idx !== -1) {
        markProgrammatic();
        virtualizer.scrollToIndex(idx, { align: 'start' });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const offset = rowOffset(listAnchorKey);
          if (offset != null) {
            anchorRef.current = { key: listAnchorKey, offset };
            pinAnchor();
          }
        }));
      } else if (liveFollow) {
        jumpToLive();
      }
    } else if (liveFollow) {
      scrollToEdge();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramRows.length]);

  // Write-to-bus last value: same mouse selection as a click on that row.
  // A filtered or hidden row is pulled back via the mouse selection (and, for
  // a shift range, a temporary add of the target so the previous last-selected
  // row stays the range anchor). A telegram that is not in the buffer at all
  // only moves the list to that time.
  const appliedGotoId = useRef<number | null>(null);
  const pendingGotoSelect = useRef<{ key: string; additive: boolean; range: boolean; selected: boolean } | null>(null);
  // History quick-filter reveal: same goto as a parent request, used only when
  // the parent did not send one. Ctrl adds the jump target; it does not load.
  const filteredJumpSeq = useRef(0);
  const [filteredJump, setFilteredJump] = useState<ListGotoRequest | null>(null);
  const listGoto = gotoRequest ?? filteredJump;
  useEffect(() => {
    if (!listGoto) return;
    // Time-only jump (rewind / fill-then-scroll): no telegram identity to select.
    // Wait for rows before marking applied so a post-fill re-render can retry.
    if (listGoto.targetMs != null && !listGoto.telegram) {
      if (appliedGotoId.current === listGoto.id) return;
      if (telegramRows.length === 0) return;
      appliedGotoId.current = listGoto.id;
      pendingGotoSelect.current = null;
      gotoTime(listGoto.targetMs, {
        allowFill: listGoto.allowFill !== false,
        additive: !!listGoto.additive,
        preserveFollow: listGoto.preserveFollow,
      });
      return;
    }
    if (!listGoto.telegram) return;
    const key = anchorKey(listGoto.telegram);
    if (appliedGotoId.current !== listGoto.id) {
      const pool = forceIncludeFrom ?? telegrams;
      const inPool = pool.some(t => anchorKey(t) === key);
      if (!inPool) {
        appliedGotoId.current = listGoto.id;
        pendingGotoSelect.current = null;
        if (telegramRows.length === 0) return;
        const ms = new Date(listGoto.telegram.timestamp).getTime();
        if (!Number.isNaN(ms)) {
          gotoTime(ms, {
            allowFill: listGoto.allowFill !== false && !listGoto.preserveFollow,
            additive: !!listGoto.additive,
            ...(listGoto.preserveFollow ? { preserveFollow: true } : {}),
          });
        }
        return;
      }
      appliedGotoId.current = listGoto.id;
      if (hiddenKeyListRef.current.includes(key)) {
        setHiddenKeyList(prev => removeKeys(prev, [key]));
      }
      const additive = !!listGoto.additive;
      const range = !!listGoto.range;
      onJumpTarget?.(key, additive && !range ? 'add' : 'replace');
      const idx = telegramRows.findIndex(t => anchorKey(t) === key);
      if (idx !== -1) {
        pendingGotoSelect.current = null;
        applyRowSelection(key, idx, { additive, range }, { preserveFollow: true });
        if (!rowInViewport(key)) gotoIndex(idx, { preserveFollow: true });
        flashRow(key);
        return;
      }
      // Not painted yet: pin via mouse selection so force-include can reveal it.
      // A shift range must keep the previous last-selected row as its anchor.
      if (range) setMouseKeyList(prev => addKeys(prev, [key]));
      else applyRowSelection(key, -1, { additive, range: false }, { preserveFollow: true });
      pendingGotoSelect.current = { key, additive, range, selected: !range };
    }
    const pending = pendingGotoSelect.current;
    if (!pending) return;
    const idx = telegramRows.findIndex(t => anchorKey(t) === pending.key);
    if (idx === -1) return;
    pendingGotoSelect.current = null;
    if (!pending.selected) {
      applyRowSelection(pending.key, idx, { additive: pending.additive, range: pending.range }, { preserveFollow: true });
    }
    if (!rowInViewport(pending.key)) gotoIndex(idx, { preserveFollow: true });
    flashRow(pending.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listGoto, telegramRows, telegrams, forceIncludeFrom]);

  // React to list updates before paint: follow the live edge, or pin the
  // anchored row by correcting scrollTop by its real pixel shift.
  // Pause-buffer flush (isPaused true→false): always keep the viewport still
  // via pinAnchor — never scrollToEdge. A toward-newer gesture may then apply
  // its delta into the merged buffer so the pause rows blend in seamlessly.
  const prevRowsRef = useRef<{ firstKey: string | null; lastKey: string | null; len: number }>({
    firstKey: null, lastKey: null, len: 0,
  });
  const wasPausedRef = useRef(!!isPaused);
  /**
   * Apply the gesture delta held since the flush was armed. Returns the part
   * the scroll range clamped away (0 when it fit). The anchor is re-captured
   * at the new position, so later pins (remeasure, totalSize) hold it there
   * instead of undoing the gesture.
   */
  const applyPendingFlushScroll = (): number => {
    const delta = pendingFlushScrollDeltaRef.current;
    if (delta == null) return 0;
    pendingFlushScrollDeltaRef.current = null;
    const el = parentRef.current;
    if (!el) return 0;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const before = el.scrollTop;
    const target = Math.min(max, Math.max(0, before + delta));
    if (target === before) return delta;
    markProgrammatic();
    el.scrollTop = target;
    const applied = el.scrollTop - before;
    if (applied !== 0) {
      // Keep the (already measured) anchor row, at its new offset. Capturing a
      // freshly inserted row instead would pin an estimate: its remeasure then
      // shifts everything below it.
      const anchor = anchorRef.current;
      const now = anchor ? rowOffset(anchor.key) : null;
      if (anchor && now != null) anchorRef.current = { key: anchor.key, offset: now };
      else captureAnchor(null, { ignoreSelection: true });
    }
    return delta - applied;
  };
  const pinFlushViewport = () => {
    atEdgeRef.current = false;
    if (!anchorRef.current) captureAnchor(null, { ignoreSelection: true });
    pinAnchor();
  };
  /**
   * After a metered step landed: top the slice up while the fill slot is still
   * on screen (gesture outran the rows, or every revealed row was filtered
   * out). Returns true when another step was requested.
   */
  const continueRevealIfSlotOpen = (leftover: number, rowsLanded: boolean): boolean => {
    if (!backlogFeedActive()) return false;
    const el = parentRef.current;
    if (!el) return false;
    const overshoot = Math.abs(el.scrollTop - settledEdgeScrollTop());
    if (rowsLanded && !inFillRubberZone() && leftover === 0) return false;
    // Nothing visible came of the last slice: widen it so a filtered backlog
    // does not need one render per row.
    const prevN = revealRef.current?.n ?? 1;
    const n = rowsLanded
      ? revealCountFor(overshoot + Math.abs(leftover))
      : Math.max(1, Math.min(pausedCount, prevN * 2, REVEAL_MAX));
    requestReveal(leftover, n);
    return true;
  };
  useLayoutEffect(() => {
    const rows = telegramRows;
    const prev = prevRowsRef.current;
    const firstKey = rows.length > 0 ? anchorKey(rows[0]) : null;
    const lastKey = rows.length > 0 ? anchorKey(rows[rows.length - 1]) : null;
    prevRowsRef.current = { firstKey, lastKey, len: rows.length };

    const flushing = wasPausedRef.current && !isPaused;
    wasPausedRef.current = !!isPaused;
    const jumpingToLive = jumpToLiveRef.current;
    const pinArmed =
      !jumpingToLive
      && (flushing || flushPinRef.current || pendingFlushScrollDeltaRef.current != null);
    // A metered slice has landed when the backlog shrank since it was asked for.
    const reveal = revealRef.current;
    const revealLanded = reveal != null && pausedCount < reveal.before;
    const finishFlush = () => {
      flushPinRef.current = false;
      revealRef.current = null;
      syncFollowFromNewestVisibility();
      releaseStickySpacerIfFits();
    };

    if (isTimeSort && prev.len === 0 && rows.length > 0 && restoredRef.current) {
      // First rows after the list was emptied (buffer clear): the mount-time
      // restore does not run again, so scrollTop still sits at 0 — inside the
      // fill padding. Settle on the edge telegram when following or jumping,
      // otherwise the spacer stays on screen until the next telegram arrives.
      if (jumpToLiveRef.current || atEdgeRef.current) {
        jumpToLiveRef.current = false;
        atEdgeRef.current = true;
        scrollToEdge();
      }
      return;
    }
    // A display-pin (QF/filter toggle) already restored the preferred row —
    // do not clear that anchor because the live-edge key changed under us.
    if (suppressListRefilterEffectRef.current) {
      suppressListRefilterEffectRef.current = false;
      return;
    }
    // A pressed row stays put while selection drops other rows, even when the
    // live-edge key does not change. Do not jump to the edge during the hold.
    if (clickPinHoldRef.current && rows.length > 0 && isTimeSort) {
      const anchor = anchorRef.current;
      if (anchor && rows.some(r => anchorKey(r) === anchor.key)) {
        pinAnchor();
        return;
      }
    }
    // Non-time sort: keep the topmost row still. Resting spacers are clear
    // and nothing follows the live edge.
    if (displayEdges && !isTimeSort) {
      const hold = fixedTopRef.current;
      const listGrew = prev.len > 0 && (rows.length !== prev.len || firstKey !== prev.firstKey);
      if (listGrew && hold && rows.some(r => anchorKey(r) === hold.key)) {
        atEdgeRef.current = false;
        anchorRef.current = hold;
        pinAnchor();
      } else if (rows.length > 0) {
        const key = hold && rows.some(r => anchorKey(r) === hold.key) ? hold.key : anchorKey(rows[0]);
        const offset = rowOffset(key);
        if (offset != null) fixedTopRef.current = { key, offset };
      }
      return;
    }
    if (!isTimeSort || prev.len === 0 || rows.length === 0) return;

    const edgeKey = liveEdge === 'top' ? firstKey : lastKey;
    const prevEdgeKey = liveEdge === 'top' ? prev.firstKey : prev.lastKey;
    if (!prevEdgeKey || edgeKey === prevEdgeKey) {
      if (jumpingToLive) {
        // The backlog is already published (or there was none): land on the
        // edge and drop the arm. Otherwise wait for the merge.
        if (!isPaused || pausedCount === 0) {
          jumpToLiveRef.current = false;
          atEdgeRef.current = true;
          scrollToEdge();
        }
        return;
      }
      if (pinArmed && revealLanded) {
        // The slice landed but no row of it is visible (all filtered out):
        // ask for the next one, or settle the gesture if the backlog is gone.
        if (continueRevealIfSlotOpen(pendingFlushScrollDeltaRef.current ?? 0, false)) return;
        pinFlushViewport();
        applyPendingFlushScroll();
        finishFlush();
        return;
      }
      if (pinArmed) {
        // Intermediate unpause before rows merge — pin only; keep flush arm.
        pinFlushViewport();
      }
      return;
    }

    let added = -1;
    if (liveEdge === 'top') {
      for (let i = 0; i < rows.length; i++) if (anchorKey(rows[i]) === prevEdgeKey) { added = i; break; }
    } else {
      for (let i = rows.length - 1; i >= 0; i--) if (anchorKey(rows[i]) === prevEdgeKey) { added = rows.length - 1 - i; break; }
    }

    if (added <= 0) {
      // The previous edge row is gone — the list was replaced or refiltered
      // (e.g. Time-Delta-Context switched off). Keep holding the anchor if its
      // row survived (#435); otherwise start over. Zebra parity is tracked on
      // listForcePool, not here.
      const anchor = anchorRef.current;
      if (anchor && rows.some(r => anchorKey(r) === anchor.key)) {
        pinAnchor();
        return;
      }
      if (jumpingToLive) {
        jumpToLiveRef.current = false;
        scrollToEdge();
        return;
      }
      if (oppositeRubberBusy()) {
        return;
      }
      if (pinArmed) {
        pinFlushViewport();
        return;
      }
      anchorRef.current = null;
      onListAnchorKeyChange?.(null);
      return;
    }

    if (jumpingToLive) {
      jumpToLiveRef.current = false;
      atEdgeRef.current = true;
      scrollToEdge();
      return;
    }

    // Opposite rubber always finishes — ahead of pause-flush pin/delta.
    if (oppositeRubberBusy()) {
      return;
    }

    if (pinArmed) {
      // Seamless flush: pin + gesture delta only — never scrollToEdge.
      // Follow only if newest is still fully visible after the delta (user
      // landed on the live edge); a mid-backlog delta must not snap to edge.
      pinFlushViewport();
      const leftover = applyPendingFlushScroll();
      if (revealLanded && continueRevealIfSlotOpen(leftover, true)) return;
      finishFlush();
      return;
    }

    // Live prepend: only show the new row. Leave spacer / rubber / scrollTop alone
    // while overscrolled or mid-animation (no scrollToEdge, pin, or cancel).
    if (rubberAnimRef.current || inFillRubberZone() || inOppositeRubberZone()) {
      return;
    }

    if (atEdgeRef.current) {
      scrollToEdge();
      return;
    }

    pinAnchor();
    // pausedCount: a metered slice may land without changing the row list
    // (every revealed row filtered out) and still needs to be continued.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramRows, isPaused, pausedCount]);

  // Mouseup settles after the list layout has held the clicked row. A gesture
  // that does not change the row list is settled from requestClickPinSettle.
  useLayoutEffect(() => {
    if (!settleClickPinRef.current) return;
    settleClickPinRef.current = false;
    if (clickPinHoldRef.current) pinAnchor();
    clickPinHoldRef.current = false;
    settleClickPinFill();
  });

  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    // Do not fight rubber overscroll / animation when rows remeasure / prepend.
    if (rubberAnimRef.current || inFillRubberBand() || inOppositeRubberZone()) return;
    pinAnchor();
    // Remeasured (shorter) rows can leave the fill slot open again while a
    // backlog waits: fill it rather than showing blank padding. Not before the
    // mount-time restore has placed the viewport (scrollTop is 0 until then).
    if (restoredRef.current && !flushPinRef.current && inFillRubberZone() && backlogFeedActive()) {
      engageLiveTowardNewer(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSize]);

  // The opposite spacer sits above the rows when the live edge is at the
  // bottom: a change in its height (short-list pad, sticky release) shifts
  // every row, so hold the anchor across it.
  useLayoutEffect(() => {
    if (liveEdge !== 'bottom') return;
    if (rubberAnimRef.current || inFillRubberBand() || inOppositeRubberZone()) return;
    pinAnchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppositeSpacerPx]);

  // Manual → auto pause while the fill spacer is on screen: the held spacer
  // becomes the slot for the oldest backlog telegram, which slides in next to
  // the edge row without moving it. The rest stays in the pause buffer and is
  // fed in line by line as the user keeps scrolling toward the live edge.
  const prevManualPauseRef = useRef(isManualPause);
  useLayoutEffect(() => {
    const wasManual = prevManualPauseRef.current;
    prevManualPauseRef.current = isManualPause;
    if (!wasManual || isManualPause) return;
    if (flushPinRef.current || !isTimeSort) return;
    if (!inFillRubberZone() || !backlogFeedActive()) return;
    if (!oppositeRubberBusy()) cancelRubberBand();
    atEdgeRef.current = false;
    armMeteredReveal(0, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManualPause]);

  // Visible columns in order, and the matching CSS grid template.
  // The delta column is always shown when enabled, regardless of sort (#311) —
  // it's computed from the visible row order under any sort hierarchy.
  const visibleCols = useMemo(
    () => columnOrder
      .map(id => COLUMNS.find(c => c.id === id)!)
      .filter(c => !c.visibleKey || visibleColumns[c.visibleKey]),
    [visibleColumns, columnOrder],
  );

  const gridTemplate = useMemo(
    () => visibleCols
      .map((c, i) => {
        const w = widthFor(c.id);
        // Final column absorbs remaining horizontal space.
        return i === visibleCols.length - 1 ? `minmax(${w}px, 1fr)` : `${w}px`;
      })
      .join(' '),
    [visibleCols, widthFor],
  );

  // Multi-level sort indicator (#311): the chevron shows this column's own
  // direction; a small numbered badge additionally marks its position in the
  // hierarchy once more than one level is active (ctrl/cmd-click adds levels).
  const renderSortArrow = (key: SortKey) => {
    const idx = sortConfig.findIndex(l => l.key === key);
    if (idx === -1) return null;
    const icon = sortConfig[idx].direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
    if (sortConfig.length <= 1) return icon;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
        {icon}
        <span
          title={`Sort level ${idx + 1} of ${sortConfig.length}`}
          style={{
            fontSize: '0.6rem', fontWeight: 700, minWidth: '1rem', textAlign: 'center',
            padding: '0 0.2rem', borderRadius: '3px', background: 'var(--bg-tag)', color: 'var(--text-dim)',
          }}
        >
          {idx + 1}
        </span>
      </span>
    );
  };

  const isSameSortKeyValue = useCallback((a: TelegramRow, b: TelegramRow, key: SortKey): boolean => {
    const av = a[key];
    const bv = b[key];
    if (key === 'timestamp') {
      return new Date(av as string).getTime() === new Date(bv as string).getTime();
    }
    return av === bv;
  }, []);

  const shouldHideRepeatedOnSortLevel = useCallback((id: ColId, rowIndex: number, forceShow = false): boolean => {
    if (forceShow || rowIndex <= 0) return false;
    if (id === 'time' || id === 'delta') return false;
    if (!isHideRepeatedWhenSortedEnabled(id)) return false;
    const sortKey = COLUMNS.find(c => c.id === id)?.sortKey;
    if (!sortKey || sortKey === 'timestamp') return false;
    const levelIdx = sortConfig.findIndex(level => level.key === sortKey);
    if (levelIdx === -1) return false;
    const prev = telegramRows[rowIndex - 1];
    const curr = telegramRows[rowIndex];
    if (!prev || !curr) return false;
    for (let i = 0; i <= levelIdx; i++) {
      if (!isSameSortKeyValue(prev, curr, sortConfig[i].key)) return false;
    }
    return true;
  }, [isHideRepeatedWhenSortedEnabled, sortConfig, telegramRows, isSameSortKeyValue]);

  // ── Per-cell body content (keyed switch keeps body aligned with header order) ──
  // Primarily time-sorted: a Read is green when its earliest later Response
  // is at or before the newest telegram in the scrollport. That Response may
  // sit off screen. No visible row means not green. Other sorts trust the buffer.
  const viewportTelegrams = isTimeSort
    ? rowsIntersectingViewport(
      telegramRows,
      virtualizer.getVirtualItems(),
      parentRef.current?.scrollTop ?? 0,
      viewportHeight,
    )
    : telegramRows;

  const projectByGa = useMemo(
    () => projectDptByAddress(projectTargets ?? []),
    [projectTargets],
  );

  const renderCell = (id: ColId, t: TelegramRow, rowIndex: number, forceShow = false): React.ReactNode => {
    if (shouldHideRepeatedOnSortLevel(id, rowIndex, forceShow)) {
      return <div style={cellBox} className="tt-cell filterable-cell" />;
    }
    switch (id) {
      case 'time':
        return (
          <DateTimeFacetPair
            value={t.timestamp}
            withCentiseconds
            allowFocus={false}
            className="tt-cell"
            style={cellBox}
          />
        );

      case 'delta': {
        // + / − slots host per-side context controls (after / before) while QF
        // context is available; otherwise the plain delta glyphs are shown.
        const topSign = (t.deltaStr ?? '')[0];
        const bottomSign = (t.deltaNextStr ?? '')[0];
        let plusOnTop = timeSortDirection === 'asc';
        if (timeSortDirection === 'desc') plusOnTop = false;
        else if (timeSortDirection == null) {
          if (topSign === '+') plusOnTop = true;
          else if (bottomSign === '+') plusOnTop = false;
          else plusOnTop = false;
        }
        // Hide while QF is off, the ΔT column filter is disabled, or
        // Time-Delta-Context is globally off. A side with no quick-filter
        // window has no circle and is not clickable.
        const showContextControls = quickEnabled
          && isQuickColumnEnabled('delta')
          && contextEnabled;
        const rowKey = anchorKey(t);
        const contextBtn = (side: 'before' | 'after') => {
          const sideOn = side === 'before' ? beforeSet.has(rowKey) : afterSet.has(rowKey);
          const sideLabel = side === 'before' ? 'before' : 'after';
          const ringColor = sideOn ? 'var(--accent-primary)' : 'var(--text-dim)';
          const titleCore = sideOn
            ? `${sideLabel.charAt(0).toUpperCase()}${sideLabel.slice(1)} context is shown around this message — click to switch it off (applies to all selected rows).`
            : `Show ${sideLabel} context around this message (applies to all selected rows).`;
          const Icon = side === 'after' ? Plus : Minus;
          return (
            <button
              type="button"
              data-context-flag=""
              data-context-side={side}
              data-context-side-on={sideOn ? 'true' : undefined}
              style={{
                background: 'transparent',
                borderStyle: 'solid',
                borderWidth: 1.5,
                borderColor: ringColor,
                borderRadius: '50%',
                width: 16,
                height: 16,
                cursor: 'pointer',
                padding: 0,
                boxSizing: 'border-box',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: ringColor,
                justifySelf: 'center',
              }}
              title={`${titleCore} Ctrl-click toggles both sides.`}
              // Pin this row. A click inside an existing selection keeps that
              // selection so the side toggle applies to every selected row.
              onMouseDown={e => {
                if (e.button !== 0) return;
                contextButtonPinRef.current(rowKey);
                if (mouseKeyListRef.current.includes(rowKey)) {
                  e.stopPropagation();
                }
              }}
              onClick={e => handleContextSideClick(e, rowKey, side)}
            >
              <Icon size={11} strokeWidth={1.5} />
            </button>
          );
        };
        const lineParts = (text: string) => ({
          sign: text ? text[0] : '',
          value: text.length > 2 ? text.slice(2) : '',
        });
        const top = lineParts(t.deltaStr ?? '');
        const bottom = lineParts(t.deltaNextStr ?? '');
        // Same two tracks as every other cell, so each Δt sits on that line
        // even when an edge row has only one neighbor.
        const deltaValue: React.CSSProperties = {
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
        };
        const plainGlyph = (isPlusSlot: boolean, sign: string, hasValue: boolean) => {
          const glyph = hasValue ? (isPlusSlot ? '+' : (sign === '-' ? '-' : '')) : '';
          return <span style={{ justifySelf: 'center' }}>{glyph}</span>;
        };
        const leading = (isPlusSlot: boolean, sign: string, hasValue: boolean) => {
          if (!showContextControls) return plainGlyph(isPlusSlot, sign, hasValue);
          const side: 'before' | 'after' = isPlusSlot ? 'after' : 'before';
          const sideOn = side === 'before' ? beforeSet.has(rowKey) : afterSet.has(rowKey);
          const qfMs = side === 'before' ? deltaBeforeMs : deltaAfterMs;
          if (qfMs <= 0) return plainGlyph(isPlusSlot, sign, hasValue);
          const btn = contextBtn(side);
          // Edge with no Δt glyph: hide until row hover, unless this side is on.
          if (!hasValue && !sideOn) {
            return <span className="tt-context-edge-slot">{btn}</span>;
          }
          return btn;
        };
        return (
          <div
            className="mono-addr tt-cell"
            style={{
              ...cellBox,
              gridTemplateColumns: '12px 1fr',
              columnGap: '0.35rem',
              fontSize: '0.75rem',
              color: 'var(--text-dim)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {leading(plusOnTop, top.sign, top.value !== '')}
            <span style={deltaValue}>{top.value}</span>
            {leading(!plusOnTop, bottom.sign, bottom.value !== '')}
            <span style={deltaValue}>{bottom.value}</span>
          </div>
        );
      }

      case 'source':
        return (
          <div style={cellBox} className="tt-cell filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div className="mono-addr highlight" style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
                {t.source_address}
              </div>
              <button
                className={`quick-filter-btn ${activeFilters.sources.includes(t.source_address) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('sources', t.source_address); }}
                title="focus device"
              >
                <Search className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
              <button
                className="quick-visualize-btn"
                onClick={(e) => { e.stopPropagation(); onQuickVisualize(t.source_address); }}
                title="visualize this device"
              >
                <LineChart size={14} />
              </button>
              {onQuickLastSeen && (
                <button
                  className="quick-last-seen-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickLastSeen(t.source_address, 'pa'); }}
                  title="show last seen values for this device"
                >
                  <Clock size={12} />
                </button>
              )}
            </div>
            <div className="subtitle-name" title={visibleColumns.sourceName ? (t.source_name || undefined) : undefined} style={SOURCE_NAME_TEXT_STYLE}>
              {visibleColumns.sourceName ? (t.source_name || '-') : '\u00a0'}
            </div>
          </div>
        );

      case 'target':
        return (
          <div style={cellBox} className="tt-cell filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div className="mono-addr highlight-target" style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>
                {t.target_address}
              </div>
              <button
                className={`quick-filter-btn ${activeFilters.targets.includes(t.target_address) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('targets', t.target_address); }}
                title="focus GA"
              >
                <Search className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
              <button
                className="quick-visualize-btn"
                onClick={(e) => { e.stopPropagation(); onQuickVisualize(t.target_address); }}
                title="visualize this GA"
              >
                <LineChart size={14} />
              </button>
              {onQuickLastSeen && (
                <button
                  className="quick-last-seen-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickLastSeen(t.target_address, 'ga'); }}
                  title="show last seen values for this GA"
                >
                  <Clock size={12} />
                </button>
              )}
              {canSend && (
                <SendToGaPopover
                  address={t.target_address}
                  name={t.target_name}
                  dptMain={t.dpt_main}
                  dptSub={t.dpt_sub}
                  triggerId={anchorKey(t)}
                  buttonClassName="quick-send-btn"
                  suppressTriggerFocus
                  onGotoTelegram={onGotoTelegram}
                  latestTelegram={latestTelegram}
                  onAltSend={onAltSend}
                  onCtrlSend={onCtrlSend}
                  panelMatched={Boolean(
                    t.target_address && sendPanelAddresses?.has(t.target_address),
                  )}
                  jobActive={Boolean(
                    t.target_address && activeSendJobAddresses?.has(t.target_address),
                  )}
                  linkedStatus={linkedStatus}
                  onScheduleCommit={onScheduleCommit}
                  onWriteWithSchedule={onWriteWithSchedule}
                  onReadWithSchedule={onReadWithSchedule}
                  onCancelLinked={onCancelLinked}
                  onClearLinked={onClearLinked}
                />
              )}
            </div>
            <div className="subtitle-name" title={visibleColumns.targetName ? (t.target_name || undefined) : undefined} style={SOURCE_NAME_TEXT_STYLE}>
              {visibleColumns.targetName ? (t.target_name || '-') : '\u00a0'}
            </div>
          </div>
        );

      case 'type': {
        const followed = isGroupRead(t)
          ? responseByRead.get(readFollowKey(t))
          : undefined;
        const loadedFollowed = gotoScope === 'history' && isGroupRead(t)
          ? historyLoadedByRead?.get(readFollowKey(t))
          : undefined;
        const candidate = gotoScope === 'history' ? loadedFollowed : followed;
        const responseShown = candidate != null && shownKeySet.has(anchorKey(candidate));
        // Side panel hid the target: no icon, same as a response that was never loaded.
        // READ stays answered (orange). The quick-filter case below is unchanged.
        const spHidden = candidate != null && !responseShown && responseFailsSidePanel(candidate);
        const quickHidden = gotoScope === 'history'
          && loadedFollowed != null
          && !responseShown
          && !spHidden
          && pillQuick != null
          && !pillQuick(loadedFollowed);
        const answered = quickHidden || spHidden
          ? true
          : Boolean(
            followed && (!isTimeSort || readAnsweredByNewestVisible(followed, viewportTelegrams)),
          );
        const readyTarget = quickHidden || spHidden
          ? undefined
          : (followed ?? (responseShown ? loadedFollowed : undefined));
        const showReadyJump = readyTarget != null;
        return (
          <div style={cellBox} className="tt-cell filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, overflow: 'hidden' }}>
              <EventTypeLabel
                kind={t.simplified_type || t.telegram_type || ''}
                answered={answered}
                className={ttTypeClass(t.simplified_type, answered)}
              />
              {showReadyJump && readyTarget && (
                <span onClick={e => e.stopPropagation()}>
                  <TelegramWhenJump
                    timestamp={readyTarget.timestamp}
                    onJump={mods => {
                      if (mods) onGotoTelegram?.(readyTarget, mods);
                      else onGotoTelegram?.(readyTarget);
                    }}
                    jumpLabel="Go to response"
                  />
                </span>
              )}
              {quickHidden && loadedFollowed && (
                <span onClick={e => e.stopPropagation()}>
                  <TelegramWhenJump
                    tone="filtered"
                    onJump={mods => {
                      if (!mods?.additive && !mods?.range) return;
                      filteredJumpSeq.current += 1;
                      setFilteredJump({
                        id: filteredJumpSeq.current,
                        telegram: loadedFollowed,
                        additive: !!mods.additive,
                        range: !!mods.range,
                        preserveFollow: true,
                        allowFill: false,
                      });
                    }}
                  />
                </span>
              )}
              {gotoScope === 'history' && isGroupRead(t) && !showReadyJump && !quickHidden && (
                <TelegramWhenJump reserveJump />
              )}
              <button
                className={`quick-filter-btn ${activeFilters.types.includes(t.simplified_type || t.telegram_type) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('types', t.simplified_type || t.telegram_type); }}
                title="Toggle type filter"
              >
                <Filter className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
            </div>
            <div style={{ fontSize: '0.65rem', color: t.direction === 'Outgoing' ? 'var(--tt-outgoing)' : 'var(--tt-incoming)', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.direction === 'Outgoing' ? 'Outgoing' : 'Incoming'}
            </div>
          </div>
        );
      }

      case 'dpt': {
        const eff = effectiveTelegramDpt(t, projectByGa);
        const dptKey = eff?.key ?? '-';
        const dptDesc = eff
          ? (dptDescriptionLabel(eff.name || null, eff.unit || null) ?? '')
          : '';
        return (
          <div style={cellBox} className="tt-cell filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              {eff != null && (
                <div title={getDPTLabel(eff.main)} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getDPTColor(eff.main), flexShrink: 0 }} />
              )}
              <div
                title={eff?.key}
                style={{ fontSize: '0.75rem', color: 'var(--text-main)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
              >
                {dptKey}
              </div>
            </div>
            <div
              title={dptDesc || undefined}
              style={{ fontSize: '0.68rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {dptDesc || '\u00a0'}
            </div>
          </div>
        );
      }

      case 'value': {
        const eff = effectiveTelegramDpt(t, projectByGa);
        const enriched = enrichTelegramValueDisplay(
          {
            value_formatted: t.value_formatted,
            value_numeric: t.value_numeric,
            value_json: t.value_json ?? null,
            raw_hex: t.raw_hex,
            unit: t.unit,
            raw_data: t.raw_data,
          },
          eff?.key ?? null,
        );
        return (
          <BusValueFacetPair
            value={enriched.value}
            dpt={enriched.dptKey}
            allowDecoded={enriched.allowDecoded}
            allowFocus={false}
            wrapClassName="tt-cell filterable-cell"
            wrapStyle={cellBox}
            style={{
              fontWeight: 700,
              color: 'var(--accent-primary)',
              fontSize: '0.9375rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          />
        );
      }
    }
  };

  // Chips fill their column cell like quick-filter inputs (two rows / column).
  const infoChipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
    width: '100%', minWidth: 0, boxSizing: 'border-box',
    background: 'var(--bg-tag)', border: '1px solid var(--border-subtle)', borderRadius: '4px',
    padding: '0.15rem 0.45rem', fontSize: '0.68rem', color: 'var(--text-dim)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };
  const infoChipBtnStyle: React.CSSProperties = {
    ...infoChipStyle, cursor: 'pointer', background: 'transparent',
  };
  const infoColStyle: React.CSSProperties = {
    padding: '0.35rem 0.5rem', display: 'flex', flexDirection: 'column',
    gap: '0.25rem', minWidth: 0,
  };

  // Anchor pill = filtered rows completely scrolled out toward the anchor.
  // Partial overlap does not count. Backward also adds the filtered pause
  // backlog. This is not the status pill's total; both use the same filtered
  // rows. Without a read direction the count stays the live-edge newer count.
  // `telegramRows` is the on-list set; `visiblePausedCount` is the filtered backlog.
  const virtualItems = virtualizer.getVirtualItems();
  let newerCount: number;
  const rangeMeasured = virtualItems.some(item => item.size > 0);
  const scrollEl = parentRef.current;
  const countEdge = displayEdges ? anchorEdge : liveEdge;
  const pausedForPill = (scrolled: number) => (
    displayEdges && readDirection
      ? anchorEdgeCount(scrolled, visiblePausedCount, readDirection)
      : scrolled + visiblePausedCount
  );
  if (isTimeSort && telegramRows.length > 0) {
    let mergedOut = 0;
    if (rangeMeasured && scrollEl && virtualizer.getTotalSize() > 0) {
      mergedOut = countMergedScrolledOut(
        telegramRows.length,
        countEdge,
        scrollEl.scrollTop,
        scrollEl.clientHeight,
        virtualItems,
        0,
      );
    }
    newerCount = pausedForPill(mergedOut);
  } else {
    // Empty list or a non-time sort: nothing is scrolled out of a time order.
    // Backward still shows the filtered pause backlog.
    newerCount = pausedForPill(0);
  }
  // Across a pause-buffer flush the measured count can briefly drop to 0 —
  // keep sticky only for that unpause frame or while the virtualizer is
  // unmeasured. Show the pill whenever there is a filter-visible backlog,
  // including manual pause while live-follow is still on. Empty list: no
  // sticky phantom after clear; the pause backlog alone may still show arrivals.
  const rawNewerCount = newerCount;
  rawNewerCountRef.current = rawNewerCount;
  const justUnpaused = wasPausedRef.current && !isPaused;
  if (telegramRows.length === 0) {
    stickyNewerCountRef.current = 0;
  } else if (rawNewerCount > 0) {
    stickyNewerCountRef.current = rawNewerCount;
  } else if (followingLive || (rangeMeasured && !justUnpaused)) {
    stickyNewerCountRef.current = 0;
  }
  const displayNewerCount = rawNewerCount > 0
    ? rawNewerCount
    : (telegramRows.length > 0 && (!rangeMeasured || justUnpaused) ? stickyNewerCountRef.current : 0);
  void newerScrollEpoch;
  displayNewerCountRef.current = displayNewerCount;

  // Thumb follows the same newer count as the pill (incl. sticky across flush).
  useLayoutEffect(() => {
    syncOverlayScrollbar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayNewerCount]);

  // Escape clears the mouse selection and drops OS focus (e.g. colour-swatch ring)
  // while focus is inside the table (not in an input). Ctrl/Cmd+A selects every
  // visible row into the mouse selection and must not select text.
  const tableRootRef = useRef<HTMLDivElement>(null);
  const handleTableKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    // The toolbar (buffer pill, filter toggle) keeps its own keys. Escape and
    // ctrl/cmd-A must not clear or select table rows from those controls.
    if (target?.closest('[data-tt-header], input, textarea, select, [contenteditable="true"]')) return;

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
      const ae = document.activeElement as HTMLElement | null;
      const focusInside = !!(ae && tableRootRef.current?.contains(ae));
      if (!focusInside) return;
      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
      const keys = telegramRows.map(r => anchorKey(r));
      setMouseKeyList(soleKeys(keys));
      const keep = lastSelected && keys.includes(lastSelected) ? lastSelected : (keys[0] ?? null);
      setLastSelected(keep);
      return;
    }

    if (e.key !== 'Escape') return;

    const hadSelection = mouseKeyList.length > 0;
    const ae = document.activeElement as HTMLElement | null;
    const focusInside = !!(ae && tableRootRef.current?.contains(ae));
    if (!hadSelection && !focusInside) return;

    e.preventDefault();
    e.stopPropagation();
    if (hadSelection) {
      setMouseKeyList(soleKeys([]));
      setLastSelected(null);
    }
    // Park focus on the outline-less table root so the OS focus ring disappears
    // but Escape stays available for further clears.
    if (focusInside && ae !== tableRootRef.current) {
      ae.blur();
      tableRootRef.current?.focus({ preventScroll: true });
    }
  };

  // Ctrl/Cmd+A's text selection is a selectstart default action. React's
  // keydown preventDefault does not cancel it; a capture listener does.
  useEffect(() => {
    let blockTextSelect = false;
    const inTable = (target: EventTarget | null) => {
      const root = tableRootRef.current;
      const node = target instanceof Node ? target : null;
      const el = node instanceof Element ? node : node?.parentElement ?? null;
      const focused = document.activeElement;
      const host = el && root?.contains(el) ? el : (focused instanceof Element && root?.contains(focused) ? focused : null);
      if (!host || !root) return false;
      return !host.closest('input, textarea, select, [contenteditable="true"]');
    };
    const isSelectAll = (e: KeyboardEvent) =>
      (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a';
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSelectAll(e) || !inTable(e.target)) return;
      blockTextSelect = true;
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    };
    const onSelectStart = (e: Event) => {
      if (!blockTextSelect || !inTable(e.target)) return;
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!blockTextSelect) return;
      if (e.key.toLowerCase() === 'a' || (!e.ctrlKey && !e.metaKey)) blockTextSelect = false;
      window.getSelection()?.removeAllRanges();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectstart', onSelectStart, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('selectstart', onSelectStart, true);
      document.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  const captureListScroll = useCallback((): ListScrollSnapshot | null => {
    const el = parentRef.current;
    if (!el) return null;
    const key = anchorRef.current?.key ?? selectedKeyRef.current ?? null;
    const offset = key != null ? (rowOffset(key) ?? 0) : 0;
    if (key != null && anchorRef.current?.key !== key) {
      anchorRef.current = { key, offset };
      anchorRowsRef.current = telegramRowsRef.current;
    }
    return { scrollTop: el.scrollTop, key, offset };
  }, []);

  const restoreListScroll = useCallback((snap: ListScrollSnapshot) => {
    const el = parentRef.current;
    if (!el) return;
    if (snap.key) {
      anchorRef.current = { key: snap.key, offset: snap.offset };
      anchorRowsRef.current = telegramRowsRef.current;
      atEdgeRef.current = false;
      detachedFromEdgeRef.current = true;
      setFollowingLive(false);
      onListFollowChange?.(false);
      pinAnchor();
      return;
    }
    markProgrammatic();
    el.scrollTop = snap.scrollTop;
  }, [onListFollowChange]);

  return (
    <SendToGaHost
      latestTelegram={latestTelegram}
      onGotoTelegram={onGotoTelegram}
      linkedStatus={linkedStatus}
      gaJobStatuses={gaJobStatuses}
      onScheduleCommit={onScheduleCommit}
      onWriteWithSchedule={onWriteWithSchedule}
      onReadWithSchedule={onReadWithSchedule}
      onCancelLinked={onCancelLinked}
      onClearLinked={onClearLinked}
      onAltSend={onAltSend}
      onCtrlSend={onCtrlSend}
      captureListScroll={captureListScroll}
      restoreListScroll={restoreListScroll}
    >
    <div
      ref={tableRootRef}
      data-telegram-table=""
      tabIndex={-1}
      onKeyDown={handleTableKeyDown}
      onPointerDown={e => {
        // Keep the table keyboard-focusable for Escape without stealing focus from form controls.
        const t = e.target as HTMLElement | null;
        if (t?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
        tableRootRef.current?.focus({ preventScroll: true });
      }}
      className={noMainFilter ? undefined : 'tt-sp-active'}
      data-sp-active={noMainFilter ? 'false' : 'true'}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        outline: 'none',
      }}
    >
      <div
        data-tt-chrome=""
        style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}
      >
      {(headerLeading != null || headerCenter != null) && (
        <div
          data-tt-header=""
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.4rem 0.75rem',
            flexShrink: 0,
            minWidth: 0,
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          {/* Equal flex sides keep headerCenter on the bar's midpoint.
              min-content on the leading side stops the filter toggle from collapsing;
              a narrow bar wraps the center onto its own row instead of overlapping. */}
          <div
            data-tt-header-leading=""
            style={{
              flex: '1 1 0',
              minWidth: headerLeading != null ? 'min-content' : 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
            }}
          >
            {headerLeading}
          </div>
          <div
            data-tt-header-center=""
            style={{
              flex: '0 1 auto',
              minWidth: 0,
              maxWidth: '100%',
              display: 'flex',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            {headerCenter}
          </div>
          <div data-tt-header-trailing="" style={{ flex: '1 1 0', minWidth: 0 }} />
        </div>
      )}
      {/* Quick info bar (#311): same column grid as the quick filter — two rows
          per column (oldest/newest, min/max Δt, counts, …). */}
      {infoOpen && infoMetrics && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-panel)', flexShrink: 0 }}>
          <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
              <button
                className="quick-filter-bar-toggle open"
                onClick={toggleInfoOpen}
                title="Hide info bar"
              >
                <ChevronDown size={13} />
              </button>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              paddingRight: '8px',
            }}
          >
          {visibleCols.map(c => {
            if (c.id === 'time') {
              // Oldest/newest buffer bounds + fill live in the header status pill.
              return <div key={c.id} style={infoColStyle} />;
            }
            if (c.id === 'delta') {
              return (
                <div key={c.id} style={infoColStyle}>
                  {infoMetrics.minDeltaIdx !== -1 ? (
                    <button
                      style={infoChipBtnStyle} title="Jump to the smallest time gap in the current view"
                      onClick={() => gotoIndex(infoMetrics.minDeltaIdx)}
                    >
                      Min Δt: {telegramRows[infoMetrics.minDeltaIdx].deltaStr}
                    </button>
                  ) : <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>}
                  {infoMetrics.maxDeltaIdx !== -1 ? (
                    <button
                      style={infoChipBtnStyle} title="Jump to the largest time gap in the current view"
                      onClick={() => gotoIndex(infoMetrics.maxDeltaIdx)}
                    >
                      Max Δt: {telegramRows[infoMetrics.maxDeltaIdx].deltaStr}
                    </button>
                  ) : <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>}
                </div>
              );
            }
            if (c.id === 'source') {
              return (
                <div key={c.id} style={infoColStyle}>
                  <span style={infoChipStyle}>{infoMetrics.sourceCount} source{infoMetrics.sourceCount !== 1 ? 's' : ''}</span>
                  <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>
                </div>
              );
            }
            if (c.id === 'target') {
              return (
                <div key={c.id} style={infoColStyle}>
                  <span style={infoChipStyle}>{infoMetrics.targetCount} target{infoMetrics.targetCount !== 1 ? 's' : ''}</span>
                  <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>
                </div>
              );
            }
            if (c.id === 'type') {
              const types = infoMetrics.typeCounts;
              const allTitle = types.map(([t, n]) => `${t}: ${n}`).join(', ') || undefined;
              const top = types[0];
              const bottom = types[1];
              return (
                <div key={c.id} style={infoColStyle}>
                  {top
                    ? <span style={infoChipStyle} title={allTitle}>{top[0]}: {top[1]}</span>
                    : <span style={infoChipStyle}>0 types</span>}
                  {bottom
                    ? (
                      <span style={infoChipStyle} title={allTitle}>
                        {bottom[0]}: {bottom[1]}{types.length > 2 ? ` +${types.length - 2}` : ''}
                      </span>
                    )
                    : <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>}
                </div>
              );
            }
            if (c.id === 'dpt') {
              return (
                <div key={c.id} style={infoColStyle}>
                  <span style={infoChipStyle}>{infoMetrics.dptCount} DPT{infoMetrics.dptCount !== 1 ? 's' : ''}</span>
                  <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>
                </div>
              );
            }
            return (
              <div key={c.id} style={infoColStyle}>
                <span
                  style={infoChipStyle}
                  title={infoMetrics.contextCount > 0
                    ? 'Rows shown only as unfiltered Time-Delta-Context, not real filter matches (#343)'
                    : undefined}
                >
                  {infoMetrics.count} telegram{infoMetrics.count !== 1 ? 's' : ''}
                  {infoMetrics.contextCount > 0 ? ` · ${infoMetrics.contextCount} context` : ''}
                </span>
                {infoMetrics.count > 0 ? (
                  <div style={{ display: 'flex', gap: '0.25rem', minWidth: 0 }}>
                    {infoMetrics.peak && (
                      <button
                        style={{ ...infoChipBtnStyle, width: 'auto', flex: 1 }}
                        title="Most telegrams within one second in the current view — jump to the start of that burst"
                        onClick={() => gotoIndex(infoMetrics.peak!.startIdx)}
                      >
                        Max rate: {infoMetrics.peak.count}/s
                      </button>
                    )}
                    <button
                      style={{ ...infoChipBtnStyle, width: infoMetrics.peak ? 'auto' : '100%', flex: infoMetrics.peak ? undefined : 1 }}
                      title="Download the telegrams in the current view (all filters applied, in list order) as CSV"
                      onClick={() => downloadTelegramsCsv(telegramRows)}
                    >
                      <Download size={11} /> CSV
                    </button>
                  </div>
                ) : (
                  <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          background: 'var(--bg-tag)',
          zIndex: 10,
          backdropFilter: 'var(--glass-blur)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        {/* Left icon rail: show info / GotoTime / quick filter */}
        <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: '0.15rem' }}>
            {showInfoBarToggle && (
              <button
                className="quick-filter-bar-toggle"
                onClick={toggleInfoOpen}
                title="Show info bar"
              >
                <ChevronUp size={13} />
              </button>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isTimeSort && (
              <GotoTimeControl
                seedMs={newestMs}
                oldestMs={bufferOldestMs}
                newestMs={bufferNewestMs}
                scope={gotoScope}
                onGoto={(ms, mods) => gotoTime(ms, {
                  allowFill: mods?.load === true,
                  additive: !!mods?.additive,
                })}
              />
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            {quickOpen ? (
              <button
                className={`quick-filter-bar-toggle ${quickEnabled ? 'open' : ''}`}
                onClick={handleQuickEnabledToggleClick}
                title={quickEnabled
                  ? 'Disable quick filter (keeps patterns) · ctrl/cmd-click clears all quick-filter cells'
                  : 'Enable quick filter · ctrl/cmd-click clears all quick-filter cells'}
              >
                <Filter size={13} />
              </button>
            ) : (
              <button
                className="quick-filter-bar-toggle"
                onClick={toggleQuickOpen}
                title="Show quick filter bar"
              >
                <ChevronDown size={13} />
              </button>
            )}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'grid',
            gridTemplateColumns: gridTemplate,
            color: 'var(--text-main)',
            fontSize: '0.65rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 700,
            paddingRight: '8px',
          }}
        >
        {visibleCols.map((c, i) => (
          <div
            key={c.id}
            className={`header-col${draggingColumn === c.id ? ' drag-source' : ''}${dropTarget?.id === c.id ? ` drop-${dropTarget.side}` : ''}`}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}
            draggable
            onMouseDownCapture={e => { dragOriginRef.current = e.target; }}
            onDragStart={e => {
              const origin = dragOriginRef.current;
              if (origin instanceof Element && origin.closest('input, textarea, select, .col-resize-handle')) {
                e.preventDefault();
                return;
              }
              setDraggingColumn(c.id);
              e.dataTransfer.setData('text/plain', c.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={e => {
              if (!draggingColumn || draggingColumn === c.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              const side = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
              if (dropTarget?.id !== c.id || dropTarget.side !== side) setDropTarget({ id: c.id, side });
            }}
            onDrop={e => {
              e.preventDefault();
              dropColumn(c.id, dropTarget?.id === c.id ? dropTarget.side : 'before');
            }}
            onDragEnd={endColumnDrag}
          >
            <div style={{ flex: 1, minHeight: '1.3rem', padding: '0 1rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.4rem' }}>
              {c.id === 'delta' && quickEnabled
                && isQuickColumnEnabled('delta')
                && contextEnabled
                && (deltaBeforeMs > 0 || deltaAfterMs > 0) && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {deltaBeforeMs > 0 && (
                    <ContextSideHeaderToggle
                      side="before"
                      state={beforeFlagState}
                      onClick={e => handleHeaderSideClick('before', e)}
                    />
                  )}
                  {deltaAfterMs > 0 && (
                    <ContextSideHeaderToggle
                      side="after"
                      state={afterFlagState}
                      onClick={e => handleHeaderSideClick('after', e)}
                    />
                  )}
                </span>
              )}
              {(c.id === 'source' || c.id === 'target') && (() => {
                const focusChecked = c.id === 'source' ? sourceFocusOnly : targetFocusOnly;
                const focusCategory = c.id === 'source' ? 'pa' : 'ga';
                return (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: focusFilterDisabled ? 0.4 : 1 }}>
                    <span
                      onClick={e => {
                        e.stopPropagation();
                        if (focusFilterDisabled) return;
                        if (c.id === 'source') setSourceFocusOnly(!sourceFocusOnly);
                        else setTargetFocusOnly(!targetFocusOnly);
                        requestDisplayPinRef.current();
                      }}
                      title={c.id === 'source'
                        ? 'Show only telegrams whose source is flagged for the Telegram List in the Focus panel'
                        : 'Show only telegrams whose target is flagged for the Telegram List in the Focus panel'}
                      style={{
                        display: 'flex', alignItems: 'center', userSelect: 'none',
                        cursor: focusFilterDisabled ? 'default' : 'pointer',
                        color: focusChecked ? 'var(--accent-primary)' : 'var(--text-dim)',
                      }}
                    >
                      <List size={12} />
                    </span>
                    <span
                      onClick={e => {
                        e.stopPropagation();
                        onFocusCategorySelect?.(focusCategory);
                      }}
                      title={c.id === 'source'
                        ? 'Switch the Focus panel to Devices'
                        : 'Switch the Focus panel to Group Addresses'}
                      style={{
                        fontWeight: 400, fontSize: '0.68rem', color: 'var(--text-dim)',
                        textTransform: 'none', letterSpacing: 'normal', userSelect: 'none',
                        cursor: onFocusCategorySelect ? 'pointer' : 'default',
                      }}
                    >
                      focus
                    </span>
                  </span>
                );
              })()}
            </div>
            <div style={{ flex: 1, minHeight: '1.3rem', padding: '0 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {c.id === 'delta' ? (
                <button
                  className="sort-header"
                  onClick={handleDeltaHeaderClick}
                  title={deltaSortActive
                    ? 'Sorted by time delta — click to flip direction; click any other column to return to live order'
                    : 'Sort by time delta (exclusive — pauses live scrolling and freezes the current order)'}
                >
                  {c.label} {deltaSortActive && (deltaSortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                </button>
              ) : c.sortKey ? (
                <button
                  className="sort-header"
                  onClick={(e) => {
                    if (e.altKey && c.id !== 'time' && c.id !== 'delta') {
                      e.preventDefault();
                      toggleHideRepeatedWhenSortedForColumn(c.id);
                      return;
                    }
                    handleColumnSort(c.sortKey!, { additive: e.ctrlKey || e.metaKey });
                  }}
                  title="Click to sort · ctrl/cmd-click to add as a further sort level (TIME is always the deepest tiebreaker) · alt-click toggles repeated-value hiding"
                >
                  {c.label} {renderSortArrow(c.sortKey)}
                </button>
              ) : (
                <span>{c.label}</span>
              )}
            </div>
            <div style={{ flex: 1, minHeight: '1.3rem', padding: '0 1rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start', gap: '0.4rem' }}>
              {quickOpen && quickEnabled && (() => {
                const deltaWindowSet = qfBeforeMs > 0 || qfAfterMs > 0;
                const toggleOpen = c.id === 'delta'
                  ? isQuickColumnEnabled(c.id) && deltaWindowSet
                  : isQuickColumnEnabled(c.id);
                return (
                <button
                  className={`quick-filter-bar-toggle ${toggleOpen ? 'open' : ''}`}
                  onClick={(e) => handleQuickColumnToggleClick(e, c.id)}
                  title={c.id === 'delta'
                    ? (activeFilters.deltaContextEnabled
                      ? 'Time-Delta-Context: on · ctrl/cmd-click disables the window (keeps values)'
                      : 'Time-Delta-Context: off · ctrl/cmd-click enables the window')
                    : isQuickColumnEnabled(c.id)
                      ? `Disable quick filter for ${c.label} · ctrl/cmd-click clears this column's quick-filter cells`
                      : `Enable quick filter for ${c.label} · ctrl/cmd-click clears this column's quick-filter cells`}
                >
                  <Filter size={12} />
                </button>
                );
              })()}
            </div>
            {i < visibleCols.length - 1 && (
              <div
                className="col-resize-handle"
                onMouseDown={(e) => handleResizeStart(e, c)}
                onDoubleClick={() => handleResetWidth(c)}
                title="Drag to resize · double-click to reset"
              />
            )}
          </div>
        ))}
        </div>
      </div>

      {/* Quick filter bar (#271, #309) — two rows per column.
          Cells stay editable even when a column or the bar is toggled off;
          only filtering is paused. The hide toggle stays full-strength.
          Bottom rule: dark when disabled, gray when on but empty, orange when filtering. */}
      {quickOpen && (
        <div
          className={`quick-filter-bar${!quickEnabled ? '' : pillQuick ? ' filtering' : ' idle'}`}
          data-qf-bar-status={!quickEnabled ? 'inactive' : pillQuick ? 'filtering' : 'idle'}
          style={{ display: 'flex', background: 'var(--bg-panel)', flexShrink: 0 }}
        >
          <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <button
                className="quick-filter-bar-toggle open"
                onClick={toggleQuickOpen}
                title="Hide quick filter bar"
              >
                <ChevronUp size={13} />
              </button>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              paddingRight: '8px',
            }}
          >
          {visibleCols.map(c => (
            <div key={c.id} style={{
              padding: '0.35rem 0.5rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.35rem',
              minWidth: 0,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0, flex: 1 }}>
                {c.id === 'delta' ? (
                  <>
                    <DurationField
                      col="qf-delta"
                      placeholder="before"
                      unit="ms"
                      value={qfBeforeMs > 0 ? String(qfBeforeMs) : ''}
                      ariaLabel="Time-Delta-Context before (ms)"
                      title="Context before"
                      onChange={v => {
                        const n = v.trim() === '' ? 0 : Number(v);
                        if (!Number.isFinite(n) || n < 0) return;
                        setDeltaContextCell(Math.floor(n), qfAfterMs);
                      }}
                      onBlur={sanitized => {
                        const n = sanitized === '' ? 0 : Number(sanitized);
                        const before = Number.isFinite(n) ? n : 0;
                        if (qfExplicit == null && before === qfBeforeMs) return;
                        setDeltaContextCell(before, qfAfterMs);
                      }}
                    />
                    <DurationField
                      col="qf-delta"
                      placeholder="after"
                      unit="ms"
                      value={qfAfterMs > 0 ? String(qfAfterMs) : ''}
                      ariaLabel="Time-Delta-Context after (ms)"
                      title="Context after"
                      onChange={v => {
                        const n = v.trim() === '' ? 0 : Number(v);
                        if (!Number.isFinite(n) || n < 0) return;
                        setDeltaContextCell(qfBeforeMs, Math.floor(n));
                      }}
                      onBlur={sanitized => {
                        const n = sanitized === '' ? 0 : Number(sanitized);
                        const after = Number.isFinite(n) ? n : 0;
                        if (qfExplicit == null && after === qfAfterMs) return;
                        setDeltaContextCell(qfBeforeMs, after);
                      }}
                    />
                  </>
                ) : c.id === 'type' ? (
                  <>
                    <input
                      className={qfInputClass(currentPatterns.type?.top ?? '')}
                      type="text"
                      value={currentPatterns.type?.top ?? ''}
                      placeholder="type regex…"
                      aria-label="Quick filter TYPE"
                      onChange={e => setQuickCell('type', 'top', e.target.value)}
                    />
                    <input
                      className={qfInputClass(currentPatterns.type?.bottom ?? '')}
                      type="text"
                      value={currentPatterns.type?.bottom ?? ''}
                      placeholder="direction regex…"
                      aria-label="Quick filter TYPE direction"
                      onChange={e => setQuickCell('type', 'bottom', e.target.value)}
                    />
                  </>
                ) : c.id === 'time' ? (
                  <>
                    <ThemedDatetimePicker
                      className={qfInputClass(currentPatterns.time?.top ?? '')}
                      value={currentPatterns.time?.top ?? ''}
                      aria-label="Quick filter TIME from"
                      withSeconds
                      onChange={v => setQuickCell('time', 'top', v)}
                    />
                    <ThemedDatetimePicker
                      className={qfInputClass(currentPatterns.time?.bottom ?? '')}
                      value={currentPatterns.time?.bottom ?? ''}
                      aria-label="Quick filter TIME to"
                      withSeconds
                      onChange={v => setQuickCell('time', 'bottom', v)}
                    />
                  </>
                ) : c.id === 'value' ? (
                  <>
                    <input
                      className={qfInputClass(currentPatterns.value?.top ?? '')}
                      type="text"
                      value={currentPatterns.value?.top ?? ''}
                      placeholder={'from / 0x.. / 0b.. / "regex"'}
                      aria-label="Quick filter VALUE from"
                      onChange={e => setQuickCell('value', 'top', e.target.value)}
                    />
                    <input
                      className={qfInputClass(currentPatterns.value?.bottom ?? '')}
                      type="text"
                      value={currentPatterns.value?.bottom ?? ''}
                      placeholder="to / pattern…"
                      aria-label="Quick filter VALUE to"
                      onChange={e => setQuickCell('value', 'bottom', e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <input
                      className={qfInputClass(currentPatterns[c.id]?.top ?? '')}
                      type="text"
                      value={currentPatterns[c.id]?.top ?? ''}
                      placeholder={c.id === 'dpt' ? '1.008-1.011, 16.*' : c.id === 'source' ? '*.1.*, 1.2.12-1.2.91' : '1/5/*, 3/1/1-3/1/127'}
                      aria-label={`Quick filter ${c.label} pattern`}
                      onChange={e => setQuickCell(c.id, 'top', e.target.value)}
                    />
                    <input
                      className={qfInputClass(currentPatterns[c.id]?.bottom ?? '')}
                      type="text"
                      value={currentPatterns[c.id]?.bottom ?? ''}
                      placeholder={c.id === 'dpt' ? 'description regex…' : 'name regex…'}
                      aria-label={`Quick filter ${c.label} name`}
                      onChange={e => setQuickCell(c.id, 'bottom', e.target.value)}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
          </div>
        </div>
      )}
      </div>

      {/* Body area — relative wrapper so the jump-to-live pill (#202) anchors
          below the header, not over it. */}
      <div
        data-tt-body=""
        style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
      {!noMainFilter && (
        <div
          data-tt-sp-bar=""
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            top: 0,
            width: 1,
            background: 'var(--warning)',
            pointerEvents: 'none',
            zIndex: 11,
          }}
        />
      )}

      {/* Anchor-end pill, on the side where the anchor sits in the current
          time sort. Backward: "N newer" (scrolled-out rows + pause backlog).
          Forward: "N older" (scrolled-out rows only). The click scrolls to the
          anchor. Count 0 hides it. Without a read direction this stays the
          live-edge newer pill. */}
      {(displayEdges ? displayNewerCount > 0 : liveFollow && isTimeSort && displayNewerCount > 0) && (() => {
        const edgeWord = displayEdges && readDirection === 'forward' ? 'older' : 'newer';
        const pillEdge = displayEdges ? (isTimeSort ? anchorEdge : 'top') : liveEdge;
        const edgeLabel = displayNewerCount === 1
          ? `${edgeWord} telegram`
          : `${edgeWord} telegrams`;
        return (
          <button
            onClick={e => {
              if (displayEdges && readDirection === 'forward') {
                scrollToAnchor();
                return;
              }
              jumpToLive(e.ctrlKey, !e.ctrlKey);
            }}
            className="jump-to-live-pill"
            data-jump-to-live-pill=""
            data-edge-kind={edgeWord}
            ref={attachPillWheel}
            data-edge={pillEdge}
            aria-label={`${displayNewerCount.toLocaleString()} ${edgeLabel}`}
            style={{
              position: 'absolute', left: '50%', zIndex: 20,
              ...(pillEdge === 'top'
                ? { top: EDGE_PILL_CENTER, transform: 'translate(-50%, -50%)' }
                : { bottom: EDGE_PILL_CENTER, transform: 'translate(-50%, 50%)' }),
            }}
            title={readDirection === 'forward'
              ? 'Scroll back to the anchor'
              : isManualPause
                ? 'Jump to the newest telegram. Ctrl-click resumes.'
                : 'Jump back to the live edge'}
          >
            {pillEdge === 'top' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {displayNewerCount.toLocaleString()} {edgeLabel}
          </button>
        );
      })()}

      {/* One pause label in the outer band of the newer pill: above it when
          the newest row is at the top, below it when the newest row is at
          the bottom. Only while manually paused and the fill rubber is fully
          on screen. */}
      {showFillPauseLabels && fillRubberPx > 0 && (
        <div
          key={fillPauseFadeKey}
          aria-hidden
          className="fill-rubber-pause-label"
          data-testid="fill-rubber-pause-label"
          data-edge={liveEdge}
          style={{
            left: '50%',
            transform: 'translateX(-50%)',
            height: EDGE_PILL_INSET,
            zIndex: 19,
            ...(liveEdge === 'top' ? { top: 0 } : { bottom: 0 }),
          }}
        >
          ...paused manually...
        </div>
      )}

      {/* Marks pill — visible marks (top) and hidden rows (bottom) when present.
          Vertically centered on the same edge band as the newer pill (1- and 2-line).
          Pointer events stay on the pill so the row underneath is never selected. */}
      {(actionableMarkedKeys.length > 0 || hiddenKeyList.length > 0) && (
        <div
          className="marks-pill"
          data-marks-pill=""
          ref={attachPillWheel}
          style={{
            position: 'absolute',
            right: EDGE_PILL_INSET,
            top: EDGE_PILL_CENTER,
            transform: 'translateY(-50%)',
            zIndex: 20,
          }}
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={e => e.stopPropagation()}
        >
          {actionableMarkedKeys.length > 0 && (
            <div className="marks-pill-row">
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  if (!canJumpMarkPrev) return;
                  jumpToMark(-1);
                }}
                aria-disabled={!canJumpMarkPrev}
                title="Jump to previous mark"
              >
                <ChevronUp size={14} />
              </button>
              {!twoLineMarksPill && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    if (!canJumpMarkNext) return;
                    jumpToMark(1);
                  }}
                  aria-disabled={!canJumpMarkNext}
                  title="Jump to next mark"
                >
                  <ChevronDown size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  if (e.ctrlKey || e.metaKey) {
                    hideMarkedRows();
                    return;
                  }
                  clearMarks();
                }}
                className="marks-pill-clear"
                title="Clear all marks"
              >
                <X size={13} /> Clear {actionableMarkedKeys.length} mark{actionableMarkedKeys.length === 1 ? '' : 's'}
              </button>
            </div>
          )}
          {hiddenKeyList.length > 0 && (
            <div className="marks-pill-row">
              {!twoLineMarksPill && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    if (!canJumpMarkPrev) return;
                    jumpToMark(-1);
                  }}
                  aria-disabled={!canJumpMarkPrev}
                  title="Jump to previous mark"
                >
                  <ChevronUp size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  if (!canJumpMarkNext) return;
                  jumpToMark(1);
                }}
                aria-disabled={!canJumpMarkNext}
                title="Jump to next mark"
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  if (e.ctrlKey || e.metaKey) {
                    toggleAllRowHidden();
                    return;
                  }
                  showHiddenRows();
                }}
                className="marks-pill-clear"
                title="Show hidden rows. Ctrl-click toggles hide on every row."
              >
                <X size={13} /> Show {hiddenKeyList.length} hidden
              </button>
            </div>
          )}
        </div>
      )}

      {/* Virtualized Body */}
      <div
        ref={parentRef}
        data-telegram-scroll=""
        data-anchor-px={displayPlan ? displayPlan.anchorPx : undefined}
        data-reading-px={displayPlan ? displayPlan.readingPx : undefined}
        data-anchor-edge={displayPlan ? anchorEdge : undefined}
        onScroll={handleScroll}
        onWheel={e => handleScrollGesture(e.deltaY)}
        onTouchMove={noteUserScroll}
        // A press on the container itself (not on a row) is the scrollbar.
        onPointerDown={e => {
          if (e.target !== e.currentTarget) return;
          scrollbarHeldRef.current = true;
          lockScrollGeometry();
        }}
        // overflow-anchor off: we compensate scrollTop manually on prepend (#202),
        // so the browser's native anchoring must not also move the viewport.
        // paddingRight reserves space for the visual overlay scrollbar track.
        style={{
          flex: 1,
          overflowY: 'auto',
          position: 'relative',
          overflowAnchor: 'none',
          paddingRight: LIST_SB_WIDTH_PX,
        }}
        className="custom-scrollbar"
      >
        {telegramRows.length === 0 ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
            No data available.
          </div>
        ) : (
          <>
            {/* Opposite short-list travel sits outside the virtualizer; fill rubber is paddingStart/End.
                Display mode puts the anchor rubber or the reading block on that side. */}
            {displayPlan && readingIsLive && readingEdge === 'top' && (
              <ReadingSpacer
                height={readingBlockPx}
                markerPx={displayPlan.markerPx}
                markerAt="end"
                label={READING_END_LABEL[readingEnd ?? 'data']}
              />
            )}
            {liveEdge === 'bottom' && oppositeSpacerPx > 0 && (
              displayPlan
                ? (readingIsLive
                  ? <div data-testid="anchor-spacer" aria-hidden style={{ height: oppositeSpacerPx, width: '100%' }} />
                  : (
                    <ReadingSpacer
                      height={oppositeSpacerPx}
                      markerPx={displayPlan.markerPx}
                      markerAt="end"
                      label={READING_END_LABEL[readingEnd ?? 'data']}
                    />
                  ))
                : <div aria-hidden style={{ height: `${oppositeSpacerPx}px`, width: '100%' }} />
            )}
            <div
              ref={listContentRef}
              style={{
                height: `${virtTotalPx}px`,
                width: '100%',
                position: 'relative'
              }}
            >
            {(() => {
              const virtualItems = virtualizer.getVirtualItems();
              const firstVisibleRowIndex = virtualItems[0]?.index ?? -1;
              return virtualItems.map((virtualRow) => {
              const t = telegramRows[virtualRow.index];
              const key = anchorKey(t);
              // Row wash follows the mouse-selection flag. The marked flag fills the rail.
              const mouseSelected = mouseKeySet.has(key);
              const rowMarked = markedKeySet.has(key);
              const inContext = !!contextKeys?.has(key);
              const latest = mouseSelected && key === lastSelected;
              // Context wash stays for every row whose context flag is set.
              const isContext = !mouseSelected && inContext;
              const railSigns = inContext
                ? contextRailSigns(timeMs(t.timestamp), selectedParentTimes(key))
                : { before: false, after: false };
              // Row colour index (if set) takes precedence over address-based colours.
              const markColor = markColorFromIndex(markColorIndices[key]);
              const targetColor = markColor ?? activeTargetColors[t.target_address];
              const railTitle = rowMarked ? 'Unmark this message' : 'Mark this message';
              // Rail fill follows the marked flag: colour when set, else context
              // wash, else the latest wash on the last-selected row.
              const railBackground = !rowMarked
                ? undefined
                : markColor
                  ? `color-mix(in srgb, ${markColor} 34%, transparent)`
                  : inContext
                    ? CONTEXT_WASH
                    : latest
                      ? MOUSE_LATEST_WASH
                      : MOUSE_SELECTED_WASH;
              const poolIndex = stripeIndexByKey.get(key);
              const zebra = ((poolIndex ?? virtualRow.index) + stripeOffset) % 2 === 0
                ? 'var(--bg-subtle)'
                : 'transparent';
              const rowWash = latest
                ? MOUSE_LATEST_WASH
                : mouseSelected
                  ? MOUSE_SELECTED_WASH
                  : isContext
                    ? CONTEXT_WASH
                    : targetColor
                      ? `color-mix(in srgb, ${targetColor} 9%, transparent)`
                      : zebra;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  data-akey={key}
                  onMouseDown={e => handleMarkMouseDown(e, key, virtualRow.index)}
                  onClick={e => handleMarkClick(e, key, virtualRow.index)}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                    display: 'flex',
                    borderBottom: '1px solid var(--border-color)',
                    fontSize: '0.8125rem',
                    background: zebra,
                    alignItems: 'start',
                    userSelect: 'text',
                  }}
                  title={inContext ? 'Unfiltered Time-Delta-Context — this telegram did not match the active filters' : undefined}
                  className={`log-row${mouseSelected ? ' marked' : ''}${latest ? ' latest' : ''}${isContext ? ' context' : ''}${rowFlash?.key === key ? ' row-flash' : ''}`}
                  data-flash-gen={rowFlash?.key === key ? rowFlash.gen : undefined}
                  onAnimationEnd={e => {
                    if (e.animationName !== 'row-flash-fade') return;
                    if (e.target !== e.currentTarget) return;
                    setRowFlash(prev => (prev?.key === key ? null : prev));
                  }}
                >
                  {/* Rail: click anywhere to mark; colour swatch also cycles colour. */}
                  <div
                    role="button"
                    tabIndex={0}
                    title={railTitle}
                    onClick={e => handleRailMarkClick(e, key)}
                    onKeyDown={e => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      handleRailMarkClick(e as unknown as React.MouseEvent, key);
                    }}
                    style={{
                      width: RAIL_WIDTH,
                      flexShrink: 0,
                      alignSelf: 'stretch',
                      display: 'grid',
                      gridTemplateRows: '1fr auto 1fr',
                      background: railBackground,
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      aria-label={railSigns.before ? 'Selected context anchor is after this row' : undefined}
                      data-context-rail={railSigns.before ? 'before' : undefined}
                      style={{
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-dim)',
                        fontSize: '0.7rem',
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1,
                      }}
                    >
                      {railSigns.before ? '∧' : null}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0.15rem 0',
                      }}
                    >
                      <button
                        type="button"
                        aria-label={markColor ? 'Row colour' : 'Set row colour'}
                        title={markColor
                          ? 'Row colour — click applies the last colour, or the next one if this row already has it (Ctrl-click to clear, Alt-click to hide)'
                          : 'Set the last row colour (Ctrl-click to clear, Alt-click to hide)'}
                        onClick={e => handleRailColorClick(e, key)}
                        style={{
                          width: RAIL_COLOR_SWATCH_SIZE,
                          height: RAIL_COLOR_SWATCH_SIZE,
                          flexShrink: 0,
                          padding: 0,
                          borderRadius: '50%',
                          cursor: 'pointer',
                          background: markColor ?? 'transparent',
                          border: markColor
                            ? `1.5px solid ${markColor}`
                            : '1.5px dashed var(--text-dim)',
                          // Colour without the marked flag stays visible but dimmed.
                          opacity: !markColor ? 0.45 : rowMarked ? 1 : 0.45,
                        }}
                      />
                    </div>
                    <div
                      aria-label={railSigns.after ? 'Selected context anchor is before this row' : undefined}
                      data-context-rail={railSigns.after ? 'after' : undefined}
                      style={{
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-dim)',
                        fontSize: '0.7rem',
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1,
                      }}
                    >
                      {railSigns.after ? '∨' : null}
                    </div>
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'grid',
                      gridTemplateColumns: gridTemplate,
                      alignItems: 'start',
                      alignSelf: 'stretch',
                      background: rowWash,
                    }}
                  >
                    {visibleCols.map(c => (
                      <React.Fragment key={c.id}>
                        {renderCell(c.id, t, virtualRow.index, virtualRow.index === firstVisibleRowIndex)}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              );
            });
            })()}
            </div>
            {displayPlan && readingIsLive && readingEdge === 'bottom' && (
              <ReadingSpacer
                height={readingBlockPx}
                markerPx={displayPlan.markerPx}
                markerAt="start"
                label={READING_END_LABEL[readingEnd ?? 'data']}
              />
            )}
            {liveEdge === 'top' && oppositeSpacerPx > 0 && (
              displayPlan
                ? (readingIsLive
                  ? <div data-testid="anchor-spacer" aria-hidden style={{ height: oppositeSpacerPx, width: '100%' }} />
                  : (
                    <ReadingSpacer
                      height={oppositeSpacerPx}
                      markerPx={displayPlan.markerPx}
                      markerAt="start"
                      label={READING_END_LABEL[readingEnd ?? 'data']}
                    />
                  ))
                : <div aria-hidden style={{ height: `${oppositeSpacerPx}px`, width: '100%' }} />
            )}
          </>
        )}
      </div>

      {/* Visual scrollbar only — thumb sized as if pausedCount rows were in
          scrollHeight; real scrollHeight / scroll behavior unchanged.
          Always mounted; syncOverlayScrollbar toggles display. */}
      <div
        ref={sbTrackRef}
        className="list-sb-track"
        data-testid="list-scrollbar-track"
        aria-hidden
        style={{ display: 'none' }}
        onPointerDown={onSbTrackPointerDown}
      >
        <div
          ref={sbThumbRef}
          className="list-sb-thumb"
          data-testid="list-scrollbar-thumb"
          onPointerDown={onSbThumbPointerDown}
          onPointerMove={onSbThumbPointerMove}
          onPointerUp={onSbThumbPointerUp}
          onPointerCancel={onSbThumbPointerUp}
        />
      </div>
      </div>
    </div>
    </SendToGaHost>
  );
};

// Add styles for quick filter buttons and resize handles.
// Replace by id so HMR does not leave stale rules (e.g. old user-select:none).
const TELEGRAM_TABLE_STYLE_ID = 'telegram-table-injected-styles';
const style = (document.getElementById(TELEGRAM_TABLE_STYLE_ID) as HTMLStyleElement | null)
  ?? document.createElement('style');
style.id = TELEGRAM_TABLE_STYLE_ID;
style.textContent = `
  /* Hide native scrollbar on the telegram list port — overlay thumb paints instead. */
  .custom-scrollbar {
    scrollbar-width: none;
  }
  .custom-scrollbar::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  .list-sb-track {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: ${LIST_SB_WIDTH_PX}px;
    z-index: 15;
    pointer-events: auto;
  }

  .list-sb-thumb {
    position: absolute;
    left: 0;
    width: 100%;
    background: var(--scrollbar-thumb);
    border-radius: 10px;
    cursor: default;
    pointer-events: auto;
  }

  .list-sb-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }

  .quick-filter-btn, .quick-visualize-btn, .quick-last-seen-btn, .quick-send-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    padding: 0.2rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.2s;
    position: relative;
  }

  .quick-filter-btn.active {
    opacity: 1;
    color: var(--accent-primary);
  }

  .quick-filter-btn .cancel-icon {
    display: none;
  }

  .quick-filter-btn.active:hover .filter-icon {
    display: none;
  }

  .quick-filter-btn.active:hover .cancel-icon {
    display: block;
    color: var(--error); /* red for cancel */
  }

  .quick-filter-btn:focus, .quick-filter-btn:focus-visible,
  .quick-visualize-btn:focus, .quick-visualize-btn:focus-visible,
  .quick-last-seen-btn:focus, .quick-last-seen-btn:focus-visible,
  .quick-send-btn:focus, .quick-send-btn:focus-visible {
    /* Beat .log-row:hover … opacity: 0.6 so the focus ring stays full strength. */
    opacity: 1 !important;
  }

  .log-row:hover .quick-filter-btn:not(.active),
  .log-row:hover .quick-visualize-btn,
  .log-row:hover .quick-last-seen-btn,
  .log-row:hover .quick-send-btn {
    opacity: 0.6;
  }

  /* Edge Δt slots with no neighbor: context +/- only on row hover. */
  .tt-context-edge-slot {
    display: flex;
    justify-self: center;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .log-row:hover .tt-context-edge-slot,
  .tt-context-edge-slot:focus-within {
    opacity: 1;
  }

  /* Lit send icons stay opaque after a bus pulse (!important beats transition glitches). */
  .log-row:hover .quick-send-btn[data-send-popover-open],
  .quick-send-btn[data-send-popover-open],
  .log-row:hover .quick-send-btn[data-send-panel-match],
  .quick-send-btn[data-send-panel-match] {
    opacity: 1 !important;
    color: var(--accent-primary);
  }

  .log-row:hover .quick-send-btn[data-send-job-active],
  .quick-send-btn[data-send-job-active] {
    opacity: 1 !important;
    color: var(--tt-outgoing);
  }

  .log-row:hover .quick-send-btn[data-bus-pulse],
  .quick-send-btn[data-bus-pulse] {
    opacity: 1 !important;
    transition: none;
  }

  /* Temporary inner outline — colour from --row-flash-border (theme). */
  .log-row.row-flash {
    animation: row-flash-fade 1.4s ease-out forwards;
  }

  @keyframes row-flash-fade {
    0%, 35% {
      box-shadow: inset 0 0 0 1px var(--row-flash-border);
    }
    100% {
      box-shadow: inset 0 0 0 1px transparent;
    }
  }

  .quick-filter-btn:hover, .quick-visualize-btn:hover, .quick-last-seen-btn:hover, .quick-send-btn:hover {
    opacity: 1 !important;
    background: var(--bg-hover);
    color: var(--accent-primary);
    transform: scale(1.1);
  }

  .quick-send-btn[data-send-job-active]:hover,
  .quick-send-btn[data-bus-pulse="Outgoing"]:hover {
    color: var(--tt-outgoing);
  }

  .quick-send-btn[data-bus-pulse="Incoming"]:hover {
    color: var(--tt-incoming);
  }

  .quick-visualize-btn:hover {
    color: var(--success);
  }

  .quick-last-seen-btn:hover {
    color: var(--accent-primary);
  }

  @keyframes fill-pause-label-fade {
    from { color: var(--text-main); }
    to { color: var(--text-dim); }
  }

  .fill-rubber-pause-label {
    position: absolute;
    display: flex;
    justify-content: center;
    align-items: center;
    font-style: italic;
    font-size: 0.75rem;
    font-weight: 500;
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    color: var(--text-dim);
    animation: fill-pause-label-fade 550ms ease-out forwards;
  }

  .jump-to-live-pill {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.85rem;
    border: 1px solid var(--accent-primary);
    border-radius: 999px;
    background: var(--accent-primary);
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-lg);
    transition: transform 0.15s, filter 0.15s;
  }

  .jump-to-live-pill:hover {
    filter: brightness(1.08);
  }
  .jump-to-live-pill[data-edge="top"]:hover {
    transform: translate(-50%, -50%) scale(1.03);
  }
  .jump-to-live-pill[data-edge="bottom"]:hover {
    transform: translate(-50%, 50%) scale(1.03);
  }

  .marks-pill {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-panel);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .marks-pill-row {
    display: flex;
    align-items: stretch;
  }

  .marks-pill-row + .marks-pill-row {
    border-top: 1px solid var(--border-color);
  }

  .marks-pill button {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.45rem;
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .marks-pill-row button:first-child {
    padding-left: 0.6rem;
  }

  .marks-pill .marks-pill-clear {
    padding-right: 0.7rem;
    border-left: 1px solid var(--border-color);
  }

  .marks-pill button:hover:not([aria-disabled="true"]) {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }

  .marks-pill button[aria-disabled="true"] {
    opacity: 0.4;
    cursor: default;
  }

  /* Status line under the open QF: inactive → dark, idle → gray, filtering → orange. */
  .quick-filter-bar {
    border-bottom: 1px solid var(--border-subtle);
    transition: border-color 0.15s;
  }
  .quick-filter-bar.idle {
    border-bottom-color: var(--text-dim);
  }
  .quick-filter-bar.filtering {
    border-bottom-color: var(--warning);
  }

  .quick-filter-bar-toggle {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    padding: 0.05rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
  }

  .quick-filter-bar-toggle:hover {
    background: var(--bg-hover);
    color: var(--accent-primary);
  }

  .quick-filter-bar-toggle.open {
    color: var(--accent-primary);
  }

  .quick-filter-bar-input {
    width: 100%;
    min-width: 0;
    background: var(--bg-tag);
    border: 1px solid var(--border-color);
    border-radius: 5px;
    padding: 0.25rem 0.45rem;
    color: var(--text-main);
    font-size: 0.72rem;
    font-family: var(--font-mono, monospace);
    outline: none;
    transition: border-color 0.15s;
  }

  .quick-filter-bar-input::placeholder {
    color: var(--text-dim);
    opacity: 0.32;
    font-style: italic;
    font-weight: 400;
  }

  .quick-filter-bar-input:focus {
    border-color: var(--accent-primary);
  }

  .quick-filter-bar-input.idle {
    background: var(--bg-dark);
  }

  .goto-time-popover {
    display: flex;
    align-items: center;
    padding: 0.35rem 0.65rem;
    /* Opaque — --bg-panel is glassy/translucent and lets the list show through. */
    background: var(--bg-dark);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: var(--shadow-lg);
  }

  /* Column reordering: the dragged header dims, and a bar on the hovered
     header shows the side the column will land on. */
  .header-col {
    cursor: grab;
  }

  .header-col.drag-source {
    opacity: 0.4;
  }

  .header-col.drop-before {
    box-shadow: inset 3px 0 0 var(--accent-primary);
  }

  .header-col.drop-after {
    box-shadow: inset -3px 0 0 var(--accent-primary);
  }

  .col-resize-handle {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    z-index: 2;
    user-select: none;
  }

  .col-resize-handle::after {
    content: '';
    position: absolute;
    top: 20%;
    right: 3px;
    width: 2px;
    height: 60%;
    background: transparent;
    border-radius: 1px;
    transition: background 0.15s;
  }

  .col-resize-handle:hover::after {
    background: var(--accent-primary);
  }
`;
if (!style.parentNode) document.head.appendChild(style);
