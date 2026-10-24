/* Beam service worker — caches the app shell so the page loads fast
 * on repeat visits. It never caches transferred content. */

var CACHE = "beam-v1";
var SHELL = ["./", "./index.html", "./style.css", "./app.js",
             "./manifest.json", "./vendor/peerjs.min.js",
             "./vendor/qrcode.min.js"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    })
  );
});

self.addEventListener("fetch", function (event) {
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      return hit || fetch(event.request);
    })
  );
});
