export type { ToggleGesture } from './toggleClick';
export { PLAIN_TOGGLE, invokeToggle, toggleGesture, toggleTitle } from './toggleClick';
import { toggleTitle } from './toggleClick';

export const focusLoupeTitle = (detail = 'Toggle focus') => toggleTitle(detail, 'the focus list');
