'use client'

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type Platform = 'ios' | 'android' | 'desktop'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent || ''
  // iPadOS 13+ reports as MacIntel with touch
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
 * - Android / Chromium: uses beforeinstallprompt when available, else opens /install
 * - iOS Safari: shows Share → Add to Home Screen steps (no native install event)
 * Hidden only when already running as an installed PWA.
 */
export function PwaInstallButton({
  className,
  variant = 'inline',
}: {
  className?: string
  /** `banner` = full-width card under dashboard clock; `inline` = compact (sidebar / auth). */
  variant?: 'inline' | 'banner'
}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [platform, setPlatform] = useState<Platform>('desktop')
  const [showIosHelp, setShowIosHelp] = useState(false)

  useEffect(() => {
    setPlatform(detectPlatform())
    if (isRunningStandalone()) {
      setInstalled(true)
      return
    }

    function onPrompt(e: Event) {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    function onInstalled() {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Only hide when the app is already installed / running standalone.
  if (installed) return null

  const isIos = platform === 'ios'
  const label = isIos ? 'Add to Home Screen' : 'Install app'
  const icon = isIos ? 'ios_share' : 'install_mobile'

  async function handleClick() {
    if (isIos) {
      setShowIosHelp(true)
      return
    }
    if (deferred) {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === 'accepted') setInstalled(true)
      setDeferred(null)
      return
    }
    window.location.href = '/install'
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
        {label}
      </button>

      {showIosHelp && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-text-primary">Add to Home Screen</h2>
              <button
                type="button"
                onClick={() => setShowIosHelp(false)}
                className="text-text-secondary hover:text-text-primary"
                aria-label="Close"
              >
                <span className="material-icons">close</span>
              </button>
            </div>
            <p className="text-[13px] text-text-secondary">
              On iPhone or iPad, install KaiSync from Safari:
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
              Must use Safari (not Chrome/in-app browsers) for Add to Home Screen.
            </p>
            <button
              type="button"
              onClick={() => setShowIosHelp(false)}
              className="w-full h-11 rounded-xl bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
