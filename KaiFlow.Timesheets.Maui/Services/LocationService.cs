using KaiFlow.Timesheets.Constants;
using Newtonsoft.Json.Linq;

namespace KaiFlow.Timesheets.Services;

public class LocationService : ILocationService
{
    private static readonly HttpClient _http = new(new System.Net.Http.HttpClientHandler())
    {
        Timeout = TimeSpan.FromSeconds(12)
    };

    // Memory cache keyed by rounded coordinates (5 decimals ≈ 1.1 m)
    private static readonly Dictionary<string, string> _memCache = [];

    private DateTime _lastNominatimCall = DateTime.MinValue;

    // ─── Position ─────────────────────────────────────────────────────────────

    public async Task<GeoPosition?> GetCurrentPositionAsync(bool highAccuracy = true)
    {
        var status = await Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>();
        if (status != PermissionStatus.Granted)
            status = await Permissions.RequestAsync<Permissions.LocationWhenInUse>();
        if (status != PermissionStatus.Granted) return null;

        try
        {
            var req = new GeolocationRequest(
                highAccuracy ? GeolocationAccuracy.Best : GeolocationAccuracy.Medium,
                TimeSpan.FromSeconds(8));
            var loc = await Geolocation.GetLocationAsync(req);
            if (loc != null) return new GeoPosition(loc.Latitude, loc.Longitude, loc.Accuracy);
        }
        catch { }

        try
        {
            var last = await Geolocation.GetLastKnownLocationAsync();
            if (last != null) return new GeoPosition(last.Latitude, last.Longitude, last.Accuracy);
        }
        catch { }

        return null;
    }

    // ─── Reverse geocoding ───────────────────────────────────────────────────

    public async Task<string?> ReverseGeocodeAsync(double latitude, double longitude)
    {
        var key = CacheKey(latitude, longitude);

        // 1. Memory cache
        if (_memCache.TryGetValue(key, out var cached)) return cached;

        // 2. Disk cache
        var disk = Preferences.Get($"geo_{key}", (string?)null);
        if (!string.IsNullOrEmpty(disk))
        {
            _memCache[key] = disk!;
            return disk;
        }

        // 3. Geoapify (primary)
        string? resolved = null;
        if (!string.IsNullOrEmpty(GeoapifyConfig.ApiKey))
            resolved = await TryGeoapifyAsync(latitude, longitude);

        // 4. Nominatim fallback
        if (string.IsNullOrEmpty(resolved))
            resolved = await TryNominatimAsync(latitude, longitude);

        if (!string.IsNullOrEmpty(resolved))
        {
            _memCache[key] = resolved!;
            Preferences.Set($"geo_{key}", resolved);
        }

        return resolved;
    }

    private static async Task<string?> TryGeoapifyAsync(double lat, double lon)
    {
        try
        {
            var url = "https://api.geoapify.com/v1/geocode/reverse" +
                      $"?lat={lat.ToString(System.Globalization.CultureInfo.InvariantCulture)}" +
                      $"&lon={lon.ToString(System.Globalization.CultureInfo.InvariantCulture)}" +
                      "&type=street&format=json" +
                      $"&apiKey={GeoapifyConfig.ApiKey}";

            var json = await _http.GetStringAsync(url);
            if (string.IsNullOrEmpty(json)) return null;

            var obj  = JObject.Parse(json);
            var arr  = obj["results"] as JArray;
            if (arr == null || arr.Count == 0) return null;

            var first = arr[0];

            // Prefer address_line1 + address_line2 (most readable)
            var line1 = first["address_line1"]?.Value<string>()?.Trim();
            var line2 = first["address_line2"]?.Value<string>()?.Trim();
            if (!string.IsNullOrEmpty(line1))
                return string.IsNullOrEmpty(line2) ? line1 : $"{line1}, {line2}";

            // Fall back to full formatted string
            var fmt = first["formatted"]?.Value<string>()?.Trim();
            if (!string.IsNullOrEmpty(fmt)) return fmt;

            // Build from parts
            var parts = new List<string>();
            string s(string k) => first[k]?.Value<string>()?.Trim() ?? "";
            var house  = s("housenumber");
            var street = s("street");
            if (house.Length + street.Length > 0)
                parts.Add((house + " " + street).Trim());
            var sub  = s("suburb");
            var dist = s("district");
            if (sub.Length > 0)  parts.Add(sub);
            else if (dist.Length > 0) parts.Add(dist);
            var city = s("city").Length > 0 ? s("city") : s("town");
            if (city.Length > 0)   parts.Add(city);
            var region = s("state");
            if (region.Length > 0 && region != city) parts.Add(region);
            var country = s("country");
            if (country.Length > 0) parts.Add(country);
            return parts.Count > 0 ? string.Join(", ", parts) : null;
        }
        catch
        {
            return null;
        }
    }

