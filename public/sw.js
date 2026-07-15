const CACHE = "nearhum-v1";
const PRECACHE = ["/", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// FCM web push arrives here as a raw push event (we register this SW
// ourselves instead of firebase-messaging-sw.js, so we display manually).
self.addEventListener("push", (e) => {
  if (!e.data) return;
  let payload;
  try {
    payload = e.data.json();
  } catch {
    payload = { notification: { title: "Nearhum", body: e.data.text() } };
  }
  const n = payload.notification || {};
  const d = payload.data || {};
  e.waitUntil(
    self.registration.showNotification(n.title || d.title || "Nearhum", {
      body: n.body || d.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: d.tag || "nearhum",
      data: { url: (payload.fcmOptions && payload.fcmOptions.link) || d.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return clients.openWindow(url);
    })
  );
});
