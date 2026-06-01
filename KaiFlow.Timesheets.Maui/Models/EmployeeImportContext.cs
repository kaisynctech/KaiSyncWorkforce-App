namespace KaiFlow.Timesheets.Models;

public class EmployeeImportContext
{
    public IReadOnlyDictionary<string, EmployeeShiftTemplate> TemplatesByName { get; init; }
        = new Dictionary<string, EmployeeShiftTemplate>(StringComparer.OrdinalIgnoreCase);

    public EmployeeShiftTemplate? DefaultTemplate { get; init; }

    public static EmployeeImportContext FromTemplates(IEnumerable<EmployeeShiftTemplate> templates)
    {
        var list = templates.ToList();
        var byName = list
            .Where(t => !string.IsNullOrWhiteSpace(t.Name))
            .GroupBy(t => t.Name.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var defaultTemplate = list.FirstOrDefault(t => t.IsDefault)
            ?? (list.Count == 1 ? list[0] : null);

        return new EmployeeImportContext
        {
            TemplatesByName = byName,
            DefaultTemplate = defaultTemplate
        };
    }
}
