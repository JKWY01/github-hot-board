/* GitHub 火线榜 service worker:只干两件事 —— 收 Web Push 弹通知、点通知开档案页。
 * 无缓存劫持、无请求拦截:站点缓存全部交给 Next/Vercel,这里保持零副作用。 */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    /* 非 JSON 载荷:退默认标题 */
  }
  const { title, body, url, tag } = data || {}
  event.waitUntil(
    self.registration.showNotification(title || 'GitHub Hot Board', {
      body: body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: tag || undefined,
      data: { url: url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    })(),
  )
})
