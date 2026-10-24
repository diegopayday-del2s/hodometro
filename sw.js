// Service worker: guarda o app no celular para abrir sem internet.
// Ao mudar qualquer arquivo, suba a VERSAO para o celular baixar a nova.
const VERSAO = '1.3.1';
const CACHE = `hodometro-${VERSAO}`;
const ARQUIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/armazem.js',
  'js/desenho.js',
  'js/fontes.js',
  'js/formato.js',
  'js/geo.js',
  'js/gpx.js',
  'js/graficos.js',
  'js/mapa.js',
  'js/marca.js',
  'js/nativo.js',
  'js/progresso.js',
  'js/rastreador.js',
  'js/rotas.js',
  'js/simulador.js',
  'js/story.js',
  'js/ui.js',
  'js/vibra.js',
  'js/voz.js',
  'fonts/barlow-400.woff2',
  'fonts/barlow-500.woff2',
  'fonts/barlow-600.woff2',
  'fonts/barlow-700.woff2',
  'fonts/barlow-800.woff2',
  'icons/icone-192.png',
  'icons/icone-512.png',
  'icons/icone-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k.startsWith('hodometro-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', e => {
  if (e.data === 'pular') self.skipWaiting();
});

// Primeiro o que está guardado; se não tiver, busca na rede e guarda
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(guardado => guardado || fetch(req).then(resp => {
      if (resp.ok && resp.type === 'basic') {
        const copia = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copia));
      }
      return resp;
    }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
