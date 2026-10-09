'use client'

import { useEffect } from 'react'
import { ensureDeferredInstallCapture } from '@/lib/pwa-deferred-install'
import { fetchDeployedBuildId, reloadForDeployedBuild, stripUpdateParam } from '@/lib/app-update'

const UPDATE_CHECK_MS = 60_000

/** Registers the KaiSync PWA service worker and reloads when a new deploy is live. */
export function PwaRegister() {
  // Capture beforeinstallprompt immediately on client mount (before dashboard mounts).
  ensureDeferredInstallCapture()

  useEffect(() => {
    ensureDeferredInstallCapture()
    stripUpdateParam()

    let stopped = false
    const check = () => {
      if (stopped || !navigator.onLine) return
      void fetchDeployedBuildId()
        .then(deployed => {
          if (!stopped && deployed) reloadForDeployedBuild(deployed)
        })
        .catch(() => {
          /* offline or a deploy in progress */
        })
    }

    check()
    const timer = window.setInterval(check, UPDATE_CHECK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)

    let removeControllerListener = () => {}
    if ('serviceWorker' in navigator) {
      let refreshing = false
      const hadController = Boolean(navigator.serviceWorker.controller)
      const onControllerChange = () => {
        if (!hadController || refreshing) return
        refreshing = true
        window.location.reload()
      }
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
      removeControllerListener = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      }
      void navigator.serviceWorker.register('/sw.js?v=3')
        .then(registration => registration.update())
        .catch(() => {
          /* ignore registration failures in unsupported contexts */
        })
    }

    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
      removeControllerListener()
    }
  }, [])

  return null
}
