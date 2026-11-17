import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { SendToGaPopover } from './SendToGaPopover';
import type { FilterOption } from '../types/filters';
import type { Telegram } from '../hooks/useWebSocket';
import { nextTriState, type TriState } from '../utils/triState';
import { useTreeExpand } from '../utils/filterPanelExpandPref';
import { TriStateToggle } from './TriStateToggle';

interface KnxAddressTreeProps {
  entries: FilterOption[];
  selected: string[];
  /** Group names keyed by address prefix (e.g. {"0": "Zentral", "0/1": "Wetter"} or {"1": "", "1.0": "EG"}) */
  groupNames: Record<string, string>;
  /** separator: '/' for GAs, '.' for PAs */
  separator: '/' | '.';
  onToggle: (addresses: string[]) => void;
  counts?: Record<string, number>;
  searchQuery: string;
  onLastSeen?: (address: string) => void;
  writeEnabled?: boolean;
  onGotoTelegram?: (telegram: Telegram) => void;
  /** Preference key for manually expanded and collapsed group ids. */
  expandedPrefKey?: string;
}

function getCheckState(leafAddresses: string[], selected: string[]): TriState {
  const count = leafAddresses.filter(a => selected.includes(a)).length;
  if (count === 0) return 'none';
  if (count === leafAddresses.length) return 'all';
  return 'some';
}

function selectionAfterTriToggle(leaves: string[], selected: string[], ctrl: boolean): string[] {
  const next = nextTriState(getCheckState(leaves, selected), { ctrl });
  if (next === 'all') return [...new Set([...selected, ...leaves])];
  return selected.filter(a => !leaves.includes(a));
}

interface LeafRowProps {
  address: string;
  name: string;
  dptMain?: number | null;
  dptSub?: number | null;
  checked: boolean;
  count?: number;
  onToggle: () => void;
  onLastSeen?: () => void;
  isGA?: boolean;
  writeEnabled?: boolean;
  onGotoTelegram?: (telegram: Telegram) => void;
}

const LeafRow: React.FC<LeafRowProps> = ({
  address, name, dptMain, dptSub, checked, count, onToggle, onLastSeen, isGA, writeEnabled, onGotoTelegram,
}) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.25rem',
        borderRadius: '5px', cursor: 'pointer', userSelect: 'none',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; setHovered(true); }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; setHovered(false); }}
    >
      <TriStateToggle state={checked ? 'all' : 'none'} onClick={onToggle} label={address} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div title={address} style={{
          fontSize: '0.8125rem', color: 'var(--text-main)', fontFamily: "'JetBrains Mono', monospace",
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{address}</div>
        {name && (
          <div title={name} style={{
            fontSize: '0.65rem', color: 'var(--text-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{name}</div>
        )}
      </div>
      {writeEnabled && isGA && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            opacity: hovered ? 0.8 : 0,
            transition: 'opacity 0.15s',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = hovered ? '0.8' : '0'; }}
        >
          <SendToGaPopover
            address={address}
            name={name}
            dptMain={dptMain}
            dptSub={dptSub}
            buttonStyle={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', padding: '0.15rem', borderRadius: '3px',
              display: 'flex', alignItems: 'center',
            }}
            onGotoTelegram={onGotoTelegram}
          />
        </div>
      )}
      {onLastSeen && (
        <button
          onClick={e => { e.stopPropagation(); onLastSeen(); }}
          title="Show last seen values"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-dim)', padding: '0.15rem', borderRadius: '3px',
            display: 'flex', alignItems: 'center',
            opacity: hovered ? 0.8 : 0,
            transition: 'opacity 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.color = 'var(--accent-primary)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = hovered ? '0.8' : '0'; (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; }}
        >
          <Clock size={12} />
        </button>
      )}
      {count !== undefined && (
        <span style={{
          fontSize: '0.65rem', fontWeight: 600, minWidth: '1.8rem', textAlign: 'center',
          padding: '0.1rem 0.4rem', borderRadius: '999px',
          background: count > 0 ? 'rgba(99,102,241,0.15)' : 'var(--bg-tag)',
          color: count > 0 ? 'var(--accent-primary)' : 'var(--text-dim)',
          border: count > 0 ? '1px solid rgba(99,102,241,0.3)' : '1px solid var(--border-color)',
          flexShrink: 0,
        }}>{count}</span>
      )}
    </div>
  );
};

interface GroupNodeProps {
  label: string;
  sublabel?: string;
  leafAddresses: string[];
  selected: string[];
  children: React.ReactNode;
  open: boolean;
  onToggleOpen: () => void;
  onToggleAll: (e: React.MouseEvent) => void;
}

