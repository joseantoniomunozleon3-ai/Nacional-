// ============================================================
// sw.js — Service Worker — Carta de Porte Nacional
// Versión: cp-nacional-v1
// Estrategia: Cache-first para assets estáticos,
//             Network-first para Firebase/API
// ============================================================

const CACHE_NAME = 'cp-nacional-v1';

const PRECACHE_ASSETS = [
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js',
    'https://cdnjs.cloudflare.com/ajax/libs/signature_pad/4.1.7/signature_pad.umd.min.js',
    'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'
];

// URLs que NUNCA se cachean (Firebase, auth, Firestore)
const BYPASS_PATTERNS = [
    'googleapis.com',
    'firebase',
    'firestore',
    'identitytoolkit',
    'securetoken'
];

// ── INSTALL: pre-cachear todos los assets ───────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.allSettled(
                PRECACHE_ASSETS.map(url =>
                    cache.add(url).catch(err =>
                        console.warn('[SW] No se pudo precargar:', url, err)
                    )
                )
            )
        ).then(() => {
            console.log('[SW] Instalado — cache:', CACHE_NAME);
            return self.skipWaiting();
        })
    );
});

// ── ACTIVATE: limpiar caches antiguas ───────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => {
                        console.log('[SW] Eliminando cache antigua:', key);
                        return caches.delete(key);
                    })
            )
        ).then(() => {
            console.log('[SW] Activado — tomando control de clientes');
            return self.clients.claim();
        })
    );
});

// ── FETCH: estrategia por tipo de recurso ───────────────────
self.addEventListener('fetch', event => {
    const url = event.request.url;

    // 1. Bypass Firebase y autenticación — siempre red
    if (BYPASS_PATTERNS.some(p => url.includes(p))) {
        return; // deja pasar sin interceptar
    }

    // 2. Solo GET
    if (event.request.method !== 'GET') return;

    // 3. Solo http/https
    if (!url.startsWith('http')) return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                // Cache hit — devolver desde caché y actualizar en segundo plano
                _refreshInBackground(event.request);
                return cached;
            }

            // Cache miss — ir a red y guardar respuesta
            return fetch(event.request)
                .then(response => {
                    if (response && response.status === 200) {
                        const toCache = response.clone();
                        caches.open(CACHE_NAME).then(cache =>
                            cache.put(event.request, toCache)
                        );
                    }
                    return response;
                })
                .catch(() => {
                    // Sin red — intentar caché como último recurso
                    return caches.match(event.request);
                });
        })
    );
});

// ── Actualización en segundo plano (stale-while-revalidate) ─
function _refreshInBackground(request) {
    fetch(request)
        .then(response => {
            if (response && response.status === 200) {
                caches.open(CACHE_NAME).then(cache =>
                    cache.put(request, response)
                );
            }
        })
        .catch(() => {}); // silencioso si no hay red
}

// ── MENSAJE: forzar actualización desde el cliente ──────────
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('[SW] Forzando actualización inmediata');
        self.skipWaiting();
    }
});
