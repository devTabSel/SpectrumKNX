import React from 'react';
import { triStateAriaChecked, type TriState } from '../utils/triState';

export const TRI_STATE_TOGGLE_TITLE =
  'Click: off selects all, on clears, mixed clears. Ctrl/Cmd-click on mixed selects all.';

interface TriStateToggleProps {
  state: TriState;
  onClick: (e: React.MouseEvent) => void;
  label: string;
  title?: string;
}

/**
 * Shared checkbox for DPT and address trees.
 * Off is an empty grey box, on is blue with a check, mixed is a blue box with no mark.
 */
export const TriStateToggle: React.FC<TriStateToggleProps> = ({ state, onClick, label, title }) => (
  <div
    role="checkbox"
    aria-checked={triStateAriaChecked(state)}
    aria-label={label}
    title={title ?? TRI_STATE_TOGGLE_TITLE}
    onClick={e => {
      e.stopPropagation();
      onClick(e);
    }}
    style={{
      width: 14, height: 14, flexShrink: 0, borderRadius: 3, cursor: 'pointer',
      border: `1.5px solid ${state === 'none' ? 'var(--text-dim)' : 'var(--accent-primary)'}`,
      background: state === 'all' ? 'var(--accent-primary)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s',
    }}
  >
    {state === 'all' && (
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
        <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
  </div>
);
