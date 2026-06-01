namespace KaiFlow.Timesheets.Models;

public record PagedResult<T>(
    List<T> Items,
    int TotalCount,
    int Page,
    int PageSize)
{
    public bool HasNextPage => (Page * PageSize) < TotalCount;
    public bool HasPreviousPage => Page > 1;
    public int TotalPages => (int)Math.Ceiling((double)TotalCount / PageSize);
}