const GroupNode: React.FC<GroupNodeProps> = ({ label, sublabel, leafAddresses, selected, children, open, onToggleOpen, onToggleAll }) => {
  const state = getCheckState(leafAddresses, selected);

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
        <TriStateToggle state={state} onClick={onToggleAll} label={label} />
        <div style={{ flex: 1, minWidth: 0 }} onClick={onToggleOpen}>
          <div title={label} style={{
            fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</div>
          {sublabel && (
            <div title={sublabel} style={{
              fontSize: '0.65rem', color: 'var(--text-dim)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{sublabel}</div>
          )}
        </div>
        <div onClick={onToggleOpen} style={{ color: 'var(--text-dim)', flexShrink: 0, display: 'flex' }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </div>
      {open && <div style={{ paddingLeft: '1.25rem' }}>{children}</div>}
    </div>
  );
};

export const KnxAddressTree: React.FC<KnxAddressTreeProps> = ({
  entries, selected, groupNames, separator, onToggle, counts, searchQuery, onLastSeen, writeEnabled, onGotoTelegram,
  expandedPrefKey,
}) => {
  const q = searchQuery.toLowerCase();
  // Search only hides non-matching rows. It does not open groups, so every
  // click here is a manual one and is the only thing written to the preference.
  const { isOpen, toggle } = useTreeExpand(expandedPrefKey);
  const toggleGroup = (id: string, defaultOpen: boolean) => {
    toggle(id, defaultOpen, isOpen(id, defaultOpen), false);
  };

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

  // Filter entries by search query
  const matchesSearch = (entry: FilterOption) =>
    !q || entry.address!.toLowerCase().includes(q) || (entry.name ?? '').toLowerCase().includes(q);

  return (
    <div>
      {[...tree.entries()].map(([l1Key, l2map]) => {
        const allL1Leaves = [...l2map.values()].flat().map(e => e.address!);
        const visibleL2 = [...l2map.entries()].filter(([, leaves]) =>
          leaves.some(matchesSearch)
        );
        if (visibleL2.length === 0) return null;

        const l1Name = groupNames[l1Key] || '';
        const l1Label = l1Name ? `${l1Key} — ${l1Name}` : l1Key;

        // If all leaves are in a single l2 group with the same key as l1 (2-part address), skip l1 level
        const singleGroup = l2map.size === 1 && [...l2map.keys()][0] === l1Key;

        if (singleGroup) {
          // Only 1 level deep — render leaves directly under a single group node
          const leaves = [...l2map.values()][0].filter(matchesSearch);
          return (
            <GroupNode
              key={l1Key}
              label={l1Label}
              leafAddresses={allL1Leaves}
              selected={selected}
              open={isOpen(l1Key, true)}
              onToggleOpen={() => toggleGroup(l1Key, true)}
              onToggleAll={e => onToggle(selectionAfterTriToggle(allL1Leaves, selected, e.ctrlKey || e.metaKey))}
            >
              {leaves.map(e => (
                <LeafRow key={e.address} address={e.address!} name={e.name ?? ''} checked={selected.includes(e.address!)}
                  dptMain={e.main} dptSub={e.sub}
                  count={counts?.[e.address!]}
                  onToggle={() => onToggle(selected.includes(e.address!) ? selected.filter(a => a !== e.address) : [...selected, e.address!])}
                  onLastSeen={onLastSeen ? () => onLastSeen(e.address!) : undefined}
                  isGA={separator === '/'} writeEnabled={writeEnabled} onGotoTelegram={onGotoTelegram}
                />
              ))}
            </GroupNode>
          );
        }

        return (
          <GroupNode
            key={l1Key}
            label={l1Label}
            leafAddresses={allL1Leaves}
            selected={selected}
            open={isOpen(l1Key, true)}
            onToggleOpen={() => toggleGroup(l1Key, true)}
            onToggleAll={e => onToggle(selectionAfterTriToggle(allL1Leaves, selected, e.ctrlKey || e.metaKey))}
          >
            {visibleL2.map(([l2Key, leaves]) => {
              const visibleLeaves = leaves.filter(matchesSearch);
              if (visibleLeaves.length === 0) return null;
              const l2Leaves = leaves.map(e => e.address!);
              const l2Name = groupNames[l2Key] || '';
              const l2Label = l2Name ? `${l2Key} — ${l2Name}` : l2Key;

              return (
                <GroupNode
                  key={l2Key}
                  label={l2Label}
                  leafAddresses={l2Leaves}
                  selected={selected}
                  open={isOpen(l2Key, false)}
                  onToggleOpen={() => toggleGroup(l2Key, false)}
                  onToggleAll={e => onToggle(selectionAfterTriToggle(l2Leaves, selected, e.ctrlKey || e.metaKey))}
                >
                  {visibleLeaves.map(e => (
                    <LeafRow key={e.address} address={e.address!} name={e.name ?? ''} checked={selected.includes(e.address!)}
                      dptMain={e.main} dptSub={e.sub}
                      count={counts?.[e.address!]}
                      onToggle={() => onToggle(selected.includes(e.address!) ? selected.filter(a => a !== e.address) : [...selected, e.address!])}
                      onLastSeen={onLastSeen ? () => onLastSeen(e.address!) : undefined}
                      isGA={separator === '/'} writeEnabled={writeEnabled} onGotoTelegram={onGotoTelegram}
                    />
                  ))}
                </GroupNode>
              );
            })}
          </GroupNode>
        );
      })}
    </div>
  );
};
