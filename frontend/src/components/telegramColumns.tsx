import React, { useCallback, useState } from 'react';
import { getPref, setPref } from '../utils/prefs';
import type { SortKey } from '../utils/sortConfig';

export type ColId = 'time' | 'delta' | 'source' | 'target' | 'type' | 'dpt' | 'value';

export interface ColumnDef {
  id: ColId;
  label: string;
  sortKey?: SortKey;
  defaultWidth: number;
  minWidth: number;
  /** key in visibleColumns that toggles this column (undefined = always visible) */
  visibleKey?: string;
}

/** Column set of the telegram list. Last Seen reuses the same widths. */
export const TELEGRAM_COLUMNS: ColumnDef[] = [
  { id: 'time', label: 'TIME', sortKey: 'timestamp', defaultWidth: 120, minWidth: 90 },
  { id: 'delta', label: 'Δt', defaultWidth: 100, minWidth: 60, visibleKey: 'delta' },
  { id: 'source', label: 'SOURCE', sortKey: 'source_address', defaultWidth: 190, minWidth: 90 },
  { id: 'target', label: 'TARGET', sortKey: 'target_address', defaultWidth: 230, minWidth: 90 },
  { id: 'type', label: 'TYPE', sortKey: 'simplified_type', defaultWidth: 95, minWidth: 70, visibleKey: 'type' },
  { id: 'dpt', label: 'DPT', sortKey: 'dpt_name', defaultWidth: 150, minWidth: 80, visibleKey: 'dpt' },
  { id: 'value', label: 'VALUE', sortKey: 'value_numeric', defaultWidth: 220, minWidth: 120 },
];

const COLUMN_WIDTHS_PREF = 'columnWidths';

/** Persisted column widths, shared by the telegram list and Last Seen. */
export function useTelegramColumnWidths() {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    for (const column of TELEGRAM_COLUMNS) defaults[column.id] = column.defaultWidth;
    try {
      const saved = getPref(COLUMN_WIDTHS_PREF);
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch {
      // Ignore a malformed stored value.
    }
    return defaults;
  });

  const widthFor = useCallback(
    (id: ColId) => columnWidths[id] ?? TELEGRAM_COLUMNS.find(column => column.id === id)!.defaultWidth,
    [columnWidths],
  );

  const persistWidths = useCallback((widths: Record<string, number>) => {
    setPref(COLUMN_WIDTHS_PREF, JSON.stringify(widths));
  }, []);

  const resizeStart = useCallback((event: React.MouseEvent, column: ColumnDef) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthFor(column.id);
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(column.minWidth, Math.round(startWidth + (ev.clientX - startX)));
      setColumnWidths(prev => ({ ...prev, [column.id]: next }));
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

  const resetWidth = useCallback((column: ColumnDef) => {
    setColumnWidths(prev => {
      const next = { ...prev, [column.id]: column.defaultWidth };
      persistWidths(next);
      return next;
    });
  }, [persistWidths]);

  const gridFor = useCallback((columns: ColumnDef[]) => columns
    .map((column, index) => {
      const width = widthFor(column.id);
      return index === columns.length - 1 ? `minmax(${width}px, 1fr)` : `${width}px`;
    })
    .join(' '), [widthFor]);

  return { widthFor, gridFor, resizeStart, resetWidth };
}

/**
 * The telegram-list column header without the icon rail and without the
 * spacer rows above and below the label. `stacked` keeps those rows so the
 * telegram list label stays centred against its rail.
 */
export const TelegramColumnHeader: React.FC<{
  columns: ColumnDef[];
  gridTemplate: string;
  stacked?: boolean;
  renderLabel?: (column: ColumnDef) => React.ReactNode;
  /** Content for the row above the label. Only the stacked telegram-list header has that row. */
  renderAbove?: (column: ColumnDef) => React.ReactNode;
  /** Content for the row below the label. Only the stacked telegram-list header has that row. */
  renderBelow?: (column: ColumnDef) => React.ReactNode;
  onResizeStart?: (event: React.MouseEvent, column: ColumnDef) => void;
  onResetWidth?: (column: ColumnDef) => void;
  bindCell?: (column: ColumnDef) => React.HTMLAttributes<HTMLDivElement>;
}> = ({ columns, gridTemplate, stacked = false, renderLabel, renderAbove, renderBelow, onResizeStart, onResetWidth, bindCell }) => (
  <div style={{
    flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: gridTemplate,
    color: 'var(--text-main)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700,
    paddingRight: '8px',
  }}>
    {columns.map((column, index) => {
      const bound = bindCell?.(column) ?? {};
      const { style: boundStyle, className, ...rest } = bound;
      return (
        <div
          key={column.id}
          className={className ?? 'header-col'}
          style={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, ...boundStyle }}
          {...rest}
        >
          {stacked && (
            <div style={{ flex: 1, minHeight: '1.3rem', display: 'flex', alignItems: 'center', padding: '0 1rem', minWidth: 0 }}>
              {renderAbove?.(column)}
            </div>
          )}
          <div style={{ flex: stacked ? 1 : undefined, minHeight: '1.3rem', padding: stacked ? '0 1rem' : '0.45rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {renderLabel ? renderLabel(column) : <span>{column.label}</span>}
          </div>
          {stacked && (
            <div style={{ flex: 1, minHeight: '1.3rem', padding: '0 1rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start', gap: '0.4rem', minWidth: 0 }}>
              {renderBelow?.(column)}
            </div>
          )}
          {index < columns.length - 1 && onResizeStart && (
            <div
              className="col-resize-handle"
              onMouseDown={event => onResizeStart(event, column)}
              onDoubleClick={() => onResetWidth?.(column)}
              title="Drag to resize · double-click to reset"
            />
          )}
        </div>
      );
    })}
  </div>
);

const headerStyle = document.createElement('style');
headerStyle.textContent = `
  .header-col[draggable="true"] {
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
document.head.appendChild(headerStyle);

/** Gradient bar the telegram list wraps around its header grid. */
export const telegramHeaderFrameStyle: React.CSSProperties = {
  display: 'flex',
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-panel) 82%, var(--accent-primary) 18%) 0%, color-mix(in srgb, var(--bg-panel) 92%, black 8%) 100%)',
  zIndex: 2,
  backdropFilter: 'blur(12px)',
  borderTop: '1px solid color-mix(in srgb, var(--accent-primary) 18%, var(--border-color))',
  borderBottom: '1px solid color-mix(in srgb, var(--accent-primary) 22%, var(--border-color))',
  boxShadow: 'inset 0 1px 0 color-mix(in srgb, white 6%, transparent), inset 0 -1px 0 color-mix(in srgb, black 18%, transparent)',
  flexShrink: 0,
};
