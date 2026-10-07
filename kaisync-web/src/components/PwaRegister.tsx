'use client'

import { useEffect } from 'react'
import { ensureDeferredInstallCapture } from '@/lib/pwa-deferred-install'

/** Registers the KaiSync PWA service worker and captures the install prompt early. */
export function PwaRegister() {
  // Capture beforeinstallprompt immediately on client mount (before dashboard mounts).
  ensureDeferredInstallCapture()

  useEffect(() => {
    ensureDeferredInstallCapture()
    if (!('serviceWorker' in navigator)) return

    // Register ASAP — installability requires an active SW with a fetch handler.
    void navigator.serviceWorker.register('/sw.js?v=3').catch(() => {
      /* ignore registration failures in unsupported contexts */
    })
  }, [])

  return null
}
