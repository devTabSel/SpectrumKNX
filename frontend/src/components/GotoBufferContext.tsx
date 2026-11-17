import type { ReactNode } from 'react';
import { GotoBufferContext, type GotoBufferValue } from '../utils/gotoBuffer';

export function GotoBufferProvider({
  scope,
  oldestMs,
  newestMs,
  children,
}: GotoBufferValue & { children: ReactNode }) {
  return (
    <GotoBufferContext.Provider value={{ scope, oldestMs, newestMs }}>
      {children}
    </GotoBufferContext.Provider>
  );
}