    private async Task<string?> TryNominatimAsync(double lat, double lon)
    {
        var elapsed = DateTime.UtcNow - _lastNominatimCall;
        if (elapsed.TotalMilliseconds < 1100)
            await Task.Delay(1100 - (int)elapsed.TotalMilliseconds);
        _lastNominatimCall = DateTime.UtcNow;

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get,
                $"https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={lat.ToString(System.Globalization.CultureInfo.InvariantCulture)}&lon={lon.ToString(System.Globalization.CultureInfo.InvariantCulture)}&zoom=18&addressdetails=1");
            req.Headers.UserAgent.ParseAdd("KaiFlowTimesheets/1.0 (support@kaisync.app)");
            req.Headers.Accept.ParseAdd("application/json");

            using var resp = await _http.SendAsync(req);
            if (!resp.IsSuccessStatusCode) return null;

            var json = await resp.Content.ReadAsStringAsync();
            if (string.IsNullOrEmpty(json)) return null;

            var obj = JObject.Parse(json);
            var addr = obj["address"] as JObject;
            if (addr != null)
            {
                string s(string k) => addr[k]?.Value<string>()?.Trim() ?? "";
                var house  = s("house_number");
                var road   = s("road");
                var parts  = new List<string>();
                if (house.Length + road.Length > 0)
                    parts.Add((house + " " + road).Trim());
                var sub  = s("suburb").Length > 0 ? s("suburb") : s("neighbourhood");
                if (sub.Length > 0)  parts.Add(sub);
                var city = new[] { "city", "town", "village", "hamlet" }
                           .Select(k => s(k)).FirstOrDefault(v => v.Length > 0) ?? "";
                if (city.Length > 0) parts.Add(city);
                var region  = s("state");
                if (region.Length > 0 && region != city) parts.Add(region);
                var country = s("country");
                if (country.Length > 0) parts.Add(country);
                if (parts.Count > 0) return string.Join(", ", parts);
            }

            return obj["display_name"]?.Value<string>()?.Trim();
        }
        catch
        {
            return null;
        }
    }

    // ─── Forward geocoding ───────────────────────────────────────────────────

    public async Task<List<GeocodeSuggestion>> ForwardGeocodeAsync(string address)
    {
        if (string.IsNullOrWhiteSpace(address)) return [];
        try
        {
            var url = "https://api.geoapify.com/v1/geocode/search" +
                      $"?text={Uri.EscapeDataString(address)}&format=json&limit=5" +
                      $"&apiKey={GeoapifyConfig.ApiKey}";

            var json = await _http.GetStringAsync(url);
            if (string.IsNullOrEmpty(json)) return [];

            var obj     = JObject.Parse(json);
            var results = obj["results"] as JArray;
            if (results == null) return [];

            var list = new List<GeocodeSuggestion>();
            foreach (var item in results)
            {
                var latVal = item["lat"]?.Value<double?>();
                var lonVal = item["lon"]?.Value<double?>();
                if (latVal == null || lonVal == null) continue;

                var line1 = item["address_line1"]?.Value<string>()?.Trim();
                var line2 = item["address_line2"]?.Value<string>()?.Trim();
                var fmt   = string.IsNullOrEmpty(line1)
                    ? item["formatted"]?.Value<string>()?.Trim() ?? address
                    : (string.IsNullOrEmpty(line2) ? line1 : $"{line1}, {line2}");

                list.Add(new GeocodeSuggestion(fmt, latVal.Value, lonVal.Value));
            }
            return list;
        }
        catch { return []; }
    }

    // ─── Distance helpers ────────────────────────────────────────────────────

    public double CalculateDistance(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6371000;
        var dLat = ToRad(lat2 - lat1);
        var dLon = ToRad(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(ToRad(lat1)) * Math.Cos(ToRad(lat2)) *
                Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    public bool IsWithinRadius(double lat, double lon, double cLat, double cLon, double radiusM)
        => CalculateDistance(lat, lon, cLat, cLon) <= radiusM;

    private static string CacheKey(double lat, double lon)
        => $"{lat:F5}_{lon:F5}";

    private static double ToRad(double d) => d * Math.PI / 180;
}
