/* Cache-first service worker. Bump VERSION on every deploy to refresh clients. */
const VERSION = "huvudrakning-v7";
const RUNTIME = VERSION + ":runtime";

const PRECACHE = [
  "./",
  "./index.html",
  "./css/style.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/i18n.js",
  "./js/storage.js",
  "./js/problems.js",
  "./js/adaptive.js",
  "./js/ladder.js",
  "./js/stats.js",
  "./js/charts.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        // runtime-cache successful/opaque responses (e.g. Google Fonts) so
        // the app is fully offline after first load
        if (res && (res.ok || res.type === "opaque")) {
          const rt = await caches.open(RUNTIME);
          rt.put(req, res.clone());
        }
        return res;
      } catch (err) {
        if (req.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});
