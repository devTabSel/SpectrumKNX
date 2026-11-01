import React, { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { format } from 'date-fns';
import {
  X, RefreshCw, Building2, ChevronDown, ChevronRight, Cpu, Layers, ListFilter, Clock, Activity, Sparkles, Search,
  LineChart,
  ListChecks, ListX,
} from 'lucide-react';
import { apiUrl } from '../utils/basePath';
import { useExpanded } from '../utils/buildingExpansion';
import { clearDeviceSelection, setOnlySelected, useBuildingSelection, useDeviceSelected } from '../utils/buildingSelection';
import { GaNameWidthContext } from '../utils/gaNameWidth';
import { matchesAnyText } from '../utils/quickFilter';
import { focusLoupeTitle } from '../utils/focusClick';
import { invokeToggle, type ToggleGesture } from '../utils/toggleClick';
import { useLastSeenValues } from '../hooks/useLastSeenValues';
import { AddressActions } from './telegramCell';
import { GaValuesTable, gaAlignColumns } from './GaValuesTable';
import { CheckMark } from './filterControls';
import type { Telegram } from '../hooks/useWebSocket';

// GA name column width is clamped to keep a single very long name from blowing
// up the shared table layout, while still giving short project names their
// natural width (#306).
const MIN_GA_NAME_WIDTH_CH = 8;
const MAX_GA_NAME_WIDTH_CH = 60;

// ── Types (mirror /api/building response) ──────────────────────────────────────

export interface GaRef {
  address: string;
  name: string;
  /** This GA's own DPT, resolved from the project — may differ from the KO's
   * declared DPT even within the same main category (#307). */
  dpt?: { main: number; sub: number | null; name?: string | null } | null;
}

export interface Ko {
  number: number | null;
  name: string;
  text: string;
  function_text: string;
  dpts: { main: number; sub: number | null; name?: string | null }[];
  flags?: { transmit?: boolean };
  group_addresses: GaRef[];
}

export interface Channel {
  id: string;
  name: string;
  kos: Ko[];
}

export interface DeviceNode {
  address: string;
  name: string;
  manufacturer: string;
  hardware: string;
  channels: Channel[];
  kos: Ko[];
}

export interface FunctionGA {
  address: string;
  name: string;
  dpts?: { main: number; sub: number | null; name?: string | null }[];
}

export interface FunctionNode {
  id: string;
  name: string;
  type: string;
  /** ETS function-type name (e.g. FT-1 -> "Licht schalten"), resolved by
   * xknxproject from ETS master data (#307). */
  type_name?: string;
  group_addresses: FunctionGA[];
}

interface SpaceNode {
  kind: 'space';
  type: string;
  name: string;
  spaces: SpaceNode[];
  devices: DeviceNode[];
  functions?: FunctionNode[];
}

interface BuildingData {
  status: string;
  tree: SpaceNode[];
  unassigned_devices: DeviceNode[];
}

interface BuildingOverlayProps {
  onClose: () => void;
  /** Add a device to the Focus list. Does not change the filter. */
  onFilterDevice: (pa: string, reveal?: ToggleGesture) => void;
  /** Add group addresses to the Focus list. Does not change the filter. */
  onFilterGAs: (addresses: string[], reveal?: ToggleGesture) => void;
  /** Open the last-seen overlay for one or more addresses. */
  onLastSeen: (address: string | string[], mode: 'ga' | 'pa', gesture: ToggleGesture) => void;
  /** Open the visualization panel plotting one or more group addresses (#307). */
  onVisualizeGAs: (addresses: string[], gesture: ToggleGesture) => void;
  /** Toggle a group address in the Focus list. Does not change the filter. */
  onFocusFilter?: (address: string, mode: 'ga' | 'pa', reveal?: ToggleGesture) => void;
  /** Group addresses checked in the Focus list. */
  focusFilterGas?: readonly string[];
  /** Devices checked in the Focus list. */
  focusDevices?: readonly string[];
  /** Open the live KO status view for a device (#153). */
  onDeviceStatus: (device: DeviceNode) => void;
  writeEnabled?: boolean;
  /** Newest telegram from the live websocket feed; keeps expanded GA tables current. */
  latestTelegram?: Telegram | null;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}

// ── Group-address collection helpers ─────────────────────────────────────────────

const koGAs = (ko: Ko): string[] => ko.group_addresses.map(g => g.address);

const channelGAs = (ch: Channel): string[] => [...new Set(ch.kos.flatMap(koGAs))];

const deviceGAs = (d: DeviceNode): string[] =>
  [...new Set([...d.channels.flatMap(channelGAs), ...d.kos.flatMap(koGAs)])];

const sortKos = (kos: Ko[]): Ko[] =>
  [...kos].sort((a, b) => {
    if (a.number === null && b.number === null) return 0;
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return a.number - b.number;
  });

const sortSpaces = (spaces: SpaceNode[]): SpaceNode[] =>
  [...spaces].sort((a, b) => {
    const nameA = a.name || a.type || '';
    const nameB = b.name || b.type || '';
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });

// ── Search matching helpers ─────────────────────────────────────────────────────

const gaMatches = (ga: GaRef, q: string) => matchesAnyText(q, ga.address, ga.name);

const koMatches = (ko: Ko, q: string) =>
  matchesAnyText(q, ko.name, ko.text, ko.function_text, ko.number) ||
  ko.group_addresses.some(g => gaMatches(g, q));

const deviceMatches = (d: DeviceNode, q: string): boolean =>
  matchesAnyText(q, d.address, d.name, d.manufacturer) ||
  d.channels.some(c => matchesAnyText(q, c.name) || c.kos.some(k => koMatches(k, q))) ||
  d.kos.some(k => koMatches(k, q));

const functionMatches = (func: FunctionNode, q: string): boolean =>
  matchesAnyText(q, func.name, func.type) ||
  func.group_addresses.some(g => matchesAnyText(q, g.address, g.name));

// Widest GA name across the whole project, so every GaValuesTable instance in
// the tree (comm objects and functions alike) aligns its DPT/TIME/VALUE
// columns at the same x position (#306).
const collectMaxGaNameLength = (data: BuildingData): number => {
  let maxLen = 0;
  const consider = (name: string | null | undefined) => {
    if (name && name.length > maxLen) maxLen = name.length;
  };
  const walkKo = (ko: Ko) => ko.group_addresses.forEach(g => consider(g.name));
  const walkDevice = (d: DeviceNode) => {
    d.channels.forEach(c => c.kos.forEach(walkKo));
    d.kos.forEach(walkKo);
  };
  const walkFunc = (f: FunctionNode) => f.group_addresses.forEach(g => consider(g.name));
  const walkSpace = (s: SpaceNode) => {
    s.spaces.forEach(walkSpace);
    s.devices.forEach(walkDevice);
    (s.functions ?? []).forEach(walkFunc);
  };
  data.tree.forEach(walkSpace);
  data.unassigned_devices.forEach(walkDevice);
  return maxLen;
};

/** Whether a ticked device sits anywhere below this space (#505). */
const spaceHasSelected = (s: SpaceNode, selected: ReadonlySet<string>): boolean =>
  s.devices.some(d => selected.has(d.address)) || s.spaces.some(sub => spaceHasSelected(sub, selected));

const spaceMatches = (s: SpaceNode, q: string): boolean =>
  matchesAnyText(q, s.name, s.type) ||
  s.spaces.some(sub => spaceMatches(sub, q)) ||
  s.devices.some(d => deviceMatches(d, q)) ||
  (s.functions ? s.functions.some(f => functionMatches(f, q)) : false);

const formatDpt = (
  dpts: { main: number; sub: number | null; name?: string | null }[]
): { label: string; name: string | null } | null => {
  if (!dpts || dpts.length === 0) return null;
  const d = dpts[0];
  const label = d.sub != null ? `DPT ${d.main}.${String(d.sub).padStart(3, '0')}` : `DPT ${d.main}`;
  // Backend names read like "5.001 - Percent"; keep only the descriptive part
  // since the numeric label is already shown alongside it.
  let name: string | null = null;
  if (d.name) {
    const sep = d.name.indexOf(' - ');
    name = sep >= 0 ? d.name.slice(sep + 3) : null;
  }
  return { label, name };
};

// ── Row primitives ──────────────────────────────────────────────────────────────

const rowStyle = (depth: number): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: '0.4rem',
  padding: '0.3rem 0.75rem', paddingLeft: `${0.75 + depth * 1.1}rem`,
  userSelect: 'none',
});

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-dim)', padding: '0.15rem', borderRadius: '3px',
  display: 'flex', alignItems: 'center', flexShrink: 0,
};

