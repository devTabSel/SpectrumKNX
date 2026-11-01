/** The next mouse selection after a click, matching the focus lists. */
export function nextRowMarks(
  marked: readonly string[],
  lastMarked: string | null,
  order: readonly string[],
  id: string,
  e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
): { marked: string[]; lastMarked: string } {
  const additive = e.ctrlKey || e.metaKey;
  const range = e.shiftKey;
  let next: string[];
  if (range) {
    const anchorIdx = lastMarked ? order.indexOf(lastMarked) : -1;
    const index = order.indexOf(id);
    const rangeKeys = anchorIdx === -1 || index === -1
      ? [id]
      : order.slice(Math.min(anchorIdx, index), Math.max(anchorIdx, index) + 1);
    next = additive ? [...new Set([...marked, ...rangeKeys])] : [...rangeKeys];
  } else if (additive) {
    next = marked.includes(id) ? marked.filter(item => item !== id) : [...marked, id];
  } else {
    next = [id];
  }
  return { marked: next, lastMarked: id };
}

/** Marked rows when the clicked one is among them; otherwise just that row. */
export function rowActionTargets(marked: readonly string[], order: readonly string[], id: string): string[] {
  if (!marked.includes(id)) return [id];
  const visible = new Set(order);
  const targets = marked.filter(item => visible.has(item));
  return targets.length > 0 ? targets : [id];
}

/** Turn the targets on or off and leave every other id as it is. */
export function applyMembership(current: readonly string[], targets: readonly string[], turnOn: boolean): string[] {
  if (turnOn) {
    const have = new Set(current);
    const next = [...current];
    for (const id of targets) if (!have.has(id)) next.push(id);
    return next;
  }
  const drop = new Set(targets);
  return current.filter(id => !drop.has(id));
}
