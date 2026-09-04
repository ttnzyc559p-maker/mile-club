/* The Mile Club — service worker
 * Offline shell + home-screen reminder nudges.
 * Bump VERSION when shipping a new index.html so installed apps pick it up. */
const VERSION = "v1";
const CACHE = "mileclub-" + VERSION;
const STATE_CACHE = "mileclub-state"; // written by the page, read here; never versioned away
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== STATE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Network first so an online open always gets the latest app; cached shell offline.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => { c.put("./index.html", copy.clone()); c.put("./", copy); });
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static assets: cache first, refresh in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});

/* ---- reminder nudges while the app is closed (periodic background sync;
        Chrome/Android with the app installed — other platforms ignore this) ---- */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function checkReminder() {
  const c = await caches.open(STATE_CACHE);
  const res = await c.match("./reminder-state");
  if (!res) return;
  let s;
  try { s = await res.json(); } catch { return; }
  if (!s.reminderOn) return;
  const now = new Date();
  const today = ymd(now);
  if (s.loggedDate === today) return;   // mile already done
  if (s.notifiedDate === today) return; // already nudged today
  const [h, m] = String(s.reminderTime || "07:30").split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return; // not time yet
  s.notifiedDate = today;
  await c.put("./reminder-state", new Response(JSON.stringify(s)));
  await self.registration.showNotification("The Mile Club", {
    body: "Your mile is waiting. Keep the streak alive.",
    tag: "mile-reminder",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
  });
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "mile-reminder") e.waitUntil(checkReminder());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ("focus" in w) return w.focus();
      return self.clients.openWindow("./");
    })
  );
});
