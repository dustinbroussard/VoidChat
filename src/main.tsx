/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Set default AMOLED dark theme
document.documentElement.setAttribute('data-theme', 'default-dark');
document.body.setAttribute('data-theme', 'default-dark');
document.body.classList.add('dark');

// Register service worker strictly in production environments
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .then((registration) => {
          registration.update().catch(() => undefined);
        })
        .catch(error => {
          console.log('SW registration failed:', error);
        });
    });
  } else {
    // During development, unregister any legacy service workers to prevent stale asset serving
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister().catch(() => undefined);
      }
    });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
