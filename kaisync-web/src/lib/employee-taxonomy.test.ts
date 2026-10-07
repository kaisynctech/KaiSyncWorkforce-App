import { describe, expect, it } from 'vitest'
import {
  isCompanyDashboardAccess,
  isHrOrAbove,
  isOwnerOrAdmin,
  normalizeAccessLevel,
  normalizeEmploymentType,
  normalizeWorkerType,
} from '@/lib/employee-taxonomy'

describe('normalizeAccessLevel', () => {
  it('maps canonical values', () => {
    expect(normalizeAccessLevel('owner')).toBe('owner')
    expect(normalizeAccessLevel('admin')).toBe('admin')
    expect(normalizeAccessLevel('manager')).toBe('manager')
    expect(normalizeAccessLevel('hr')).toBe('hr')
    expect(normalizeAccessLevel('employee')).toBe('employee')
  })

  it('maps legacy HR admin aliases to hr (not company Admin)', () => {
    expect(normalizeAccessLevel('hr_admin')).toBe('hr')
    expect(normalizeAccessLevel('HR Admin')).toBe('hr')
    expect(normalizeAccessLevel('hradmin')).toBe('hr')
  })

  it('defaults unknown / empty to employee', () => {
    expect(normalizeAccessLevel(null)).toBe('employee')
    expect(normalizeAccessLevel('')).toBe('employee')
    expect(normalizeAccessLevel('field')).toBe('employee')
  })
})

describe('isCompanyDashboardAccess', () => {
  it('allows owner, admin, hr, manager', () => {
    expect(isCompanyDashboardAccess('owner')).toBe(true)
    expect(isCompanyDashboardAccess('admin')).toBe(true)
    expect(isCompanyDashboardAccess('hr_admin')).toBe(true)
    expect(isCompanyDashboardAccess('manager')).toBe(true)
    expect(isCompanyDashboardAccess('employee')).toBe(false)
  })
})

describe('isOwnerOrAdmin / isHrOrAbove', () => {
  it('treats admin like owner for ops', () => {
    expect(isOwnerOrAdmin('owner')).toBe(true)
    expect(isOwnerOrAdmin('admin')).toBe(true)
    expect(isOwnerOrAdmin('hr')).toBe(false)
  })

  it('includes admin in HR-or-above', () => {
    expect(isHrOrAbove('admin')).toBe(true)
    expect(isHrOrAbove('hr')).toBe(true)
    expect(isHrOrAbove('manager')).toBe(false)
  })
})

describe('normalizeEmploymentType / workerType', () => {
  it('normalizes employment types', () => {
    expect(normalizeEmploymentType('Part Time')).toBe('part-time')
    expect(normalizeEmploymentType('Permanent')).toBe('permanent')
  })

  it('normalizes worker types', () => {
    expect(normalizeWorkerType('Contractor')).toBe('contractor')
    expect(normalizeWorkerType(null)).toBe('employee')
  })
})
