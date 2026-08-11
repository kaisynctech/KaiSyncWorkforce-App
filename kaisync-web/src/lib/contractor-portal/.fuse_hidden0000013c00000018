/**
 * Browser geolocation + reverse geocode for contractor site visits.
 * Mirrors MAUI CaptureLocationAsync (nulls on failure — GPS is best-effort).
 */

export type CapturedLocation = {
  latitude: number | null
  longitude: number | null
  address: string | null
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

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { Accept: 'application/json', 'Accept-Language': 'en' } },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { display_name?: string }
    return json.display_name?.trim() || null
  } catch {
    return null
  }
}

/** Best-effort GPS + address. Never throws. */
export async function captureLocation(): Promise<CapturedLocation> {
  const pos = await getPosition(true)
  if (!pos) return { latitude: null, longitude: null, address: null }
  const latitude = pos.coords.latitude
  const longitude = pos.coords.longitude
  const address = await reverseGeocode(latitude, longitude)
  return { latitude, longitude, address }
}
