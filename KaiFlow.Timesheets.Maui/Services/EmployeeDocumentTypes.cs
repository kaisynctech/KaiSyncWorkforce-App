namespace KaiFlow.Timesheets.Services;

internal static class EmployeeDocumentTypes
{
    public static readonly string[] Labels =
    [
        "National ID", "Passport", "Employment Contract", "Tax Certificate",
        "Bank Details", "Medical Certificate", "Other"
    ];

    public static readonly string[] Keys =
    [
        "national_id", "passport", "contract", "tax_certificate",
        "bank_details", "medical_certificate", "other"
    ];

    public static async Task<(string? TypeKey, string? Name)> PickTypeAndNameAsync(
        string promptTitle = "Document Name",
        string submitLabel = "Submit")
    {
        var chosen = await Shell.Current.DisplayActionSheet("Document Type", "Cancel", null, Labels);
        if (chosen == null || chosen == "Cancel") return (null, null);

        var index = Array.IndexOf(Labels, chosen);
        if (index < 0) return (null, null);

        var name = await Shell.Current.DisplayPromptAsync(
            promptTitle, "Enter a label:", submitLabel, "Cancel", placeholder: chosen);
        if (string.IsNullOrWhiteSpace(name)) return (null, null);

        return (Keys[index], name.Trim());
    }

    public static FilePickerFileType SupportedFileTypes => new(new Dictionary<DevicePlatform, IEnumerable<string>>
    {
        { DevicePlatform.WinUI,        new[] { ".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx" } },
        { DevicePlatform.Android,      new[] { "image/*", "application/pdf" } },
        { DevicePlatform.iOS,          new[] { "public.image", "com.adobe.pdf" } },
        { DevicePlatform.MacCatalyst,  new[] { "public.image", "com.adobe.pdf" } }
    });

    public static async Task<FileResult?> PickFileAsync(string pickerTitle)
    {
        return await FilePicker.PickAsync(new PickOptions
        {
            PickerTitle = pickerTitle,
            FileTypes   = SupportedFileTypes
        });
    }
}
