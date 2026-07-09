namespace KaiFlow.Timesheets.Services;

public static class JobContractorDocumentTypes
{
    public static readonly string[] TypeLabels =
    [
        "Method Statement",
        "Risk Assessment",
        "Permit / Work Order",
        "Completion Certificate",
        "Other"
    ];

    public static readonly string[] TypeKeys =
    [
        "method_statement",
        "risk_assessment",
        "permit",
        "completion_certificate",
        "other"
    ];

    public static string LabelFor(string? key)
    {
        var i = Array.IndexOf(TypeKeys, key ?? "");
        return i >= 0 ? TypeLabels[i] : "Document";
    }

    public static string IconFor(string? key) => key switch
    {
        "method_statement"       => "📋",
        "risk_assessment"        => "⚠️",
        "permit"                 => "🪪",
        "completion_certificate" => "✅",
        _                        => "📄"
    };

    public static FilePickerFileType AllDocFiles => new(new Dictionary<DevicePlatform, IEnumerable<string>>
    {
        { DevicePlatform.WinUI, new[]
          { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".txt" } },
        { DevicePlatform.MacCatalyst, new[] { "public.data", "public.content", "com.adobe.pdf" } },
        { DevicePlatform.iOS,         new[] { "public.data", "public.content", "com.adobe.pdf" } },
        { DevicePlatform.Android, new[]
          { "application/pdf", "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/*", "text/plain" } }
    });

    public static async Task<FileResult?> PickAsync()
        => await FilePicker.PickAsync(new PickOptions
        {
            PickerTitle = "Select contractor document",
            FileTypes   = AllDocFiles
        });
}
