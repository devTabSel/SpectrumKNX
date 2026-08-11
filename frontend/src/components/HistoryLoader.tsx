import React, { useState, useCallback } from 'react';
import { X, Clock, Database, AlertCircle } from 'lucide-react';
import type { LoadedRange } from '../utils/historyLoad';

interface HistoryLoaderProps {
  onClose: () => void;
  /** Hands the range off to the caller and closes immediately; the caller
   * loads it in the background (#222). */
  onAsyncLoad: (range: LoadedRange) => void;
  limit: number;
}

type Unit = 'seconds' | 'minutes' | 'hours' | 'days';

const UNIT_TO_SECONDS: Record<Unit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
};

export const HistoryLoader: React.FC<HistoryLoaderProps> = ({ onClose, onAsyncLoad, limit }) => {
  const [error, setError] = useState<string | null>(null);
  const [relValue, setRelValue] = useState(1);
  const [relUnit, setRelUnit] = useState<Unit>('hours');

  const doFetch = useCallback((range: LoadedRange) => {
    onAsyncLoad(range);
    onClose();
  }, [onAsyncLoad, onClose]);

  const handleLoadRelative = useCallback((seconds: number) => {
    doFetch({ kind: 'relative', seconds });
  }, [doFetch]);

  const handleLoadCustomRelative = useCallback(() => {
    if (!relValue || relValue <= 0) { setError('Enter a positive value.'); return; }
    handleLoadRelative(relValue * UNIT_TO_SECONDS[relUnit]);
  }, [relValue, relUnit, handleLoadRelative]);

  return (
    <div className="modal-overlay">
      <div className="glass modal-content">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Database size={20} className="accent-primary" />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Load History</h3>
          </div>
          <button className="icon-button" onClick={onClose} style={{ color: 'var(--text-dim)' }}><X size={20} /></button>
        </div>

        <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          Loads newest-first, up to <strong style={{ color: 'var(--text-main)' }}>{limit.toLocaleString()}</strong> telegrams.
          Duplicates (same timestamp) are skipped.
        </p>

        {/* ── Quick presets ── */}
        <div className="section-label"><Clock size={12} /> Quick Range</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem' }}>
          {([
            ['5 min',  5 * 60],
            ['15 min', 15 * 60],
            ['1 h',    3600],
            ['6 h',    6 * 3600],
            ['24 h',   24 * 3600],
            ['7 d',    7 * 86400],
          ] as [string, number][]).map(([label, secs]) => (
            <button key={label} className="quick-load-btn" onClick={() => handleLoadRelative(secs)}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Custom relative ── */}
        <div className="section-label"><Clock size={12} /> Custom Relative</div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <input
            type="number"
            min={1}
            value={relValue}
            onChange={e => setRelValue(Number(e.target.value))}
            className="glass-input"
            style={{ width: '90px', flexShrink: 0 }}
          />
          <select
            value={relUnit}
            onChange={e => setRelUnit(e.target.value as Unit)}
            className="glass-input"
            style={{ flex: 1 }}
          >
            <option value="seconds">Seconds</option>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
          <button
            className="quick-load-btn"
            onClick={handleLoadCustomRelative}
            style={{ flexShrink: 0, whiteSpace: 'nowrap', padding: '0 1rem' }}
          >
            Load
          </button>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle size={18} style={{ color: 'var(--error)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.875rem', color: 'var(--error)' }}>{error}</span>
          </div>
        )}
      </div>

      <style>{`
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.45); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fade-in 0.15s ease-out; }
        .modal-content { width: 480px; max-height: 90vh; overflow-y: auto; padding: 2rem; border-radius: 14px; animation: scale-in 0.2s cubic-bezier(0.16,1,0.3,1); }
        .section-label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.65rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.65rem; }
        .quick-load-btn { display: flex; align-items: center; justify-content: center; padding: 0.65rem 0.5rem; background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-main); font-size: 0.8125rem; cursor: pointer; transition: all 0.2s; }
        .quick-load-btn:hover { background: rgba(99,102,241,0.1); border-color: var(--accent-primary); color: var(--accent-primary); }
        .glass-input { background: var(--bg-tag); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.65rem 0.75rem; color: var(--text-main); font-family: inherit; font-size: 0.8125rem; outline: none; transition: border-color 0.2s; box-sizing: border-box; }
        .glass-input:focus { border-color: var(--accent-primary); }
        .glass-input::-webkit-calendar-picker-indicator { filter: invert(0.8); cursor: pointer; }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
};
