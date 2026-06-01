namespace KaiFlow.Timesheets.Models;

public class EmployeeImportParseResult
{
    public List<Employee> Ready { get; set; } = [];
    public List<string> RowErrors { get; set; } = [];
    public List<string> RowWarnings { get; set; } = [];
    public string? MappingSummary { get; set; }
}
