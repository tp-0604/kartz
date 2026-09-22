// The dialog, mounted. Two stylesheets: the palette and primitives the whole project shares,
// and the layout built for a small floating window over the spreadsheet.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/dialog.css';
import Dialog from './dialog/Dialog.jsx';
import Boundary from './components/shared/Boundary.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Boundary label="Kartz">
      <Dialog />
    </Boundary>
  </StrictMode>,
);
