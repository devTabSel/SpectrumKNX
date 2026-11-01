import type { CSSProperties } from 'react';

/** On-state shared with the other toggles: accent glyph on a light accent wash. */
export function toggleButtonColors(on: boolean): CSSProperties {
  return {
    background: on ? 'color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'transparent',
    color: on ? 'var(--accent-primary)' : 'var(--text-dim)',
    border: `1px solid ${on ? 'color-mix(in srgb, var(--accent-primary) 45%, var(--border-color))' : 'var(--border-color)'}`,
  };
}

/** Checkbox mark. The frame matches an empty box; a checked frame is the same border, a step lighter. */
export function CheckMark({ state }: { state: 'checked' | 'partial' | 'unchecked' }) {
  const on = state !== 'unchecked';
  return (
    <div
      aria-hidden
      style={{
        width: 14, height: 14, flexShrink: 0, borderRadius: 3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
        border: `1.5px solid ${on ? 'color-mix(in srgb, white 24%, var(--border-color))' : 'var(--border-color)'}`,
        background: state === 'checked' ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)' : 'transparent',
        color: 'var(--accent-primary)',
      }}
    >
      {state === 'checked' && (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1.5 4L3.5 6L6.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === 'partial' && (
        <div style={{ width: 6, height: 2, background: 'currentColor', borderRadius: 1 }} />
      )}
    </div>
  );
}
