'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getInitials } from '@/lib/utils'
import type { Employee, AccessLevel } from '@/types/database'

const ACCESS_BADGES: Record<AccessLevel, { label: string; cls: string }> = {
  owner: { label: 'Owner', cls: 'bg-primary/10 text-primary' },
  manager: { label: 'Manager', cls: 'bg-warning-dark text-warning' },
  hr: { label: 'HR', cls: 'bg-accent-light/30 text-primary-dark' },
  employee: { label: 'Employee', cls: 'bg-success-dark text-success' },
}

export default function EmployeesPage() {
  const router = useRouter()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState<AccessLevel | ''>('')
  const [filterStatus, setFilterStatus] = useState<'active' | 'inactive' | ''>('')

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: me } = await supabase
      .from('employees')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!me) { setLoading(false); return }

    const { data } = await supabase
      .from('employees')
      .select('*')
      .eq('company_id', me.company_id)
      .order('name')

    setEmployees((data ?? []) as Employee[])
    setLoading(false)
  }

  const filtered = employees.filter(e => {
    if (filterRole && e.access_level !== filterRole) return false
    if (filterStatus === 'active' && !e.is_active) return false
    if (filterStatus === 'inactive' && e.is_active) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        e.name.toLowerCase().includes(q) ||
        e.surname.toLowerCase().includes(q) ||
        (e.employee_code ?? '').toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q) ||
        (e.position ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Employees</h1>
          <p className="text-[13px] text-text-secondary mt-0.5">{employees.length} total</p>
        </div>
        <Link
          href="/dashboard/employees/new"
          className="flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark transition-colors"
        >
          <span className="material-icons text-[18px]">person_add</span>
          Add Employee
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2 h-10 px-3 bg-surface border border-border rounded-md flex-1 min-w-[200px]">
          <span className="material-icons text-text-disabled text-[18px]">search</span>
          <input
            type="text"
            placeholder="Search by name, code, department…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
          />
        </div>
        <select
          value={filterRole}
          onChange={e => setFilterRole(e.target.value as AccessLevel | '')}
          className="h-10 px-3 bg-surface border border-border rounded-md text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
        >
          <option value="">All roles</option>
          <option value="owner">Owner</option>
          <option value="manager">Manager</option>
          <option value="hr">HR</option>
          <option value="employee">Employee</option>
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as 'active' | 'inactive' | '')}
          className="h-10 px-3 bg-surface border border-border rounded-md text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-lg border border-divider overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <span className="material-icons text-[48px] text-text-disabled block mb-2">people_outline</span>
            <p className="text-[14px] text-text-secondary">No employees found</p>
            <Link href="/dashboard/employees/new" className="mt-3 inline-block text-primary text-[13px] hover:underline">
              + Add your first employee
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Employee</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Code</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Role</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Department</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(emp => {
                  const badge = ACCESS_BADGES[emp.access_level]
                  return (
                    <tr
                      key={emp.id}
                      className="border-b border-divider last:border-0 hover:bg-background transition-colors cursor-pointer"
                      onClick={() => router.push(`/dashboard/employees/${emp.id}`)}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-primary text-[12px] font-semibold">
                              {getInitials(`${emp.name} ${emp.surname}`)}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-text-primary">{emp.name} {emp.surname}</p>
                            {emp.position && (
                              <p className="text-[11px] text-text-secondary">{emp.position}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-text-secondary font-mono">
                        {emp.employee_code ?? '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-text-secondary">
                        {emp.department ?? '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`flex items-center gap-1 text-[12px] font-medium w-fit ${emp.is_active ? 'text-success' : 'text-text-disabled'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${emp.is_active ? 'bg-success' : 'bg-text-disabled'}`} />
                          {emp.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
