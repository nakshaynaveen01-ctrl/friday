// Minimal service worker so the page can be installed as an app.
// Network first; Friday needs the laptop online anyway.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
