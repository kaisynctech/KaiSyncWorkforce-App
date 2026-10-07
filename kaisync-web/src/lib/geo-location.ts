/**
 * Shared GPS + reverse-geocode helpers for attendance punches.
 *
 * Policy: when GPS exists, we must surface a human place name — never raw
 * coordinates and never a useless "Location recorded" placeholder.
 *
 * Providers (in order): Nominatim → Photon → BigDataCloud.
 * Retries + short in-memory cache respect Nominatim usage limits.
 */

export type CapturedLocation = {
  latitude: number | null
  longitude: number | null
  address: string | null
}

const COORD_ADDRESS_RE = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/
const USER_AGENT = 'KaiSyncWorkforce/1.0 (attendance; https://kaisync.app)'
const CACHE_TTL_MS = 60 * 60 * 1000
const placeCache = new Map<string, { at: number; name: string | null }>()

/** True when a stored "address" is actually raw coordinates. */
export function looksLikeCoordinates(value: string | null | undefined): boolean {
  if (!value) return false
  return COORD_ADDRESS_RE.test(value.trim())
}

/** True when we still need a real place name for display / storage. */
export function needsPlaceName(
  address: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  if (lat == null || lng == null) return false
  const trimmed = address?.trim() || null
  if (!trimmed) return true
  return looksLikeCoordinates(trimmed)
}

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isUsablePlaceName(value: string | null | undefined): value is string {
  const trimmed = value?.trim() || null
  if (!trimmed) return false
  if (looksLikeCoordinates(trimmed)) return false
  if (trimmed.length < 3) return false
  return true
}

async function fromNominatim(lat: number, lng: number): Promise<string | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
    {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en',
        'User-Agent': USER_AGENT,
      },
    },
  )
  if (!res.ok) return null
  const json = (await res.json()) as {
    display_name?: string
    name?: string
    address?: Record<string, string>
  }
  if (isUsablePlaceName(json.display_name)) return json.display_name.trim()
  if (isUsablePlaceName(json.name)) return json.name.trim()
  const a = json.address
  if (a) {
    const parts = [
      a.amenity || a.building || a.shop || a.office,
      a.road || a.pedestrian || a.path,
      a.suburb || a.neighbourhood || a.village || a.town || a.city,
      a.state || a.province,
    ].filter(Boolean)
    const joined = parts.join(', ')
    if (isUsablePlaceName(joined)) return joined
  }
  return null
}

async function fromPhoton(lat: number, lng: number): Promise<string | null> {
  const res = await fetch(
    `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`,
    { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
  )
  if (!res.ok) return null
  const json = (await res.json()) as {
    features?: Array<{ properties?: Record<string, string | number | undefined> }>
  }
  const props = json.features?.[0]?.properties
  if (!props) return null
  const parts = [
    props.name,
    props.street,
    props.housenumber,
    props.city || props.town || props.village || props.locality,
    props.state,
    props.country,
  ]
    .map(p => (p == null ? '' : String(p).trim()))
    .filter(Boolean)
  const joined = parts.join(', ')
  return isUsablePlaceName(joined) ? joined : null
}

async function fromBigDataCloud(lat: number, lng: number): Promise<string | null> {
  const res = await fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
    { headers: { Accept: 'application/json' } },
  )
  if (!res.ok) return null
  const json = (await res.json()) as {
    locality?: string
    city?: string
    principalSubdivision?: string
    countryName?: string
    localityInfo?: { informative?: Array<{ name?: string }> }
  }
  const informative = (json.localityInfo?.informative ?? [])
    .map(x => x.name?.trim())
    .filter((x): x is string => Boolean(x))
  const parts = [
    informative[0],
    json.locality,
    json.city,
    json.principalSubdivision,
    json.countryName,
  ].filter((x): x is string => Boolean(x && x.trim()))
  // de-dupe while preserving order
  const unique: string[] = []
  for (const p of parts) {
    if (!unique.includes(p)) unique.push(p)
  }
  const joined = unique.join(', ')
  return isUsablePlaceName(joined) ? joined : null
}

async function tryProviders(lat: number, lng: number): Promise<string | null> {
  const providers = [fromNominatim, fromPhoton, fromBigDataCloud]
  for (const provider of providers) {
    try {
      const name = await provider(lat, lng)
      if (name) return name
    } catch {
      // try next provider
    }
  }
  return null
}

