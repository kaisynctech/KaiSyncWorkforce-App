import { describe, expect, it } from 'vitest'
import { portalStorageObjectName } from './api'

describe('portalStorageObjectName', () => {
  it('keeps a stored storage path', () => {
    expect(portalStorageObjectName('job_photos/company/job/before/file.png')).toBe(
      'job_photos/company/job/before/file.png',
    )
  })

  it('extracts the object name from a public workforce-media URL', () => {
    const url =
      'https://example.supabase.co/storage/v1/object/public/workforce-media/job_photos/company/job/after/file.png'
    expect(portalStorageObjectName(url)).toBe('job_photos/company/job/after/file.png')
  })

  it('drops a query string and decodes the path', () => {
    const url =
      'https://example.supabase.co/storage/v1/object/public/workforce-media/job_photos/a%20b.png?token=secret'
    expect(portalStorageObjectName(url)).toBe('job_photos/a b.png')
  })

  it('leaves an ordinary web link alone', () => {
    expect(portalStorageObjectName('https://example.com/photo.png')).toBeNull()
  })
})
