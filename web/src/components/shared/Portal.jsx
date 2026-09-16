// Overlays belong to the page, not to whatever opened them.
//
// A sheet is glass, and glass — a backdrop filter — confines anything fixed-position inside it to
// the sheet's own box, under the bar above it. A dialog, a menu or a tooltip opened from a sheet is
// therefore drawn here, at the top of the document, where "fixed" means the window again.
import { createPortal } from 'react-dom';

export default function Portal({ children }) {
  return typeof document === 'undefined' ? children : createPortal(children, document.body);
}