const Caret: React.FC<{ open: boolean; hasChildren: boolean }> = ({ open, hasChildren }) => (
  <span style={{ width: 12, flexShrink: 0, color: 'var(--text-dim)', display: 'flex' }}>
    {hasChildren ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
  </span>
);

/** Fixed so the group-address list lines up under the communication-object name. */
const KO_NUMBER_WIDTH = '2.15rem';

const koNameInset = (depth: number, hasNumber: boolean) =>
  `calc(${0.75 + depth * 1.1}rem${hasNumber ? ` + ${KO_NUMBER_WIDTH} + 0.4rem` : ''} + 12px + 0.4rem)`;

// ── KO row ──────────────────────────────────────────────────────────────────────

const KoRow: React.FC<{
  ko: Ko;
  koKey: string;
  depth: number;
  onFilterGAs: (addresses: string[], reveal?: ToggleGesture) => void;
  onLastSeen: (address: string | string[], mode: 'ga' | 'pa', gesture: ToggleGesture) => void;
  onVisualizeGAs: (addresses: string[], gesture: ToggleGesture) => void;
  onFocusFilter?: (address: string, mode: 'ga' | 'pa', reveal?: ToggleGesture) => void;
  focusFilterGas?: readonly string[];
  writeEnabled?: boolean;
  latestTelegram?: Telegram | null;
}> = ({ ko, koKey, depth, onFilterGAs, onLastSeen, onVisualizeGAs, onFocusFilter, focusFilterGas, writeEnabled, latestTelegram }) => {
  const [open, toggle] = useExpanded(`ko:${koKey}`, false);
  const dpt = formatDpt(ko.dpts);
  const gaAddresses = useMemo(() => ko.group_addresses.map(g => g.address), [ko.group_addresses]);
  const hasGAs = gaAddresses.length > 0;
  // ETS lists the sending GA first among a transmitting object's links.
  const sendingGA = ko.flags?.transmit && hasGAs ? ko.group_addresses[0].address : null;
  const nameText = ko.text || ko.name;
  const label = (nameText && ko.function_text && nameText !== ko.function_text)
    ? `${nameText} (${ko.function_text})`
    : (nameText || ko.function_text || `Object ${ko.number ?? ''}`);

  // Newest telegram across the KO's linked GAs, and whether any linked GA's own
  // DPT main category differs from the KO's own declared DPT — both shown in the
  // header, aligned with the GA table's TIME/VALUE/DPT columns beneath it (#307).
  const valuesByGA = useLastSeenValues(gaAddresses, latestTelegram);
  const newest = useMemo(() => {
    let latest: Telegram | null = null;
    for (const addr of gaAddresses) {
      const t = valuesByGA[addr];
      if (t && (!latest || new Date(t.timestamp) > new Date(latest.timestamp))) latest = t;
    }
    return latest;
  }, [gaAddresses, valuesByGA]);
  const mismatchMain = useMemo(() => {
    const ownMain = ko.dpts[0]?.main;
    if (ownMain == null) return null;
    const other = ko.group_addresses.find(ga => ga.dpt?.main != null && ga.dpt.main !== ownMain);
    return other?.dpt?.main ?? null;
  }, [ko.dpts, ko.group_addresses]);
  const nameCh = useContext(GaNameWidthContext);
  const koDptText = dpt
    ? `${dpt.label}${dpt.name ? ` ${dpt.name}` : ''}${mismatchMain != null ? ` ${mismatchMain}.*` : ''}`
    : '';
  const alignColumns = useMemo(() => (
    hasGAs
      ? gaAlignColumns(
          gaAddresses,
          [koDptText, ...ko.group_addresses.map(ga => {
            const spec = ga.dpt ?? ko.dpts?.[0];
            if (!spec || spec.main == null) return '';
            const num = spec.sub != null ? `${spec.main}.${String(spec.sub).padStart(3, '0')}` : String(spec.main);
            const raw = spec.name ?? '';
            const sep = raw.indexOf(' - ');
            const desc = sep >= 0 ? raw.slice(sep + 3) : '';
            return desc ? `${num} ${desc}` : num;
          })],
          nameCh,
        )
      : null
  ), [hasGAs, gaAddresses, koDptText, ko.group_addresses, ko.dpts, nameCh]);

  return (
    <div>
    <div
      style={{ ...rowStyle(depth), cursor: hasGAs ? 'pointer' : 'default' }}
      onClick={() => hasGAs && toggle()}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        {ko.number != null && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', fontWeight: 600,
            boxSizing: 'border-box', width: KO_NUMBER_WIDTH, height: '1rem', lineHeight: '1rem',
            textAlign: 'center', padding: '0 0.2rem', borderRadius: '4px',
            background: 'var(--bg-tag)', color: 'var(--text-dim)', border: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}>{ko.number}</span>
        )}
        <Caret open={open} hasChildren={hasGAs} />
        {alignColumns ? (
          <div style={{
            flex: 1, minWidth: 0, display: 'grid', alignItems: 'center',
            gridTemplateColumns: alignColumns.grid,
          }}>
            <div title={label} style={{
              gridColumn: '1 / 3', minWidth: 0,
              fontSize: '0.8rem', color: 'var(--text-main)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{label}</div>
            <span
              title={dpt ? (dpt.name ? `${dpt.label} – ${dpt.name}` : dpt.label) : undefined}
              style={{ paddingLeft: '0.5rem', fontSize: '0.65rem', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {dpt && dpt.label}
              {dpt?.name && <span style={{ opacity: 0.75 }}> {dpt.name}</span>}
              {mismatchMain != null && (
                <span
                  title={`A connected group address has a different DPT main category (${mismatchMain}.*) than this communication object's own DPT`}
                  style={{ color: 'var(--warning-text)' }}
                >
                  {' '}{mismatchMain}.*
                </span>
              )}
            </span>
            <span
              style={{ paddingLeft: '0.5rem', fontSize: '0.65rem', color: 'var(--text-dim)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={newest ? `by ${newest.source_address}${newest.source_name ? ` (${newest.source_name})` : ''}` : undefined}
            >
              {newest && format(new Date(newest.timestamp), 'yyyy-MM-dd HH:mm:ss.SS')}
            </span>
            <span
              style={{
                paddingLeft: '0.5rem', fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {newest && (newest.value_formatted ?? newest.value_numeric ?? '—')}
              {newest?.unit && <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}> {newest.unit}</span>}
            </span>
            <span style={{ paddingLeft: '0.5rem', display: 'inline-flex', alignItems: 'center' }}>
              <button
                style={iconBtnStyle}
                title={focusLoupeTitle(`Toggle focus for the connected group address${gaAddresses.length > 1 ? 'es' : ''}`)}
                onClick={e => { e.stopPropagation(); invokeToggle(e, onFilterGAs, gaAddresses); }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
              >
                <Search size={12} />
              </button>
              <button
                style={iconBtnStyle}
                title={`Visualize connected group address${gaAddresses.length > 1 ? 'es' : ''}`}
                onClick={e => { e.stopPropagation(); invokeToggle(e, onVisualizeGAs, gaAddresses); }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
              >
                <LineChart size={12} />
              </button>
              <button
                style={iconBtnStyle}
                title={`Show last seen values${gaAddresses.length > 1 ? ` (${gaAddresses.length} GAs)` : ''}`}
                onClick={e => { e.stopPropagation(); invokeToggle(e, onLastSeen, gaAddresses, 'ga'); }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
              >
                <Clock size={12} />
              </button>
            </span>
          </div>
        ) : (
          <div title={label} style={{
            flex: 1, minWidth: 0,
            fontSize: '0.8rem', color: 'var(--text-main)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</div>
        )}
      </div>
    </div>
      {hasGAs && !open && (
        <div
          onClick={toggle}
          style={{
            display: 'flex', flexWrap: 'wrap', gap: '0.25rem',
            marginTop: '0.15rem', cursor: 'pointer',
            paddingLeft: koNameInset(depth, ko.number != null),
            paddingRight: '0.75rem',
          }}
        >
          {ko.group_addresses.map(ga => {
            const sending = ga.address === sendingGA;
            const focused = !!focusFilterGas?.includes(ga.address);
            return (
              <span
                key={ga.address}
                title={`${ga.name || ga.address}${sending ? ' — sending group address' : ''}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.15rem',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem',
                  padding: '0.05rem 0.3rem', borderRadius: '3px',
                  background: sending ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.1)',
                  color: 'var(--accent-primary)',
                  border: sending ? '1px solid rgba(99,102,241,0.6)' : '1px solid rgba(99,102,241,0.25)',
                  fontWeight: sending ? 700 : 400,
                }}
              >
                {ga.address}
                <AddressActions
                  inline
                  mode="ga"
                  address={ga.address}
                  name={ga.name}
                  dptMain={ga.dpt?.main}
                  dptSub={ga.dpt?.sub}
                  focusOn={focused}
                  onFocus={onFocusFilter}
                  onVisualize={(_address, _mode, gesture) => onVisualizeGAs([ga.address], gesture)}
                  onLastSeen={onLastSeen}
                  canSend={writeEnabled}
                />
              </span>
            );
          })}
        </div>
      )}
      {open && hasGAs && (
        <GaValuesTable
          entries={ko.group_addresses.map(ga => ({
            address: ga.address,
            name: ga.name || '',
            dpt: ga.dpt ?? ko.dpts?.[0],
            sending: ga.address === sendingGA,
          }))}
          depth={depth}
          latestTelegram={latestTelegram}
          writeEnabled={writeEnabled}
          onFilterGAs={onFilterGAs}
          onLastSeen={onLastSeen}
          onVisualizeGAs={onVisualizeGAs}
          onFocusFilter={onFocusFilter}
          focusFilterGas={focusFilterGas}
          alignToKo
          insetLeft={koNameInset(depth, ko.number != null)}
          alignColumns={alignColumns ?? undefined}
        />
      )}
    </div>
  );
};

// ── Device node ─────────────────────────────────────────────────────────────────

const DeviceRow: React.FC<{
  device: DeviceNode;
  depth: number;
  query: string;
  onFilterDevice: (pa: string, reveal?: ToggleGesture) => void;
  onFilterGAs: (addresses: string[], reveal?: ToggleGesture) => void;
  onLastSeen: (address: string | string[], mode: 'ga' | 'pa', gesture: ToggleGesture) => void;
  onVisualizeGAs: (addresses: string[], gesture: ToggleGesture) => void;
  onFocusFilter?: (address: string, mode: 'ga' | 'pa', reveal?: ToggleGesture) => void;
  focusFilterGas?: readonly string[];
  focusDevices?: readonly string[];
  onDeviceStatus: (device: DeviceNode) => void;
  writeEnabled?: boolean;
  latestTelegram?: Telegram | null;
}> = ({ device, depth, query, onFilterDevice, onFilterGAs, onLastSeen, onVisualizeGAs, onFocusFilter, focusFilterGas, focusDevices, onDeviceStatus, writeEnabled, latestTelegram }) => {
  const [open, toggle] = useExpanded(`dev:${device.address}`, false);
  const koCount = device.channels.reduce((s, c) => s + c.kos.length, 0) + device.kos.length;
  const hasChildren = koCount > 0;
  const effectiveOpen = open || !!query;
  const allGAs = useMemo(() => deviceGAs(device), [device]);
  const [ticked, toggleTicked] = useDeviceSelected(device.address);
  const deviceFocused = !!focusDevices?.includes(device.address);

  return (
    <div>
      <div
        style={{ ...rowStyle(depth), cursor: hasChildren ? 'pointer' : 'default' }}
        onClick={() => hasChildren && toggle()}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <Caret open={effectiveOpen} hasChildren={hasChildren} />
        {/* Tick devices to look at them together; the header can then hide the rest (#505). */}
        <div
          role="checkbox"
          aria-checked={ticked}
          aria-label={`Select device ${device.address}`}
          title="Tick to keep this device when hiding the others"
          onClick={e => { e.stopPropagation(); toggleTicked(); }}
          style={{ display: 'flex', flexShrink: 0, cursor: 'pointer' }}
        >
          <CheckMark state={ticked ? 'checked' : 'unchecked'} />
        </div>
        <Cpu size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', fontWeight: 600,
          color: 'var(--text-main)', flexShrink: 0,
        }}>{device.address}</span>
        <span title={device.name} style={{
          flex: 1, minWidth: 0, fontSize: '0.78rem', color: 'var(--text-dim)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{device.name}</span>
        {hasChildren && (
          <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', flexShrink: 0 }}>
            {koCount} KO{koCount !== 1 ? 's' : ''}
          </span>
        )}
        <AddressActions
          inline
          mode="pa"
          address={device.address}
          name={device.name}
          focusOn={deviceFocused}
          onFocus={(_address, _mode, gesture) => onFilterDevice(device.address, gesture)}
          onLastSeen={onLastSeen}
        />
        {allGAs.length > 0 && (
          <button
            style={iconBtnStyle}
            title={`Visualize all ${allGAs.length} group address${allGAs.length > 1 ? 'es' : ''} of this device`}
            onClick={e => { e.stopPropagation(); invokeToggle(e, onVisualizeGAs, allGAs); }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
          >
            <LineChart size={12} />
          </button>
        )}
        {allGAs.length > 0 && (
          <button
            style={iconBtnStyle}
            title={focusLoupeTitle(`Toggle focus for all ${allGAs.length} group address${allGAs.length > 1 ? 'es' : ''} of this device`)}
            onClick={e => { e.stopPropagation(); invokeToggle(e, onFilterGAs, allGAs); }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
          >
            <ListFilter size={12} />
          </button>
        )}
        {hasChildren && (
          <button
            style={iconBtnStyle}
            title="Live status of all communication objects"
            onClick={e => { e.stopPropagation(); onDeviceStatus(device); }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
          >
            <Activity size={12} />
          </button>
        )}
      </div>
      {effectiveOpen && hasChildren && (
        <div>
          {device.channels.map(ch => {
            const visibleKos = sortKos(query ? ch.kos.filter(k => koMatches(k, query)) : ch.kos);
            if (visibleKos.length === 0) return null;
            return (
              <ChannelRow
                key={ch.id} channel={ch} deviceAddress={device.address} visibleKos={visibleKos} depth={depth + 1}
                query={query} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen} onVisualizeGAs={onVisualizeGAs}
                onFocusFilter={onFocusFilter} focusFilterGas={focusFilterGas}
                writeEnabled={writeEnabled} latestTelegram={latestTelegram}
              />
            );
          })}
          {sortKos(query ? device.kos.filter(k => koMatches(k, query)) : device.kos).map((ko, i) => (
            <KoRow
              key={`${ko.number}-${i}`} ko={ko} koKey={`${device.address}:${ko.number}-${i}`}
              depth={depth + 1} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen} onVisualizeGAs={onVisualizeGAs}
              onFocusFilter={onFocusFilter} focusFilterGas={focusFilterGas}
              writeEnabled={writeEnabled} latestTelegram={latestTelegram}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ChannelRow: React.FC<{
  channel: Channel;
  deviceAddress: string;
  visibleKos: Ko[];
  depth: number;
  query: string;
  onFilterGAs: (addresses: string[], reveal?: ToggleGesture) => void;
  onLastSeen: (address: string | string[], mode: 'ga' | 'pa', gesture: ToggleGesture) => void;
  onVisualizeGAs: (addresses: string[], gesture: ToggleGesture) => void;
  onFocusFilter?: (address: string, mode: 'ga' | 'pa', reveal?: ToggleGesture) => void;
  focusFilterGas?: readonly string[];
  writeEnabled?: boolean;
  latestTelegram?: Telegram | null;
}> = ({ channel, deviceAddress, visibleKos, depth, query, onFilterGAs, onLastSeen, onVisualizeGAs, onFocusFilter, focusFilterGas, writeEnabled, latestTelegram }) => {
  const [open, toggle] = useExpanded(`ch:${deviceAddress}:${channel.id}`, false);
  const effectiveOpen = open || !!query;
  const allGAs = useMemo(() => channelGAs(channel), [channel]);
  return (
    <div>
      <div
        style={{ ...rowStyle(depth), cursor: 'pointer' }}
        onClick={() => toggle()}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <Caret open={effectiveOpen} hasChildren={true} />
        <Layers size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {channel.name || 'Channel'}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', flexShrink: 0 }}>
          {visibleKos.length} KO{visibleKos.length !== 1 ? 's' : ''}
        </span>
        {allGAs.length > 0 && (
          <button
            style={iconBtnStyle}
            title={focusLoupeTitle(`Toggle focus for all ${allGAs.length} group address${allGAs.length > 1 ? 'es' : ''} in this channel`)}
            onClick={e => { e.stopPropagation(); invokeToggle(e, onFilterGAs, allGAs); }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
          >
            <Search size={12} />
          </button>
        )}
      </div>
      {effectiveOpen && visibleKos.map((ko, i) => (
        <KoRow
          key={`${ko.number}-${i}`} ko={ko} koKey={`${deviceAddress}:${channel.id}:${ko.number}-${i}`}
          depth={depth + 1} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen} onVisualizeGAs={onVisualizeGAs}
          onFocusFilter={onFocusFilter} focusFilterGas={focusFilterGas}
          writeEnabled={writeEnabled} latestTelegram={latestTelegram}
        />
      ))}
    </div>
  );
};

// ── Function nodes ──────────────────────────────────────────────────────────────

const FunctionRow: React.FC<{
  func: FunctionNode;
  depth: number;
  query: string;
  onFilterGAs: (addresses: string[], reveal?: ToggleGesture) => void;
  onLastSeen: (address: string | string[], mode: 'ga' | 'pa', gesture: ToggleGesture) => void;
  onVisualizeGAs: (addresses: string[], gesture: ToggleGesture) => void;
  onFocusFilter?: (address: string, mode: 'ga' | 'pa', reveal?: ToggleGesture) => void;
  focusFilterGas?: readonly string[];
  writeEnabled?: boolean;
  latestTelegram?: Telegram | null;
}> = ({ func, depth, query, onFilterGAs, onLastSeen, onVisualizeGAs, onFocusFilter, focusFilterGas, writeEnabled, latestTelegram }) => {
  const [open, toggle] = useExpanded(`func:${func.id}`, false);
  const effectiveOpen = open || !!query;
  const allGAs = useMemo(() => func.group_addresses.map(g => g.address), [func]);

  return (
    <div>
      <div
        style={{ ...rowStyle(depth), cursor: 'pointer' }}
        onClick={() => toggle()}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <Caret open={effectiveOpen} hasChildren={true} />
        <Sparkles size={12} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {func.name || 'Function'}
        </span>
        {func.type_name && (
          // ETS function-type name resolved from project master data (e.g. FT-1 -> "Licht schalten") (#307).
          <span style={{
            fontSize: '0.72rem', color: 'var(--text-dim)', flexShrink: 0, maxWidth: '30%',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '0.4rem',
          }}>
            {func.type_name}
          </span>
        )}
        {func.type && (
          <span
            title={func.type_name || undefined}
            style={{
              fontSize: '0.65rem', color: 'var(--text-dim)', flexShrink: 0,
              background: 'var(--bg-tag)', padding: '0.1rem 0.3rem', borderRadius: 4, marginRight: '0.3rem'
            }}
          >
            {func.type}
          </span>
        )}
        <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', flexShrink: 0 }}>
          {func.group_addresses.length} GA{func.group_addresses.length !== 1 ? 's' : ''}
        </span>
        {allGAs.length > 0 && (
          <>
            <button
              style={iconBtnStyle}
              title={focusLoupeTitle(`Toggle focus for all ${allGAs.length} group address${allGAs.length > 1 ? 'es' : ''} of this function`)}
              onClick={e => { e.stopPropagation(); invokeToggle(e, onFilterGAs, allGAs); }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
            >
              <Search size={12} />
            </button>
            <button
              style={iconBtnStyle}
              title={`Visualize all ${allGAs.length} group address${allGAs.length > 1 ? 'es' : ''} of this function`}
              onClick={e => { e.stopPropagation(); invokeToggle(e, onVisualizeGAs, allGAs); }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
            >
              <LineChart size={12} />
            </button>
            <button
              style={iconBtnStyle}
              title={`Show last seen values of all ${allGAs.length} group address${allGAs.length > 1 ? 'es' : ''} of this function`}
              onClick={e => { e.stopPropagation(); invokeToggle(e, onLastSeen, allGAs, 'ga'); }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
            >
              <Clock size={12} />
            </button>
          </>
        )}
      </div>
      {effectiveOpen && func.group_addresses.length > 0 && (
        <GaValuesTable
          entries={func.group_addresses.map(ga => ({
            address: ga.address,
            name: ga.name || '',
            dpt: ga.dpts?.[0],
          }))}
          depth={depth + 1}
          latestTelegram={latestTelegram}
          writeEnabled={writeEnabled}
          onFilterGAs={onFilterGAs}
          onLastSeen={onLastSeen}
          onVisualizeGAs={onVisualizeGAs}
          onFocusFilter={onFocusFilter}
          focusFilterGas={focusFilterGas}
        />
      )}
    </div>
  );
};

// ── Space node ──────────────────────────────────────────────────────────────────

const SpaceRow: React.FC<{
  space: SpaceNode;
  path: string;
  depth: number;
  query: string;
  onFilterDevice: (pa: string, reveal?: ToggleGesture) => void;
  onFilterGAs: (addresses: string[], reveal?: ToggleGesture) => void;
  onLastSeen: (address: string | string[], mode: 'ga' | 'pa', gesture: ToggleGesture) => void;
  onVisualizeGAs: (addresses: string[], gesture: ToggleGesture) => void;
  onFocusFilter?: (address: string, mode: 'ga' | 'pa', reveal?: ToggleGesture) => void;
  focusFilterGas?: readonly string[];
  focusDevices?: readonly string[];
  onDeviceStatus: (device: DeviceNode) => void;
  writeEnabled?: boolean;
  latestTelegram?: Telegram | null;
}> = ({ space, path, depth, query, onFilterDevice, onFilterGAs, onLastSeen, onVisualizeGAs, onFocusFilter, focusFilterGas, focusDevices, onDeviceStatus, writeEnabled, latestTelegram }) => {
  const [open, toggle] = useExpanded(`space:${path}`, depth < 2);
  const { selected, hideOthers } = useBuildingSelection();
  if (query && !spaceMatches(space, query)) return null;
  // Only ticked devices (#505): spaces without one disappear, the rest open
  // up so the devices end up directly under each other.
  if (hideOthers && !spaceHasSelected(space, selected)) return null;
  const effectiveOpen = open || !!query || hideOthers;
  const hasChildren = space.spaces.length > 0 || space.devices.length > 0 || !!(space.functions && space.functions.length > 0);
  const visibleDevices = space.devices
    .filter(d => !query || deviceMatches(d, query))
    .filter(d => !hideOthers || selected.has(d.address));
  const visibleFunctions = !space.functions || hideOthers
    ? []
    : (query ? space.functions.filter(f => functionMatches(f, query)) : space.functions);

  return (
    <div>
      <div
        style={{ ...rowStyle(depth), cursor: hasChildren ? 'pointer' : 'default' }}
        onClick={() => hasChildren && toggle()}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <Caret open={effectiveOpen} hasChildren={hasChildren} />
        <Building2 size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {space.name || space.type}
        </span>
        {space.type && (
          <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', flexShrink: 0 }}>
            {space.type}
          </span>
        )}
      </div>
      {effectiveOpen && (
        <div>
          {sortSpaces(space.spaces).map((sub, i) => (
            <SpaceRow
              key={`${sub.name}-${i}`} space={sub} path={`${path}/${sub.type}:${sub.name}#${i}`} depth={depth + 1} query={query}
              onFilterDevice={onFilterDevice} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen} onVisualizeGAs={onVisualizeGAs}
              onFocusFilter={onFocusFilter} focusFilterGas={focusFilterGas} focusDevices={focusDevices}
              onDeviceStatus={onDeviceStatus} writeEnabled={writeEnabled} latestTelegram={latestTelegram}
            />
          ))}
          {visibleFunctions.map((func, i) => (
            <FunctionRow
              key={`${func.id}-${i}`} func={func} depth={depth + 1} query={query}
              onFilterGAs={onFilterGAs} onLastSeen={onLastSeen} onVisualizeGAs={onVisualizeGAs}
              onFocusFilter={onFocusFilter} focusFilterGas={focusFilterGas}
              writeEnabled={writeEnabled} latestTelegram={latestTelegram}
            />
          ))}
          {visibleDevices.map(device => (
            <DeviceRow
              key={device.address} device={device} depth={depth + 1} query={query}
              onFilterDevice={onFilterDevice} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen} onVisualizeGAs={onVisualizeGAs}
              onFocusFilter={onFocusFilter} focusFilterGas={focusFilterGas} focusDevices={focusDevices}
              onDeviceStatus={onDeviceStatus} writeEnabled={writeEnabled} latestTelegram={latestTelegram}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main overlay ────────────────────────────────────────────────────────────────

export const BuildingOverlay: React.FC<BuildingOverlayProps> = ({
  onClose, onFilterDevice, onFilterGAs, onLastSeen, onVisualizeGAs, onFocusFilter, focusFilterGas, focusDevices, onDeviceStatus, writeEnabled, latestTelegram,
  searchQuery: searchQueryProp, onSearchQueryChange,
}) => {
  const [data, setData] = useState<BuildingData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const searchQuery = searchQueryProp !== undefined ? searchQueryProp : internalSearchQuery;
  const setSearchQuery = (val: string | ((prev: string) => string)) => {
    const next = typeof val === 'function' ? val(searchQuery) : val;
    setInternalSearchQuery(next);
    onSearchQueryChange?.(next);
  };

  const fetchBuilding = useCallback(() => {
    setIsLoading(true);
    fetch(apiUrl('/api/building'))
      .then(r => r.json())
      .then((d: BuildingData) => setData(d))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBuilding();
  }, [fetchBuilding]);

  const query = searchQuery.trim();

  const { selected, hideOthers, onlySelected } = useBuildingSelection();
  const visibleUnassigned = useMemo(() => {
    if (!data) return [];
    return data.unassigned_devices
      .filter(d => !query || deviceMatches(d, query))
      .filter(d => !hideOthers || selected.has(d.address));
  }, [data, query, hideOthers, selected]);

  const isEmpty = data && data.tree.length === 0 && data.unassigned_devices.length === 0;

  const gaNameWidthCh = useMemo(() => {
    if (!data) return null;
    const maxLen = collectMaxGaNameLength(data);
    if (maxLen === 0) return null;
    return Math.min(Math.max(maxLen, MIN_GA_NAME_WIDTH_CH), MAX_GA_NAME_WIDTH_CH) + 1;
  }, [data]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)',
        flexShrink: 0, background: 'var(--bg-subtle)',
      }}>
        <Building2 size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)', flexShrink: 0 }}>Building Structure</span>
        <div style={{
          width: 220, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'var(--bg-tag)', border: '1px solid var(--border-color)',
          borderRadius: '7px', padding: '0.45rem 0.65rem', transition: 'border-color 0.2s',
        }}>
          <Search size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="filter..."
            aria-label="Filter building"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-main)', fontSize: '0.8125rem', flex: 1, minWidth: 0,
              fontFamily: 'inherit',
            }}
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear filter"
              title="Clear filter"
              onClick={() => setSearchQuery('')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)', display: 'flex' }}
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {/* Ticked devices (#505): hide everything else, or untick them all. */}
        {selected.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <button
              onClick={() => setOnlySelected(!onlySelected)}
              aria-pressed={hideOthers}
              title={hideOthers ? 'Show the whole building again' : 'Hide every device that is not ticked'}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer',
                padding: '0.25rem 0.55rem', borderRadius: 6, fontSize: '0.75rem',
                border: `1px solid ${hideOthers ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                background: hideOthers ? 'rgba(99,102,241,0.15)' : 'var(--bg-subtle)',
                color: hideOthers ? 'var(--accent-primary)' : 'var(--text-dim)',
              }}
            >
              <ListChecks size={13} />
              Only ticked ({selected.size})
            </button>
            <button
              onClick={clearDeviceSelection}
              title="Untick all devices"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: '0.2rem', display: 'flex' }}
            >
              <ListX size={14} />
            </button>
          </div>
        )}
        <button
          onClick={fetchBuilding}
          disabled={isLoading}
          title="Refresh"
          style={{ background: 'transparent', border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer', color: 'var(--text-dim)', padding: '0.2rem', display: 'flex' }}
        >
          <RefreshCw size={14} style={isLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
        <button
          onClick={onClose}
          title="Close"
          aria-label="Close"
          style={{
            background: 'var(--bg-tag)', border: '1px solid var(--border-color)', borderRadius: 7,
            cursor: 'pointer', color: 'var(--text-main)', padding: '0.3rem', display: 'flex', flexShrink: 0,
          }}
        >
          <X size={16} strokeWidth={2.25} />
        </button>
      </div>

      {/* Content */}
      {isLoading && !data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
          Loading…
        </div>
      ) : !data || data.status === 'no_project_loaded' || isEmpty ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
          No building structure available. Upload an ETS project file with building/location data.
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
          <GaNameWidthContext.Provider value={gaNameWidthCh}>
          {sortSpaces(data.tree).map((space, i) => (
            <SpaceRow
              key={`${space.name}-${i}`} space={space} path={`${space.type}:${space.name}#${i}`} depth={0} query={query}
              onFilterDevice={onFilterDevice} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen} onVisualizeGAs={onVisualizeGAs}
              onFocusFilter={onFocusFilter} focusFilterGas={focusFilterGas} focusDevices={focusDevices}
              onDeviceStatus={onDeviceStatus} writeEnabled={writeEnabled} latestTelegram={latestTelegram}
            />
          ))}

          {visibleUnassigned.length > 0 && (
            <div style={{ marginTop: data.tree.length > 0 ? '0.5rem' : 0 }}>
              <div style={{ ...rowStyle(0), color: 'var(--text-dim)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Unassigned Devices
              </div>
              {visibleUnassigned.map(device => (
                <DeviceRow
                  key={device.address} device={device} depth={1} query={query}
                  onFilterDevice={onFilterDevice} onFilterGAs={onFilterGAs} onLastSeen={onLastSeen} onVisualizeGAs={onVisualizeGAs}
                  onFocusFilter={onFocusFilter} focusFilterGas={focusFilterGas} focusDevices={focusDevices}
                  onDeviceStatus={onDeviceStatus} writeEnabled={writeEnabled} latestTelegram={latestTelegram}
                />
              ))}
            </div>
          )}
          </GaNameWidthContext.Provider>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
