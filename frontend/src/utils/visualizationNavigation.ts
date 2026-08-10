import type { Telegram } from '../hooks/useWebSocket';
import { isSeriesHidden } from './legendVisibility';

export const findNearestVisibleVisualizationTelegram = (
  telegrams: Telegram[],
  selectedTargets: string[],
  targetMs: number,
): Telegram | null => {
  if (telegrams.length === 0 || selectedTargets.length === 0) return null;

  const visibleTargets = new Set(selectedTargets.filter(address => !isSeriesHidden(address)));
  if (visibleTargets.size === 0) return null;

  let nearest: Telegram | null = null;
  let bestDiff = Infinity;
  for (const telegram of telegrams) {
    if (!visibleTargets.has(telegram.target_address)) continue;
    const diff = Math.abs(new Date(telegram.timestamp).getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      nearest = telegram;
    }
  }
  return nearest;
};