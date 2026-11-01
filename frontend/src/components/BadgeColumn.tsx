import React, { useContext } from 'react';

/**
 * Width of one right-hand badge column. Every row in a list uses the same
 * width, sized to the widest count that list shows, so the icons to its left
 * share one x position. `ch` is resolved against the column's 0.65rem digits.
 */
export function badgeColumnWidth(max: number): string {
  const digits = Math.max(1, String(Math.max(0, Math.trunc(max))).length);
  return `max(1.8rem, ${digits}ch + 1rem)`;
}

/** Widest count the surrounding list displays. Null until a scope provides one. */
export const FilterBadgeMaxContext = React.createContext<number | null>(null);

/** Raises the badge-column size to `max` without shrinking a wider parent scope. */
export const BadgeColumnScope: React.FC<{ max: number; children: React.ReactNode }> = ({ max, children }) => {
  const parent = useContext(FilterBadgeMaxContext) ?? 0;
  return (
    <FilterBadgeMaxContext.Provider value={Math.max(parent, max)}>
      {children}
    </FilterBadgeMaxContext.Provider>
  );
};

/** Fixed column for a telegram or database badge. Empty columns stay reserved. */
export const BadgeColumn: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const max = useContext(FilterBadgeMaxContext) ?? 0;
  return (
    <span
      data-badge-slot=""
      style={{
        width: badgeColumnWidth(max),
        flexShrink: 0,
        display: 'inline-flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        fontSize: '0.65rem',
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
};
