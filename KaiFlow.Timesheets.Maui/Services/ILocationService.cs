namespace KaiFlow.Timesheets.Services;

public record GeoPosition(double Latitude, double Longitude, double? Accuracy = null);
public record GeocodeSuggestion(string Address, double Latitude, double Longitude);

public interface ILocationService
{
    Task<GeoPosition?> GetCurrentPositionAsync(bool highAccuracy = true);
    Task<string?> ReverseGeocodeAsync(double latitude, double longitude);
    Task<List<GeocodeSuggestion>> ForwardGeocodeAsync(string address);
    double CalculateDistance(double lat1, double lon1, double lat2, double lon2);
    bool IsWithinRadius(double lat, double lon, double centerLat, double centerLon, double radiusMeters);
}
