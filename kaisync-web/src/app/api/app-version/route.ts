import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Public deploy marker. The open app compares this with the build it loaded. */
export function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? '' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