/**
 * Resolve a human place name for coordinates.
 * Retries across providers. Returns null only if every attempt fails.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const key = cacheKey(lat, lng)
  const hit = placeCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.name) {
    return hit.name
  }

  // Attempt 1 immediate, then 2 retries with backoff (Nominatim rate limits).
  const delays = [0, 1100, 2200]
  for (const delay of delays) {
    if (delay > 0) await sleep(delay)
    const name = await tryProviders(lat, lng)
    if (name) {
      placeCache.set(key, { at: Date.now(), name })
      return name
    }
  }

  placeCache.set(key, { at: Date.now(), name: null })
  return null
}

/**
 * Keep trying until a place name is found or attempts are exhausted.
 * Prefer after punch save (backfill) so clock-in is not blocked on geocode.
 */
export async function reverseGeocodeRequired(
  lat: number,
  lng: number,
  options?: { maxAttempts?: number },
): Promise<string | null> {
  const maxAttempts = options?.maxAttempts ?? 4
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await sleep(1000 * i)
    const name = await reverseGeocode(lat, lng)
    if (name) return name
  }
  return null
}

export type ForwardGeocodeResult = {
  latitude: number
  longitude: number
  displayName: string
}

/**
 * Resolve an address string to coordinates (Nominatim search).
 * Used by Settings → Branch location editor.
 */
export async function forwardGeocode(query: string): Promise<ForwardGeocodeResult | null> {
  const q = query.trim()
  if (q.length < 3) return null

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=0`,
      {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'en',
          'User-Agent': USER_AGENT,
        },
      },
    )
    if (!res.ok) return null
    const json = (await res.json()) as Array<{
      lat?: string
      lon?: string
      display_name?: string
    }>
    const hit = json[0]
    if (!hit?.lat || !hit?.lon) return null
    const latitude = Number(hit.lat)
    const longitude = Number(hit.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
    const displayName = isUsablePlaceName(hit.display_name)
      ? hit.display_name.trim()
      : q
    return { latitude, longitude, displayName }
  } catch {
    return null
  }
}

function getPosition(highAccuracy = true): Promise<GeolocationPosition | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: highAccuracy, timeout: 20000, maximumAge: 0 },
    )
  })
}

/** Best-effort GPS + place name. Never throws. */
export async function captureLocation(): Promise<CapturedLocation> {
  const pos = await getPosition(true)
  if (!pos) return { latitude: null, longitude: null, address: null }
  const latitude = pos.coords.latitude
  const longitude = pos.coords.longitude
  const address = await reverseGeocodeRequired(latitude, longitude)
  return { latitude, longitude, address }
}

export type PunchLocFields = {
  id?: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
}

/**
 * For a list of punches/sessions, resolve missing place names and optionally
 * persist them. Mutates nothing — returns a map of punchId → place name plus
 * in-memory address patches keyed by punch id.
 */
export async function resolveMissingPunchAddresses(
  punches: PunchLocFields[],
  options?: {
    /** Persist resolved names (HR/manager UPDATE or backfill RPC). */
    persist?: (punchId: string, address: string) => Promise<void>
    /** Max unique coordinate lookups this pass (rate-limit friendly). */
    limit?: number
  },
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const limit = options?.limit ?? 25
  let lookups = 0

  for (const punch of punches) {
    if (!punch.id) continue
    if (!needsPlaceName(punch.address, punch.latitude, punch.longitude)) {
      if (punch.address && !looksLikeCoordinates(punch.address)) {
        resolved.set(punch.id, punch.address.trim())
      }
      continue
    }
    if (punch.latitude == null || punch.longitude == null) continue
    if (lookups >= limit) break
    lookups += 1
    const name = await reverseGeocodeRequired(punch.latitude, punch.longitude, { maxAttempts: 2 })
    if (!name) continue
    resolved.set(punch.id, name)
    if (options?.persist) {
      try {
        await options.persist(punch.id, name)
      } catch {
        // display still benefits from in-memory name
      }
    }
    // Be kind to free geocoders when enriching a table of many punches.
    await sleep(350)
  }

  return resolved
}
