// Projexa service worker — ontvangt pushmeldingen (urenherinnering).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { /* leeg bericht */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Projexa', {
      body: data.body || 'Je hebt een nieuwe melding.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/werknemer.html' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data || {}).url || '/werknemer.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lijst) => {
      for (const client of lijst) {
        if (client.url.includes('werknemer') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
