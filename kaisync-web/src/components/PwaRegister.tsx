'use client'

import { useEffect } from 'react'

/** Registers the KaiSync PWA service worker once on the client. */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    const onLoad = () => {
      // Version query forces browsers to fetch the latest SW after deploys.
      void navigator.serviceWorker.register('/sw.js?v=3').catch(() => {
        /* ignore registration failures in unsupported contexts */
      })
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad)
    return () => window.removeEventListener('load', onLoad)
  }, [])

  return null
}
