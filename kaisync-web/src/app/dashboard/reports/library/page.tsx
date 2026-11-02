'use client'

import Link from 'next/link'
import { useExporter } from '@/components/insights/InsightsContext'
import { REPORTS, SECTION_ORDER } from '@/components/insights/reports'

const SECTION_LABEL: Record<string, string> = {
  People: 'People & attendance', Jobs: 'Jobs & operations', Money: 'Sales & money', Payroll: 'Payroll',
}

const MORE = [
  { href: '/dashboard/reports/commercial', title: 'Commercial intelligence', description: 'Cash-flow forecast, client payment habits and project cost variance.', icon: 'insights' },
  { href: '/dashboard/reports/project-profitability', title: 'Project profitability', description: 'Budget against actual cost for each project.', icon: 'trending_up' },
  { href: '/dashboard/reports/sections', title: 'Other sections', description: 'Clients, contractors, incidents, inventory and property snapshots, and raw CSV exports.', icon: 'grid_view' },
]

export default function ReportLibraryPage() {
  useExporter(null, [])
  return (
    <div className="space-y-8">
      {SECTION_ORDER.map(section => (
        <section key={section}>
          <h2 className="text-[15px] font-semibold text-text-primary mb-3">{SECTION_LABEL[section]}</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {REPORTS.filter(r => r.section === section).map(r => (
              <Link
                key={r.key}
                href={`/dashboard/reports/library/${r.key}`}
                className="group bg-surface border border-divider rounded-2xl p-4 flex gap-3 no-underline hover:border-slate-300 hover:shadow-sm transition"
              >
                <span className="w-10 h-10 rounded-xl bg-[#1E3A5F]/[0.07] flex items-center justify-center shrink-0">
                  <span className="material-icons text-[20px] text-[#1E3A5F]">{r.icon}</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-text-primary group-hover:underline">{r.title}</span>
                  <span className="block text-[12.5px] text-text-secondary mt-0.5 leading-snug">{r.description}</span>
                  <span className="flex gap-1.5 mt-2">
                    <Chip>Table</Chip><Chip>CSV</Chip><Chip>PDF</Chip>
                    {r.asAt && <Chip>As at today</Chip>}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h2 className="text-[15px] font-semibold text-text-primary mb-3">More</h2>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {MORE.map(m => (
            <Link key={m.href} href={m.href} className="group bg-surface border border-divider rounded-2xl p-4 flex gap-3 no-underline hover:border-slate-300 hover:shadow-sm transition">
              <span className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                <span className="material-icons text-[20px] text-slate-500">{m.icon}</span>
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-text-primary group-hover:underline">{m.title}</span>
                <span className="block text-[12.5px] text-text-secondary mt-0.5 leading-snug">{m.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="text-[10.5px] font-medium text-text-secondary bg-slate-100 rounded-md px-1.5 py-0.5">{children}</span>
}
