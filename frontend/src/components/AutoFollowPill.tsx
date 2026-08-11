import React from 'react';

export interface AutoFollowPillProps {
  /** Telegrams buffered while paused (#391); the pill is hidden when this is 0. */
  count: number;
  onClick: () => void;
  title?: string;
  style?: React.CSSProperties;
}

/** Reusable "paused, N buffered — click to resume" pill shared by the telegram
 * list and the visualization panel, so both reflect the same buffer pause. */
export const AutoFollowPill: React.FC<AutoFollowPillProps> = ({ count, onClick, title = 'Resume auto-follow', style }) => {
  if (count <= 0) return null;
  return (
    <button
      onClick={onClick}
      className="jump-to-live-pill"
      style={style}
      title={title}
    >
      {count.toLocaleString()} new
    </button>
  );
};

// Shared pill styling, injected once regardless of which panel mounts first.
const style = document.createElement('style');
style.textContent = `
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
    transition: filter 0.15s;
  }

  .jump-to-live-pill:hover {
    filter: brightness(1.08);
  }
`;
document.head.appendChild(style);
