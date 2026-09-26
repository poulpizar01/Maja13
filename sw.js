/* Service Worker — MAJA 13 (PWA) */
const CACHE = 'maja13-v7';
const CORE = [
  './', './index.html', './os.html', './manifest.json', './404.html',
  './config.js', './brand-runtime.js', './maja-theme.css',
  './animations.css', './starfield.js',
  './assets/brand/logo-mark.svg',
  './assets/visuals/hero-maja13.webp',
  './assets/visuals/hero-placeholder.svg',
  './assets/visuals/story-maja13.webp',
  './assets/visuals/map-placeholder.svg'
];

self.addEventListener('install', e => {
  // allSettled : si un seul fichier manque, on met quand même les autres en cache.
  // Avec addAll (tout ou rien), un 404 vidait silencieusement tout le cache.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(CORE.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // On ne touche pas aux appels externes (Discord, La Casa, FiveM…)
  if (url.origin !== location.origin) return;
  // Les médias envoient des requêtes partielles (Range) : les mettre en cache
  // casse la lecture et le déplacement dans la piste sur Safari.
  if (/\.(m4a|mp3|mp4|webm|ogg|wav)$/i.test(url.pathname)) return;

  // config.js porte les liens et la marque : il doit TOUJOURS être frais,
  // sinon les visiteurs habituels gardent l'ancienne version après une mise à jour.
  const toujoursFrais = req.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('config.js');

  if (toujoursFrais) {
    // Réseau d'abord (toujours à jour), cache en secours (hors ligne).
    e.respondWith(
      fetch(req)
        .then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); return res; })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
  } else {
    // Assets : cache d'abord (rapide), sinon réseau.
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        if (res && res.status === 200) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
        return res;
      }).catch(() => new Response('', { status: 504, statusText: 'Hors ligne' })))
    );
  }
});
