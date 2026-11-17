import { ArrowLeftFromLine, ArrowRightFromLine } from 'lucide-react';
import type { GotoIconTone, GotoReadDirection } from '../utils/gotoBuffer';

export type GotoGlyphKind = 'scroll' | 'load-forward' | 'load-backward';

/**
 * Inside / filtered → scroll glyph. Outside / missing → load direction from
 * the active read direction (same for older and newer targets).
 */
export function gotoGlyphKind(
  tone: GotoIconTone,
  readDirection: GotoReadDirection,
): GotoGlyphKind {
  if (tone === 'ready' || tone === 'filtered') return 'scroll';
  return readDirection === 'forward' ? 'load-forward' : 'load-backward';
}

/** `|↔|` — jump stays in the buffer (scroll only). */
function GotoScrollGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="4" y1="5" x2="4" y2="19" />
      <line x1="20" y1="5" x2="20" y2="19" />
      <polyline points="10 8 7 12 10 16" />
      <polyline points="14 8 17 12 14 16" />
    </svg>
  );
}

interface GotoIconProps {
  tone: GotoIconTone;
  readDirection: GotoReadDirection;
  size?: number;
}

/** Shared goto chrome for buffer edges, WhenJump, and time controls. */
export function GotoIcon({ tone, readDirection, size = 13 }: GotoIconProps) {
  const kind = gotoGlyphKind(tone, readDirection);
  if (kind === 'load-forward') return <ArrowRightFromLine size={size} aria-hidden />;
  if (kind === 'load-backward') return <ArrowLeftFromLine size={size} aria-hidden />;
  return <GotoScrollGlyph size={size} />;
}
