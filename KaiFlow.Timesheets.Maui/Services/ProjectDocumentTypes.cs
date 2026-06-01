namespace KaiFlow.Timesheets.Services;

public static class ProjectDocumentTypes
{
    public static readonly string[] TypeLabels = ["Contract", "Quote", "Invoice", "Scope / spec", "Photos", "Client shared", "Other"];
    public static readonly string[] TypeKeys = ["contract", "quote", "invoice", "scope", "photos", "client_upload", "other"];

    public static string LabelFor(string? key)
    {
        var i = Array.IndexOf(TypeKeys, key ?? "");
        return i >= 0 ? TypeLabels[i] : "Document";
    }

    public static FilePickerFileType AllProjectFiles => new(new Dictionary<DevicePlatform, IEnumerable<string>>
    {
        { DevicePlatform.WinUI, new[]
        {
            ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt",
            ".jpg", ".jpeg", ".png", ".webp", ".ppt", ".pptx"
        }},
        { DevicePlatform.MacCatalyst, new[] { "public.data", "public.content", "public.image", "com.adobe.pdf" } },
        { DevicePlatform.iOS, new[] { "public.data", "public.content", "public.image", "com.adobe.pdf" } },
        { DevicePlatform.Android, new[]
        {
            "application/pdf", "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "image/*", "text/plain"
        }}
    });

    public static async Task<FileResult?> PickAsync(string title = "Select project document")
        => await FilePicker.PickAsync(new PickOptions
        {
            PickerTitle = title,
            FileTypes = AllProjectFiles
        });
}
