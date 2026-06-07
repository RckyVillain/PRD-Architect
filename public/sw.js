// This file intentionally left empty to prevent 404 errors from
// browsers that previously registered a service worker on this origin.
// It will cause the old service worker to unregister itself.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.registration.unregister());
