/**
 * Shared GPS + reverse-geocode helpers for attendance punches.
 */

export type CapturedLocation = {
  latitude: number | null
  longitude: number | null
  address: string | null
}

const COORD_ADDRESS_RE = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/

/** True when a stored "address" is actually raw coordinates. */
export function looksLikeCoordinates(value: string | null | undefined): boolean {
  if (!value) return false
  return COORD_ADDRESS_RE.test(value.trim())
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { Accept: 'application/json', 'Accept-Language': 'en' } },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { display_name?: string }
    const name = json.display_name?.trim() || null
    if (!name || looksLikeCoordinates(name)) return null
    return name
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
      { enableHighAccuracy: highAccuracy, timeout: 15000, maximumAge: 0 },
    )
  })
}

/** Best-effort GPS + place name. Never throws. */
export async function captureLocation(): Promise<CapturedLocation> {
  const pos = await getPosition(true)
  if (!pos) return { latitude: null, longitude: null, address: null }
  const latitude = pos.coords.latitude
  const longitude = pos.coords.longitude
  const address = await reverseGeocode(latitude, longitude)
  return { latitude, longitude, address }
}
