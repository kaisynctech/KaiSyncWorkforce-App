/**
 * Capture beforeinstallprompt as early as possible.
 * The event fires once; if nothing listens yet (e.g. dashboard button not mounted),
 * the install gesture is lost forever and "Install app" can only open a guide page.
 */

export interface DeferredInstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type Listener = (event: DeferredInstallPrompt | null) => void

let deferred: DeferredInstallPrompt | null = null
let listening = false
const listeners = new Set<Listener>()

function notify() {
  for (const fn of listeners) fn(deferred)
}

export function getDeferredInstallPrompt(): DeferredInstallPrompt | null {
  return deferred
}

export function subscribeDeferredInstallPrompt(fn: Listener): () => void {
  listeners.add(fn)
  fn(deferred)
  return () => { listeners.delete(fn) }
}

export function clearDeferredInstallPrompt() {
  deferred = null
  notify()
}

/** Call once from the client shell (safe to call repeatedly). */
export function ensureDeferredInstallCapture() {
  if (typeof window === 'undefined' || listening) return
  listening = true

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as DeferredInstallPrompt
    notify()
  })

  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}
