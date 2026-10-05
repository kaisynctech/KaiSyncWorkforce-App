/* KaiSync PWA — network-first for employee shell, cache static icons */
const SHELL = 'kaisync-shell-v2'
const PAGES = 'kaisync-employee-pages-v1'

const PRECACHE = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/auth/id-entry',
]

const EMPLOYEE_PREFIXES = [
  '/dashboard/employee',
  '/auth/id-entry',
  '/auth/email-otp',
  '/auth/company-selector',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      cache.addAll(PRECACHE).catch(() => undefined),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL && k !== PAGES)
          .map((k) => caches.delete(k)),
      ),
    ),
  )
  self.clients.claim()
})

function shouldCacheEmployeePage(pathname) {
  return EMPLOYEE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Never cache API / auth RPCs / Supabase
  if (url.pathname.startsWith('/api') || url.pathname.includes('supabase')) return

  // Static icons / manifest
  if (url.pathname.startsWith('/icons/') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(SHELL).then((cache) => cache.put(req, copy))
          }
          return res
        })
        .catch(() => caches.match(req)),
    )
    return
  }

  // Employee shell + Next assets: network first, cache fallback
  const isAsset =
    url.pathname.startsWith('/_next/static/')
    || url.pathname.startsWith('/_next/image')
  const isEmployeePage = shouldCacheEmployeePage(url.pathname)

  if (!isAsset && !isEmployeePage) {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((cached) => cached || caches.match('/auth/id-entry')),
      ),
    )
    return
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          const cacheName = isAsset ? SHELL : PAGES
          caches.open(cacheName).then((cache) => cache.put(req, copy))
        }
        return res
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached
          if (isEmployeePage) return caches.match('/dashboard/employee/overview')
          return caches.match('/auth/id-entry')
        }),
      ),
  )
})
