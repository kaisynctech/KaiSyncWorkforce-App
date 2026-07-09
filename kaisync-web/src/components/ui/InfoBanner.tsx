export function InfoBanner({ icon = 'info', text }: { icon?: string; text: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="material-icons text-text-secondary text-[18px]">{icon}</span>
      <p className="text-text-secondary text-[13px] flex-1">{text}</p>
    </div>
  )
}
