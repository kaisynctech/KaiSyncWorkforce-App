namespace KaiFlow.Timesheets.Controls;

/// <summary>
/// Result of a <see cref="TableQuery.Apply"/> call — one page of rows plus paging metadata.
/// </summary>
public sealed class TableQueryResult<T>
{
    public required IReadOnlyList<T> Page { get; init; }
    public int TotalCount { get; init; }
    public int TotalPages { get; init; }
    public int PageIndex { get; init; }
    public int PageSize { get; init; }

    public bool CanGoPrevious => PageIndex > 0;
    public bool CanGoNext => PageIndex < TotalPages - 1;

    public string PageSummary
    {
        get
        {
            if (TotalCount == 0) return "No rows";
            var start = PageIndex * PageSize + 1;
            var end = Math.Min(TotalCount, (PageIndex + 1) * PageSize);
            return TotalPages <= 1
                ? $"{TotalCount} row{(TotalCount == 1 ? "" : "s")}"
                : $"{start}–{end} of {TotalCount}";
        }
    }
}

/// <summary>
/// Options for sorting, searching, filtering, and paginating in-memory collections.
/// ViewModels pass domain-specific predicates/selectors; the helper stays UI-agnostic.
/// </summary>
public sealed class TableQueryOptions<T>
{
    public required IEnumerable<T> Source { get; init; }
    public string? SearchText { get; init; }
    public Func<T, string, bool>? MatchesSearch { get; init; }
    public Func<T, bool>? Predicate { get; init; }
    public string? SortKey { get; init; }
    public bool SortAscending { get; init; } = true;
    public Dictionary<string, Func<T, IComparable>> SortSelectors { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public int PageIndex { get; init; }
    public int PageSize { get; init; } = 25;
}

/// <summary>
/// Shared table query engine: filter → search → sort → paginate.
/// </summary>
public static class TableQuery
{
    public static TableQueryResult<T> Apply<T>(TableQueryOptions<T> options)
    {
        var pageSize = Math.Max(1, options.PageSize);
        IEnumerable<T> q = options.Source;

        if (options.Predicate is not null)
            q = q.Where(options.Predicate);

        if (!string.IsNullOrWhiteSpace(options.SearchText) && options.MatchesSearch is not null)
            q = q.Where(item => options.MatchesSearch(item, options.SearchText.Trim()));

        if (!string.IsNullOrWhiteSpace(options.SortKey)
            && options.SortSelectors.TryGetValue(options.SortKey, out var selector))
        {
            q = options.SortAscending
                ? q.OrderBy(selector)
                : q.OrderByDescending(selector);
        }

        var list = q.ToList();
        var total = list.Count;
        var totalPages = total == 0 ? 1 : (int)Math.Ceiling(total / (double)pageSize);
        var pageIndex = Math.Clamp(options.PageIndex, 0, Math.Max(0, totalPages - 1));
        var page = list.Skip(pageIndex * pageSize).Take(pageSize).ToList();

        return new TableQueryResult<T>
        {
            Page = page,
            TotalCount = total,
            TotalPages = totalPages,
            PageIndex = pageIndex,
            PageSize = pageSize,
        };
    }
}
