/* Service Worker — désinstallation.
 * L'ancien M13 OS (os.html, supprimé) installait un service worker qui servait
 * les fichiers du site depuis son cache. Les navigateurs qui l'ont encore
 * récupèrent cette version : elle vide le cache, se désinscrit et recharge les
 * pages ouvertes. Ce fichier pourra être supprimé quand plus personne n'aura
 * l'ancien service worker (quelques semaines après la mise en ligne).
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await Promise.all((await caches.keys()).map(k => caches.delete(k)));
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
