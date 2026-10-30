import { describe, expect, it } from 'vitest'
import {
  ATTENDANCE_PAGE_SIZE,
  attendancePageCount,
  attendancePageItems,
  attendanceRangeLabel,
} from '@/lib/attendance-page'

describe('overview attendance pages', () => {
  it('shows 50 people on a page and keeps the rest for the next page', () => {
    const people = Array.from({ length: 200 }, (_, i) => i + 1)
    expect(ATTENDANCE_PAGE_SIZE).toBe(50)
    expect(attendancePageCount(200)).toBe(4)
    expect(attendancePageItems(people, 1)).toEqual(people.slice(0, 50))
    expect(attendancePageItems(people, 4)).toEqual(people.slice(150, 200))
    expect(attendanceRangeLabel(200, 2)).toBe('51–100 of 200')
  })

  it('does not paginate a short list and clamps a page past the end', () => {
    expect(attendancePageCount(7)).toBe(1)
    expect(attendanceRangeLabel(7, 1)).toBe('7 people')
    expect(attendanceRangeLabel(1, 1)).toBe('1 person')
    expect(attendancePageItems([1, 2, 3], 9)).toEqual([1, 2, 3])
    expect(attendancePageCount(0)).toBe(1)
  })
})