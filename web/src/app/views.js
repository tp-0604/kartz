// The views that read across boards rather than editing one. They open in the workspace sheet and
// are reached from the canvas, the menu and ⌘K.
export const VIEWS = [
  { id: 'month',    label: 'Month across days',    hint: 'one row per player, a column per scoring day' },
  { id: 'player',   label: 'One player over time', hint: 'every board a player appears on' },
  { id: 'runs',     label: 'Extraction runs',      hint: 'which recording put which rows where' },
  { id: 'activity', label: 'Activity',             hint: 'what changed, and when' },
];
