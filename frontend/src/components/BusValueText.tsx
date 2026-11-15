import { useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import {
  buildValueDisplayModes,
  nextValueDisplayMode,
  type BusValueView,
  type ValueDisplayMode,
} from '../utils/dptValues';
import { isTextDptMain, parseDptMain } from '../utils/knxSend';
import { TT } from '../utils/telegramCellStyles';

interface Props {
  value: BusValueView;
  /** Effective DPT for discrete decoding (row/project/KO). */
  dpt?: string | null;
  /** Style while showing the decoded value (default). */
  style?: CSSProperties;
  /** Style while showing raw/hex/bin (e.g. TelegramTable raw-badge copy). */
  rawStyle?: CSSProperties;
  className?: string;
  /** Extra class while showing non-decoded modes (e.g. raw-badge). */
  rawClassName?: string;
  /** Wrap the value text (default: strong). */
  as?: 'strong' | 'span';
  /** Start in hex mode when hex is available (TelegramTable DATA under VALUE). */
  defaultShowHex?: boolean;
  /**
   * When false, the toggle stays mouse-only (no Tab / focus ring). Use in the
   * telegram-table scroll body where field focus is not allowed.
   */
  allowFocus?: boolean;
  /** Incoming/Outgoing color + one-shot pulse. The node stays mounted in that color. */
  pulse?: 'Incoming' | 'Outgoing' | null;
  /** New key restarts the pulse animation without resetting format state. */
  pulseKey?: string | number | null;
}

const MODE_TITLE: Record<ValueDisplayMode, string> = {
  decoded: 'Show decoded value',
  decimal: 'Show decimal',
  hex: 'Show hex',
  bin: 'Show binary',
};

/**
 * Reusable bus-value display: click cycles decoded → decimal (if different) →
 * hex → binary (≤4-bit DPT). All modes stay stacked so layout does not shift.
 */
export function BusValueText({
  value, dpt, style, rawStyle, className, rawClassName, as = 'strong',
  defaultShowHex = false,
  allowFocus = true,
  pulse = null,
  pulseKey = null,
}: Props) {
  const modes = useMemo(() => buildValueDisplayModes(value, dpt), [value, dpt]);
  const [mode, setMode] = useState<ValueDisplayMode>(() => (
    defaultShowHex ? 'hex' : 'decoded'
  ));

  const active = modes.find(m => m.mode === mode)
    ?? (defaultShowHex ? modes.find(m => m.mode === 'hex') : undefined)
    ?? modes[0];
  const canCycle = modes.length > 1;
  const textDpt = isTextDptMain(dpt ? parseDptMain(dpt) : null);
  const textStyle: CSSProperties | undefined = textDpt
    ? { fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'pre', ...style }
    : style;

  const Tag = as;
  const pulseProps = pulse ? { 'data-bus-pulse': pulse } : {};
  const decodedClass = className ?? TT.value;
  const rawClass = rawClassName ?? TT.rawBadge;

  const cycle = () => {
    if (!canCycle) return;
    setMode(prev => nextValueDisplayMode(modes, prev));
  };

  const nextTitle = (() => {
    if (!canCycle || !active) return undefined;
    const next = nextValueDisplayMode(modes, active.mode);
    return MODE_TITLE[next];
  })();

  const renderOption = (opt: typeof modes[number], visible: boolean): ReactNode => {
    const isDecoded = opt.mode === 'decoded';
    const body = isDecoded && opt.unit ? (
      <>
        {opt.label}
        <span className={TT.valueUnit}>{` ${opt.unit}`}</span>
      </>
    ) : opt.label;

    return (
      <span
        key={opt.mode}
        className={isDecoded ? decodedClass : rawClass}
        style={{
          visibility: visible ? 'visible' : 'hidden',
          ...(isDecoded ? textStyle : rawStyle),
        }}
        aria-hidden={!visible}
      >
        {body}
      </span>
    );
  };

  if (!canCycle || !active) {
    const opt = modes[0] ?? { mode: 'decoded' as const, label: '—', unit: undefined };
    const body = opt.unit ? (
      <>
        {opt.label}
        <span className={TT.valueUnit}>{` ${opt.unit}`}</span>
      </>
    ) : opt.label;
    return (
      <Tag key={pulseKey ?? undefined} className={decodedClass} style={textStyle} {...pulseProps}>
        {body}
      </Tag>
    );
  }

  return (
    <Tag
      key={pulseKey ?? undefined}
      {...pulseProps}
      className={TT.valueToggle}
      role="button"
      tabIndex={allowFocus ? 0 : -1}
      title={nextTitle}
      aria-label={active.unit ? `${active.label} ${active.unit}` : active.label}
      onMouseDown={(e: MouseEvent) => {
        if (!allowFocus) e.preventDefault();
      }}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        cycle();
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (!allowFocus) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          cycle();
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      {modes.map(opt => renderOption(opt, opt.mode === active.mode))}
    </Tag>
  );
}
