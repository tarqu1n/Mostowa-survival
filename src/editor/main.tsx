import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './editor.css';
import { EditorApp } from './EditorApp';

/**
 * Map Builder — dev-only editor entry (plan 014). `editor.html` → this file, a second Vite page
 * never present in the prod build (`vite.config.ts` pins `build.rollupOptions.input` to
 * `index.html`). The React shell (`EditorApp`) wraps a Phaser viewport; they communicate only
 * through the editor store (`src/editor/store/editorStore.ts`).
 */
const container = document.getElementById('editor-root');
if (!container) throw new Error('editor.html is missing #editor-root');

createRoot(container).render(
  <StrictMode>
    <EditorApp />
  </StrictMode>,
);
