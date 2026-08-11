import type { Telegram } from '../hooks/useWebSocket';
import { isSeriesHidden } from './legendVisibility';

export interface PreviousVisualizationTelegram {
  telegram: Telegram;
  targetAddress: string;
}

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

export const findPreviousVisibleVisualizationTelegrams = (
  telegrams: Telegram[],
  selectedTargets: string[],
  targetMs: number,
): PreviousVisualizationTelegram[] => {
  if (telegrams.length === 0 || selectedTargets.length === 0) return [];

  const visibleTargets = new Set(selectedTargets.filter(address => !isSeriesHidden(address)));
  if (visibleTargets.size === 0) return [];

  const byTarget = new Map<string, Telegram[]>();
  for (const telegram of telegrams) {
    if (!visibleTargets.has(telegram.target_address)) continue;
    const targetTelegrams = byTarget.get(telegram.target_address) ?? [];
    targetTelegrams.push(telegram);
    byTarget.set(telegram.target_address, targetTelegrams);
  }

  const results: PreviousVisualizationTelegram[] = [];
  for (const [targetAddress, targetTelegrams] of byTarget.entries()) {
    const sorted = [...targetTelegrams].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let previous: Telegram | null = null;
    for (const telegram of sorted) {
      const telegramMs = new Date(telegram.timestamp).getTime();
      if (telegramMs <= targetMs) {
        previous = telegram;
      } else {
        break;
      }
    }
    if (previous) {
      results.push({ telegram: previous, targetAddress });
    }
  }

  return results;
};