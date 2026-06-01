using KaiFlow.Timesheets.Models;
using Newtonsoft.Json;

namespace KaiFlow.Timesheets.Helpers;

public record PayrollAuditEntry(DateTime At, string Action, string? By, string? Detail);

public static class PayrollAuditHelper
{
    public static void Append(PaymentApproval payment, string action, string? by = null, string? detail = null)
    {
        var entries = Deserialize(payment.AuditLogJson);
        entries.Add(new PayrollAuditEntry(DateTime.UtcNow, action, by, detail));
        payment.AuditLogJson = JsonConvert.SerializeObject(entries);
    }

    public static IReadOnlyList<PayrollAuditEntry> Read(PaymentApproval payment) =>
        Deserialize(payment.AuditLogJson);

    private static List<PayrollAuditEntry> Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonConvert.DeserializeObject<List<PayrollAuditEntry>>(json) ?? [];
        }
        catch
        {
            return [];
        }
    }
}
