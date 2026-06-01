using KaiFlow.Timesheets.Helpers;
using Xunit;

namespace KaiFlow.Timesheets.Tests;

public class JobPhotoUrlParserTests
{
    [Fact]
    public void Parse_returns_both_arrays_from_json_object()
    {
        const string json = """
            {
              "photo_urls_before": ["https://a/b1.jpg", "https://a/b2.jpg"],
              "photo_urls_after": ["https://a/a1.jpg"]
            }
            """;

        var (before, after) = JobPhotoUrlParser.Parse(json);

        Assert.Equal(2, before.Count);
        Assert.Equal("https://a/b1.jpg", before[0]);
        Assert.Single(after);
        Assert.Equal("https://a/a1.jpg", after[0]);
    }

    [Fact]
    public void Parse_empty_or_null_returns_empty_lists()
    {
        var (before1, after1) = JobPhotoUrlParser.Parse(null);
        var (before2, after2) = JobPhotoUrlParser.Parse("null");

        Assert.Empty(before1);
        Assert.Empty(after1);
        Assert.Empty(before2);
        Assert.Empty(after2);
    }

    [Fact]
    public void Parse_ignores_blank_urls()
    {
        const string json = """{"photo_urls_before":["","  ","https://ok"],"photo_urls_after":[]}""";

        var (before, _) = JobPhotoUrlParser.Parse(json);

        Assert.Single(before);
        Assert.Equal("https://ok", before[0]);
    }
}
