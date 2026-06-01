using ClosedXML.Excel;
using KaiFlow.Payroll;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Parses employee import spreadsheets (KaiFlow template or custom headers).
/// </summary>
internal static class EmployeeImportParser
{
    private static readonly Dictionary<string, string[]> FieldAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["name"] = ["name", "first name", "firstname", "given name"],
        ["surname"] = ["surname", "last name", "lastname", "family name"],
        ["email"] = ["email", "e-mail", "email address"],
        ["position"] = ["position", "job title", "role", "job"],
        ["employee_code"] = ["employee code", "employee_code", "emp code", "login code", "code"],
        ["id_number"] = ["id number", "id_number", "id", "id no", "identity number", "sa id"],
        ["branch"] = ["branch", "site", "location"],
        ["employment_type"] = ["employment type", "employee type", "type"],
        ["access_level"] = ["access level", "access", "permission", "level"],
        ["hourly_rate"] = ["hourly rate", "hourly"],
        ["daily_rate"] = ["daily rate", "daily"],
        ["monthly_salary"] = ["monthly salary", "salary", "monthly"],
        ["overtime_rate"] = ["overtime rate", "overtime"],
        ["phone"] = ["phone", "mobile", "cell"],
        ["work_days_weekly"] = ["work days weekly", "workdays", "days per week"],
        ["daily_hours"] = ["daily hours", "hours per day"],
        ["employment_date"] = ["employment date", "start date", "date started"],
        ["termination_date"] = ["termination date", "end date", "last day"],
        ["worker_type"] = ["worker type", "worker_type", "worker category"],
        ["pay_basis"] = ["pay basis", "pay_basis", "pay type"],
        ["paye_rate_percent"] = ["paye rate", "paye %", "paye_rate_percent", "paye rate percent"],
        ["uif_exempt"] = ["uif exempt", "uif_exempt", "exempt uif"],
        ["medical_aid_deduction"] = ["medical aid", "medical_aid", "medical aid deduction"],
        ["pension_deduction"] = ["pension", "pension deduction"],
        ["union_deduction"] = ["union", "union deduction"],
        ["time_template"] = ["time template", "time_template", "shift template", "shift_template", "template"],
    };

    public static EmployeeImportParseResult Parse(
        string filePath,
        Guid companyId,
        IReadOnlySet<string> existingLoginIdentifiers,
        EmployeeImportContext? templateContext = null)
    {
        var result = new EmployeeImportParseResult();
        using var wb = new XLWorkbook(filePath);
        var ws = wb.Worksheets.FirstOrDefault(w =>
            w.Name.Equals("Employees", StringComparison.OrdinalIgnoreCase)
            || w.Name.Equals("Sheet1", StringComparison.OrdinalIgnoreCase))
            ?? wb.Worksheets.First();

        var rows = ws.RowsUsed().ToList();
        if (rows.Count < 2)
        {
            result.RowErrors.Add("The file has no employee data rows.");
            return result;
        }

        var headerRowIndex = FindHeaderRowIndex(rows);
        var headerRow = rows[headerRowIndex];
        var headers = headerRow.CellsUsed()
            .Select(c => (Col: c.Address.ColumnNumber, Text: c.GetString().Trim()))
            .Where(h => !string.IsNullOrEmpty(h.Text))
            .ToList();

        if (headers.Count == 0)
        {
            result.RowErrors.Add("Could not find column headers in the spreadsheet.");
            return result;
        }

        var mapping = AutoDetectMapping(headers.Select(h => h.Text).ToList());
        var missing = RequiredFields.Where(f => mapping[f] == null).ToList();
        if (missing.Count > 0)
        {
            result.RowErrors.Add(
                "Could not map required columns: " + string.Join(", ", missing.Select(PrettyFieldName)) +
                ". Use the KaiFlow template or headers like Name, Surname, ID Number, Access Level.");
            return result;
        }

        var colIndex = headers.ToDictionary(h => h.Text, h => h.Col, StringComparer.OrdinalIgnoreCase);
        string Cell(IXLRow row, string field)
        {
            var header = mapping[field];
            if (header == null || !colIndex.TryGetValue(header, out var col)) return "";
            return row.Cell(col).GetString().Trim();
        }

        result.MappingSummary = string.Join(", ", mapping
            .Where(kv => kv.Value != null)
            .Select(kv => $"{PrettyFieldName(kv.Key)}→{kv.Value}"));

        var seenIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var i = headerRowIndex + 1; i < rows.Count; i++)
        {
            var row = rows[i];
            var rowNo = row.RowNumber();
            if (IsNotesOrEmptyRow(row)) continue;

            var name = Cell(row, "name");
            var surname = Cell(row, "surname");
            var email = NullIfEmpty(Cell(row, "email"));
            var position = NullIfEmpty(Cell(row, "position"));
            var employeeCode = NullIfEmpty(Cell(row, "employee_code"));
            var idNumber = NullIfEmpty(Cell(row, "id_number"));
            var branch = NullIfEmpty(Cell(row, "branch"));
            var empTypeRaw = Cell(row, "employment_type");
            var accessRaw = Cell(row, "access_level");
            var workerTypeRaw = NormalizeWorkerType(Cell(row, "worker_type"));
            var phone = NullIfEmpty(Cell(row, "phone"));

            var rowErrors = new List<string>();
            if (string.IsNullOrWhiteSpace(name)) rowErrors.Add("name is required");
            if (string.IsNullOrWhiteSpace(surname)) rowErrors.Add("surname is required");

            var loginId = (employeeCode ?? idNumber)?.Trim();
            if (string.IsNullOrWhiteSpace(loginId))
                rowErrors.Add("employee code or ID number is required");
            else
            {
                var norm = loginId.ToLowerInvariant();
                if (!seenIds.Add(norm))
                    rowErrors.Add("duplicate in file");
                if (existingLoginIdentifiers.Contains(norm))
                    rowErrors.Add("already exists in company");
            }

            var accessLevel = NormalizeAccessLevel(accessRaw);
            if (accessLevel == null)
                rowErrors.Add("access level must be employee, manager, admin, or hr_admin");

            if (rowErrors.Count > 0)
            {
                result.RowErrors.Add($"Row {rowNo}: {string.Join(", ", rowErrors)}");
                continue;
            }

            if (string.IsNullOrEmpty(employeeCode) && !string.IsNullOrEmpty(idNumber))
                employeeCode = idNumber;

            double.TryParse(Cell(row, "hourly_rate"), out var hourlyRate);
            double.TryParse(Cell(row, "daily_rate"), out var dailyRate);
            double.TryParse(Cell(row, "monthly_salary"), out var monthlySalary);
            double.TryParse(Cell(row, "overtime_rate"), out var overtimeRate);
            var workDays = ParseInt(Cell(row, "work_days_weekly"), 5);
            var dailyHoursRaw = Cell(row, "daily_hours");
            var dailyHoursExplicit = !string.IsNullOrWhiteSpace(dailyHoursRaw);
            var dailyHours = dailyHoursExplicit
                ? ParseDouble(dailyHoursRaw, 8)
                : 8;
            var employmentDate = ParseDate(Cell(row, "employment_date")) ?? DateOnly.FromDateTime(DateTime.Today);
            var terminationDate = ParseDate(Cell(row, "termination_date"));
            var payBasisRaw = NullIfEmpty(Cell(row, "pay_basis"));
            double? payeRate = double.TryParse(Cell(row, "paye_rate_percent"), out var payeParsed) ? payeParsed : null;
            var uifExempt = ParseBool(Cell(row, "uif_exempt"));
            double.TryParse(Cell(row, "medical_aid_deduction"), out var medicalAid);
            double.TryParse(Cell(row, "pension_deduction"), out var pension);
            double.TryParse(Cell(row, "union_deduction"), out var union);

            var employmentType = NormalizeEmploymentType(empTypeRaw);
            if (string.IsNullOrEmpty(payBasisRaw))
            {
                var defaults = new EmployeePayrollDefaults();
                EmploymentPayrollDefaults.ApplyForEmploymentType(employmentType, workerTypeRaw, defaults);
                payBasisRaw = defaults.PayBasis;
                if (payeRate == null)
                    payeRate = defaults.PayeRatePercent;
                if (!ParseBoolPresent(Cell(row, "uif_exempt")))
                    uifExempt = defaults.UifExempt;
            }

            EmployeeShiftTemplate? template = null;
            string? templateName = null;
            var timeTemplateRaw = NullIfEmpty(Cell(row, "time_template"));
            if (!string.IsNullOrEmpty(timeTemplateRaw))
            {
                if (templateContext?.TemplatesByName.TryGetValue(timeTemplateRaw, out template) != true)
                {
                    rowErrors.Add($"time template '{timeTemplateRaw}' not found");
                }
                else
                {
                    templateName = template!.Name;
                }
            }
            else if (templateContext?.DefaultTemplate != null)
            {
                template = templateContext.DefaultTemplate;
                templateName = template.Name;
            }
            else if (templateContext != null && templateContext.TemplatesByName.Count > 0)
            {
                result.RowWarnings.Add($"Row {rowNo}: no time template assigned (set a company default or fill time_template)");
            }

            if (rowErrors.Count > 0)
            {
                result.RowErrors.Add($"Row {rowNo}: {string.Join(", ", rowErrors)}");
                continue;
            }

            if (template != null && !dailyHoursExplicit)
                dailyHours = template.PaidHours;

            result.Ready.Add(new Employee
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Name = name,
                Surname = surname,
                Email = email,
                Position = position,
                EmployeeCode = employeeCode,
                IdNumber = idNumber ?? employeeCode,
                Branch = branch,
                Phone = phone,
                EmploymentTypeRaw = employmentType,
                AccessLevelRaw = accessLevel!,
                WorkerTypeRaw = workerTypeRaw,
                PayBasisRaw = payBasisRaw,
                PayeRatePercent = payeRate,
                UifExempt = uifExempt,
                MedicalAidDeduction = medicalAid,
                PensionDeduction = pension,
                UnionDeduction = union,
                TerminationDate = terminationDate,
                HourlyRate = hourlyRate,
                DailyRate = dailyRate,
                MonthlySalary = monthlySalary,
                OvertimeRate = overtimeRate,
                WorkDaysWeekly = workDays,
                DailyHours = dailyHours,
                EmploymentDate = employmentDate,
                ShiftTemplateId = template?.Id,
                ImportTimeTemplateName = templateName,
                IsActive = true,
                RegistrationStatus = "active",
                LoginPasswordReady = false,
            });
        }

        if (result.Ready.Count == 0 && result.RowErrors.Count == 0)
            result.RowErrors.Add("No valid employee rows found.");

        return result;
    }

    private static readonly string[] RequiredFields = ["name", "surname", "access_level"];

    private static int FindHeaderRowIndex(List<IXLRow> rows)
    {
        for (var i = 0; i < Math.Min(5, rows.Count); i++)
        {
            var texts = rows[i].CellsUsed().Select(c => NormalizeHeader(c.GetString())).ToList();
            if (texts.Any(t => t is "name" or "firstname" or "first name")
                && texts.Any(t => t is "surname" or "lastname" or "last name" or "family name"))
                return i;
        }
        return 0;
    }

    private static Dictionary<string, string?> AutoDetectMapping(List<string> headers)
    {
        var byNorm = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var h in headers)
        {
            var norm = NormalizeHeader(h);
            if (!string.IsNullOrEmpty(norm) && !byNorm.ContainsKey(norm))
                byNorm[norm] = h;
        }

        string? Pick(string field)
        {
            foreach (var alias in FieldAliases[field])
            {
                var norm = NormalizeHeader(alias);
                if (byNorm.TryGetValue(norm, out var original))
                    return original;
            }
            return null;
        }

        var map = FieldAliases.Keys.ToDictionary(f => f, f => (string?)null);
        foreach (var field in FieldAliases.Keys)
            map[field] = Pick(field);

        // Require login identifier: id_number or employee_code
        if (map["id_number"] == null && map["employee_code"] == null)
        { /* validated at row level */ }

        return map;
    }

    private static bool IsNotesOrEmptyRow(IXLRow row)
    {
        var first = row.Cell(1).GetString().Trim();
        if (string.IsNullOrEmpty(first)) return true;
        if (first.StartsWith("Valid ", StringComparison.OrdinalIgnoreCase)) return true;
        if (first.Contains("employment type", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static string NormalizeHeader(string value) =>
        string.Concat(value.ToLowerInvariant().Where(char.IsLetterOrDigit));

    private static string? NormalizeAccessLevel(string raw)
    {
        var v = raw.Trim().ToLowerInvariant().Replace(" ", "_");
        return v switch
        {
            "employee" or "staff" or "worker" => "employee",
            "manager" or "supervisor" => "manager",
            "admin" or "administrator" => "admin",
            "hr_admin" or "hradmin" or "hr" => "hr_admin",
            "owner" => "owner",
            "" => null,
            _ => null
        };
    }

    private static string NormalizeWorkerType(string raw)
    {
        var v = raw.Trim().ToLowerInvariant().Replace(" ", "_");
        return v switch
        {
            "contractor" => "contractor",
            "subcontractor" or "sub-contractor" or "sub_contractor" => "subcontractor",
            _ => "employee"
        };
    }

    private static bool ParseBool(string raw) =>
        raw.Trim().Equals("yes", StringComparison.OrdinalIgnoreCase)
        || raw.Trim().Equals("true", StringComparison.OrdinalIgnoreCase)
        || raw.Trim() == "1";

    private static bool ParseBoolPresent(string raw) =>
        !string.IsNullOrWhiteSpace(raw);

    private static string NormalizeEmploymentType(string raw)
    {
        var v = raw.Trim().ToLowerInvariant().Replace(" ", "-");
        return v switch
        {
            "part-time" or "parttime" or "part time" => "part-time",
            "contract" => "contract",
            "student" => "student",
            "" or _ => "permanent"
        };
    }

    private static DateOnly? ParseDate(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (DateOnly.TryParse(raw, out var d)) return d;
        if (DateTime.TryParse(raw, out var dt)) return DateOnly.FromDateTime(dt);
        return null;
    }

    private static int ParseInt(string raw, int fallback) =>
        int.TryParse(raw, out var n) ? n : fallback;

    private static double ParseDouble(string raw, double fallback) =>
        double.TryParse(raw.Replace(',', '.'), System.Globalization.NumberStyles.Any,
            System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : fallback;

    private static string PrettyFieldName(string key) => key switch
    {
        "id_number" => "ID Number",
        "employee_code" => "Employee Code",
        "employment_type" => "Employment Type",
        "access_level" => "Access Level",
        "work_days_weekly" => "Work Days Weekly",
        "daily_hours" => "Daily Hours",
        "employment_date" => "Employment Date",
        "termination_date" => "Termination Date",
        "worker_type" => "Worker Type",
        "pay_basis" => "Pay Basis",
        "paye_rate_percent" => "PAYE Rate %",
        "uif_exempt" => "UIF Exempt",
        "medical_aid_deduction" => "Medical Aid",
        "pension_deduction" => "Pension",
        "union_deduction" => "Union",
        "time_template" => "Time Template",
        _ => char.ToUpper(key[0]) + key[1..].Replace('_', ' ')
    };

    private static string? NullIfEmpty(string s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
