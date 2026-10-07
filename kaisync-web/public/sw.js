/* KaiSync PWA — offline shell for employee routes; do not slow HR/dashboard navigations */
const SHELL = 'kaisync-shell-v3'
const PAGES = 'kaisync-employee-pages-v3'

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

  // Never intercept API / auth RPCs / Supabase
  if (url.pathname.startsWith('/api') || url.pathname.includes('supabase')) return

  // Static icons / manifest — network first, cache fallback
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

  // Hashed Next.js assets — cache-first (filenames change on every deploy)
  const isAsset =
    url.pathname.startsWith('/_next/static/')
    || url.pathname.startsWith('/_next/image')

  if (isAsset) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(SHELL).then((cache) => cache.put(req, copy))
          }
          return res
        })
      }),
    )
    return
  }

  // Employee shell pages only — network first, offline cache fallback
  if (!shouldCacheEmployeePage(url.pathname)) {
    // HR / overview / everything else: do not intercept (browser + CDN handle it)
    return
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(PAGES).then((cache) => cache.put(req, copy))
        }
        return res
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached
          return caches.match('/dashboard/employee/overview')
            .then((fallback) => fallback || caches.match('/auth/id-entry'))
        }),
      ),
  )
})
