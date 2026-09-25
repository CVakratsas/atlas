import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';

/*
 * Safari pinch-zooms the page through its own proprietary gesture events, which
 * `touch-action` does not always stop on older iOS. The globe has its own zoom; a page
 * zoom on top of it only leaves the interface stuck half off the screen.
 */
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
