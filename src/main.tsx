import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
createRoot(document.getElementById('root')!).render(<App />);

// PWA: register the app-shell service worker (API calls always stay live; see public/sw.js).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
