import { useEffect, useState } from 'react';
import { apiUrl } from '../utils/basePath';

/** Telegram totals stored in the database, one map per filter category. */
export interface DbTelegramCounts {
  sources: Record<string, number>;
  targets: Record<string, number>;
  types: Record<string, number>;
  directions: Record<string, number>;
  dpts: Record<string, number>;
}

const EMPTY: DbTelegramCounts = { sources: {}, targets: {}, types: {}, directions: {}, dpts: {} };
const REFRESH_MS = 30_000;

/**
 * Database totals for every filter category. A gray badge uses them where the
 * buffer has no telegram for that entry. Refreshed while the view stays open.
 */
export function useDbTelegramCounts(): DbTelegramCounts | undefined {
  const [counts, setCounts] = useState<DbTelegramCounts | undefined>();

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(apiUrl('/api/telegram-counts'))
        .then(r => {
          if (!r.ok) throw new Error(`telegram counts ${r.status}`);
          return r.json();
        })
        .then((data: Partial<DbTelegramCounts>) => {
          if (cancelled) return;
          setCounts({
            sources: data.sources ?? EMPTY.sources,
            targets: data.targets ?? EMPTY.targets,
            types: data.types ?? EMPTY.types,
            directions: data.directions ?? EMPTY.directions,
            dpts: data.dpts ?? EMPTY.dpts,
          });
        })
        .catch(err => console.error('Failed to load telegram counts', err));
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return counts;
}
