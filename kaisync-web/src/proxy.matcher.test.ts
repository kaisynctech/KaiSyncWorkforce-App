import { describe, expect, it } from 'vitest'
import { config } from '@/proxy'

// Next.js compiles the matcher with path-to-regexp; for this pattern (one unnamed group)
// it is equivalent to an anchored RegExp, which is what we check here.
const matcher = new RegExp(`^${config.matcher[0]}$`)

describe('proxy matcher', () => {
  it('still runs on signed-in app pages, auth pages and portals', () => {
    for (const p of ['/dashboard/overview', '/dashboard/employees/123', '/auth/id-entry', '/client-portal/home', '/']) {
      expect(matcher.test(p), p).toBe(true)
    }
  })
  it('skips public files that carry no signed-in content', () => {
    for (const p of ['/sw.js', '/manifest.webmanifest', '/icons/icon-192.png', '/robots.txt', '/sitemap.xml',
      '/index.html', '/pricing.html', '/styles.css', '/script.js', '/assets/hero.png', '/_next/static/chunks/a.js', '/api/app-version']) {
      expect(matcher.test(p), p).toBe(false)
    }
  })
})
