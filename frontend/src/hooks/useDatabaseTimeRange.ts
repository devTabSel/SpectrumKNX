import { useEffect, useState } from 'react';
import { apiUrl } from '../utils/basePath';

export interface DatabaseTimeRange {
  /** Inclusive local calendar day (YYYY-MM-DD) from oldest telegram. */
  minDate: string;
  /** Inclusive local calendar day (YYYY-MM-DD) from newest telegram. */
  maxDate: string;
  /** Local oldest telegram instant (YYYY-MM-DDTHH:mm:ss). */
  minDateTime: string;
  /** Local newest telegram instant (YYYY-MM-DDTHH:mm:ss). */
  maxDateTime: string;
}

type Cache =
  | { status: 'idle' }
  | { status: 'loading'; promise: Promise<DatabaseTimeRange | null> }
  | { status: 'done'; value: DatabaseTimeRange | null };

let cache: Cache = { status: 'idle' };

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalDateTime(d: Date): string {
  return `${toLocalDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function loadRange(): Promise<DatabaseTimeRange | null> {
  if (cache.status === 'done') return Promise.resolve(cache.value);
  if (cache.status === 'loading') return cache.promise;

  const promise = fetch(apiUrl('/api/database/info'))
    .then(r => (r.ok ? r.json() : null))
    .then((info: { oldest_timestamp?: string | null; newest_timestamp?: string | null } | null) => {
      if (!info?.oldest_timestamp || !info?.newest_timestamp) return null;
      const oldest = new Date(info.oldest_timestamp);
      const newest = new Date(info.newest_timestamp);
      if (Number.isNaN(oldest.getTime()) || Number.isNaN(newest.getTime())) return null;
      return {
        minDate: toLocalDateKey(oldest),
        maxDate: toLocalDateKey(newest),
        minDateTime: toLocalDateTime(oldest),
        maxDateTime: toLocalDateTime(newest),
      };
    })
    .catch(() => null)
    .then(value => {
      cache = { status: 'done', value };
      return value;
    });

  cache = { status: 'loading', promise };
  return promise;
}

/** Shared telegram-DB calendar span (oldest…newest). Module-cached across mounts. */
export function useDatabaseTimeRange(): DatabaseTimeRange | null {
  const [range, setRange] = useState<DatabaseTimeRange | null>(
    () => (cache.status === 'done' ? cache.value : null),
  );

  useEffect(() => {
    let cancelled = false;
    loadRange().then(value => {
      if (!cancelled) setRange(value);
    });
    return () => { cancelled = true; };
  }, []);

  return range;
}

/** Test helper — reset the module cache between tests. */
export function resetDatabaseTimeRangeCache() {
  cache = { status: 'idle' };
}
