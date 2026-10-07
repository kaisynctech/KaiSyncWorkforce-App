'use client'

import { useEffect, useState } from 'react'
import {
  clearDeferredInstallPrompt,
  ensureDeferredInstallCapture,
  getDeferredInstallPrompt,
  subscribeDeferredInstallPrompt,
  type DeferredInstallPrompt,
} from '@/lib/pwa-deferred-install'

type Platform = 'ios' | 'android' | 'desktop'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios'
  }
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  )
}

/**
 * Install / Add to Home Screen control.
 * - Chromium (Android/desktop): native beforeinstallprompt when the browser allows it
 * - Otherwise: in-app steps (never dump users on a marketing page that cannot install)
 * - iOS Safari: Share → Add to Home Screen (Apple does not expose a JS install API)
 */
export function PwaInstallButton({
  className,
  variant = 'inline',
}: {
  className?: string
  variant?: 'inline' | 'banner'
}) {
  const [deferred, setDeferred] = useState<DeferredInstallPrompt | null>(null)
  const [installed, setInstalled] = useState(false)
  const [platform, setPlatform] = useState<Platform>('desktop')
  const [showHelp, setShowHelp] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ensureDeferredInstallCapture()
    setPlatform(detectPlatform())
    if (isRunningStandalone()) {
      setInstalled(true)
      return
    }

    setDeferred(getDeferredInstallPrompt())
    return subscribeDeferredInstallPrompt(setDeferred)
  }, [])

  if (installed) return null

  const isIos = platform === 'ios'
  const label = isIos ? 'Add to Home Screen' : 'Install app'
  const icon = isIos ? 'ios_share' : 'install_mobile'
  const canNativeInstall = Boolean(deferred) && !isIos

  async function handleClick() {
    if (isIos) {
      setShowHelp(true)
      return
    }

    const promptEvent = deferred ?? getDeferredInstallPrompt()
    if (promptEvent) {
      setBusy(true)
      try {
        await promptEvent.prompt()
        const choice = await promptEvent.userChoice
        if (choice.outcome === 'accepted') setInstalled(true)
        clearDeferredInstallPrompt()
        setDeferred(null)
      } catch {
        setShowHelp(true)
      } finally {
        setBusy(false)
      }
      return
    }

    // Browser has not offered a native install prompt yet (common until SW is ready,
    // engagement criteria met, or user previously dismissed). Show real device steps.
    setShowHelp(true)
  }

  const bannerClass =
    'flex w-full items-center justify-center gap-2 h-11 rounded-xl border text-[13px] font-semibold transition-colors'
  const inlineDefault =
    'inline-flex items-center gap-2 rounded-lg px-3 h-9 text-[13px] font-medium'

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        className={className || (variant === 'banner' ? bannerClass : inlineDefault)}
        style={
          variant === 'banner' && !className
            ? {
                borderColor: 'var(--color-primary)',
                backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
                color: 'var(--color-primary)',
              }
            : undefined
        }
        title={isIos ? 'Add KaiSync to your Home Screen' : 'Install KaiSync on this device'}
      >
        <span className="material-icons text-[18px]">{icon}</span>
        {busy ? 'Installing…' : label}
      </button>

      {showHelp && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-text-primary">
                {isIos ? 'Add to Home Screen' : 'Install KaiSync'}
              </h2>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="text-text-secondary hover:text-text-primary"
                aria-label="Close"
              >
                <span className="material-icons">close</span>
              </button>
            </div>

            {isIos ? (
              <>
                <p className="text-[13px] text-text-secondary">
                  On iPhone or iPad, install from Safari (Apple does not allow one-tap install from the button):
                </p>
                <ol className="space-y-3 text-[13px] text-text-primary list-decimal list-inside">
                  <li>
                    Tap the <strong>Share</strong> button{' '}
                    <span className="material-icons text-[16px] align-middle text-primary">ios_share</span>
                  </li>
                  <li>
                    Scroll and tap <strong>Add to Home Screen</strong>
                  </li>
                  <li>
                    Tap <strong>Add</strong> — KaiSync appears like any other app
                  </li>
                </ol>
                <p className="text-[12px] text-text-disabled">
                  Must use Safari — not Chrome or in-app browsers (WhatsApp, Gmail, etc.).
                </p>
              </>
            ) : (
              <>
                <p className="text-[13px] text-text-secondary">
                  {canNativeInstall
                    ? 'Your browser can install KaiSync now. Tap Install below.'
                    : 'Your browser has not offered the automatic install dialog yet. Install manually:'}
                </p>
                {platform === 'android' ? (
                  <ol className="space-y-3 text-[13px] text-text-primary list-decimal list-inside">
                    <li>
                      Open this site in <strong>Chrome</strong> (not WhatsApp / Facebook in-app browser)
                    </li>
                    <li>
                      Tap the <strong>⋮</strong> menu (top right)
                    </li>
                    <li>
                      Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>
                    </li>
                    <li>
                      Confirm — KaiSync opens like a normal app
                    </li>
                  </ol>
                ) : (
                  <ol className="space-y-3 text-[13px] text-text-primary list-decimal list-inside">
                    <li>
                      Use <strong>Chrome</strong> or <strong>Edge</strong>
                    </li>
                    <li>
                      Click the <strong>Install</strong> icon in the address bar, or Menu → <strong>Install KaiSync</strong>
                    </li>
                    <li>
                      Confirm — the app opens in its own window
                    </li>
                  </ol>
                )}
                {canNativeInstall && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleClick()}
                    className="w-full h-11 rounded-xl bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark disabled:opacity-50"
                  >
                    {busy ? 'Installing…' : 'Install now'}
                  </button>
                )}
                <p className="text-[12px] text-text-disabled">
                  Stay on kaisyncworkforce.com while signed in — the install option appears once the app finishes loading.
                </p>
              </>
            )}

            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className={`w-full h-11 rounded-xl text-[14px] font-semibold ${
                canNativeInstall && !isIos
                  ? 'border border-divider text-text-primary hover:bg-surface-elevated'
                  : 'bg-primary text-white hover:bg-primary-dark'
              }`}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
