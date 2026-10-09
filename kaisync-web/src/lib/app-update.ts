const UPDATE_PARAM = '__kaisync_build'
const RELOAD_KEY = 'kaisync-reloaded-for'

export function runningBuildId(): string {
  return process.env.NEXT_PUBLIC_BUILD_ID ?? ''
}

export async function fetchDeployedBuildId(): Promise<string | null> {
  const res = await fetch('/api/app-version', { cache: 'no-store' })
  if (!res.ok) return null
  const body = (await res.json()) as { buildId?: unknown }
  return typeof body.buildId === 'string' && body.buildId.length > 0 ? body.buildId : null
}

/** Load the new deploy once. A repeated mismatch in the same session does not loop. */
export function reloadForDeployedBuild(deployedBuildId: string): boolean {
  const running = runningBuildId()
  if (!running || deployedBuildId === running) return false
  if (sessionStorage.getItem(RELOAD_KEY) === deployedBuildId) return false
  sessionStorage.setItem(RELOAD_KEY, deployedBuildId)
  const next = new URL(window.location.href)
  next.searchParams.set(UPDATE_PARAM, deployedBuildId)
  window.location.replace(next.toString())
  return true
}

export function stripUpdateParam(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(UPDATE_PARAM)) return
  url.searchParams.delete(UPDATE_PARAM)
  const search = url.searchParams.toString()
  window.history.replaceState(
    window.history.state,
    '',
    url.pathname + (search ? `?${search}` : '') + url.hash,
  )
}
