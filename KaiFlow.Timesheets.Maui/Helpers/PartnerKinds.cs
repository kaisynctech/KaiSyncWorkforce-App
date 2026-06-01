namespace KaiFlow.Timesheets.Helpers;

public static class PartnerKinds
{
    public const string Contractor = "contractor";
    public const string Supplier = "supplier";
    public const string Both = "both";

    public static readonly string[] All = [Contractor, Supplier, Both];

    public static readonly string[] KindLabels = ["Contractor", "Supplier", "Contractor & supplier"];

    public static string LabelFor(string? kind) => (kind ?? Contractor) switch
    {
        Supplier => "Supplier",
        Both => "Contractor & supplier",
        _ => "Contractor"
    };

    public static bool IsSupplierKind(string? kind) =>
        kind is Supplier or Both;

    public static bool IsContractorKind(string? kind) =>
        kind is Contractor or Both;
}
