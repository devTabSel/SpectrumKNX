type HoverListener = (active: boolean) => void;

const activeSources = new Set<string>();
const listeners = new Set<HoverListener>();

const notify = (): void => {
  const active = activeSources.size > 0;
  listeners.forEach((listener) => listener(active));
};

export const isRightSideHoverActive = (): boolean => activeSources.size > 0;

export const setRightSideHoverSource = (sourceId: string, active: boolean): void => {
  const before = activeSources.size > 0;
  if (active) {
    activeSources.add(sourceId);
  } else {
    activeSources.delete(sourceId);
  }
  const after = activeSources.size > 0;
  if (before !== after) notify();
};

export const subscribeRightSideHover = (listener: HoverListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
