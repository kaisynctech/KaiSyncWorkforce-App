'use client'

import type { BusinessDigest } from '@/types/commercial'

interface Props {
  digest:       BusinessDigest | null
  loading:      boolean
  onClose:      () => void
  onRegenerate: () => void
}

function HealthBar({ score }: { score: number }) {
  const colour =
    score >= 75 ? '#22c55e' :
    score >= 50 ? '#f59e0b' :
    '#ef4444'

  const label =
    score >= 75 ? 'Strong' :
    score >= 50 ? 'Stable' :
    'Needs Attention'

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-text-secondary uppercase tracking-wide font-medium">
          Commercial Health Score
        </span>
        <span className="text-[13px] font-bold" style={{ color: colour }}>
          {score}/100 — {label}
        </span>
      </div>
      <div className="h-2.5 bg-surface-elevated rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, backgroundColor: colour }}
        />
      </div>
    </div>
  )
}

function Quadrant({ title, icon, text }: { title: string; icon: string; text: string }) {
  return (
    <div className="bg-surface-elevated rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="material-icons text-[16px] text-text-secondary">{icon}</span>
        <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{title}</p>
      </div>
      <p className="text-[13px] text-text-primary leading-snug">{text}</p>
    </div>
  )
}

export default function BusinessDigestModal({ digest, loading, onClose, onRegenerate }: Props) {
  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-surface rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl"
        style={{ border: '1px solid var(--color-border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
          <div className="flex items-center gap-2">
            <span className="material-icons text-[20px]" style={{ color: '#3B82F6' }}>auto_awesome</span>
            <h2 className="text-[16px] font-semibold text-text-primary">AI Business Digest</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-elevated transition-colors"
          >
            <span className="material-icons text-[18px] text-text-secondary">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {loading && !digest && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <span className="material-icons text-[40px] text-text-disabled animate-spin">refresh</span>
              <p className="text-[13px] text-text-secondary">Generating digest…</p>
            </div>
          )}

          {!loading && !digest && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <span className="material-icons text-[40px] text-text-disabled">error_outline</span>
              <p className="text-[13px] text-text-secondary">Failed to generate digest.</p>
              <button
                onClick={onRegenerate}
                className="mt-2 btn-primary text-[13px] h-9 px-4"
              >
                Try Again
              </button>
            </div>
          )}

          {digest && (
            <>
              <HealthBar score={digest.health_score} />

              {/* 4 quadrants in 2-column grid */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 mb-4">
                <Quadrant
                  title="Cash Flow"
                  icon="account_balance_wallet"
                  text={digest.cash_flow_summary}
                />
                <Quadrant
                  title="Client Risk"
                  icon="person_alert"
                  text={digest.client_risk_summary}
                />
                <Quadrant
                  title="Quote Performance"
                  icon="request_quote"
                  text={digest.quote_performance_summary}
                />
                <Quadrant
                  title="Cost Performance"
                  icon="trending_up"
                  text={digest.cost_performance_summary}
                />
              </div>

              {/* Top actions */}
              {digest.top_actions.length > 0 && (
                <div className="bg-surface-elevated rounded-xl p-3 mb-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-icons text-[16px]" style={{ color: '#f59e0b' }}>
                      lightbulb
                    </span>
                    <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
                      Recommended Actions
                    </p>
                  </div>
                  <ol className="space-y-1.5 list-none pl-0">
                    {digest.top_actions.map((action, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span
                          className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white mt-0.5"
                          style={{ backgroundColor: '#3B82F6' }}
                        >
                          {i + 1}
                        </span>
                        <p className="text-[13px] text-text-primary leading-snug">{action}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Generated at */}
              <p className="text-[11px] text-text-disabled text-center">
                Generated {new Date(digest.generated_at).toLocaleString('en-ZA')}
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-divider">
          <button
            onClick={onClose}
            className="btn-outlined text-[13px] h-9 px-4"
          >
            Close
          </button>
          <button
            onClick={onRegenerate}
            disabled={loading}
            className="btn-primary text-[13px] h-9 px-4 flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-icons text-[15px]">
              {loading ? 'hourglass_empty' : 'refresh'}
            </span>
            {loading ? 'Generating…' : 'Regenerate'}
          </button>
        </div>
      </div>
    </div>
  )
}
