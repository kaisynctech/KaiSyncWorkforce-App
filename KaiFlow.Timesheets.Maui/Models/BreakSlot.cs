using Newtonsoft.Json;

namespace KaiFlow.Timesheets.Models;

public class BreakSlot
{
    [JsonProperty("label")]
    public string Label { get; set; } = "Break";

    [JsonProperty("minutes")]
    public int Minutes { get; set; } = 30;

    [JsonIgnore]
    public string Display => $"{Label}  ·  {Minutes} min";
}
