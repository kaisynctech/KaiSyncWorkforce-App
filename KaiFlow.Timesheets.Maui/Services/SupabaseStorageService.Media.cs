namespace KaiFlow.Timesheets.Services;

public partial class SupabaseStorageService
{
    private async Task PrepareWorkerMediaUploadAsync(
        Guid companyId, Guid employeeId, string storagePath, string purpose = "attachment")
    {
        if (!IsCodeLoginSession())
            return;

        await RpcAsync("employee_prepare_media_upload", new Dictionary<string, object>
        {
            ["p_company_id"] = companyId.ToString(),
            ["p_employee_id"] = employeeId.ToString(),
            ["p_storage_path"] = storagePath,
            ["p_purpose"] = purpose,
        });
    }

    private async Task ConsumeWorkerMediaUploadAsync(
        Guid companyId, Guid employeeId, string storagePath)
    {
        if (!IsCodeLoginSession())
            return;

        try
        {
            await RpcAsync("employee_consume_media_upload", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_employee_id"] = employeeId.ToString(),
                ["p_storage_path"] = storagePath,
            });
        }
        catch { /* non-fatal */ }
    }

    private async Task<string> ResolveWorkforceMediaUrlAsync(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return filePath;
        if (filePath.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            return filePath;

        var path = ExtractWorkforceMediaPath(filePath);
        try
        {
            var signed = await _supabase.Storage
                .From("workforce-media")
                .CreateSignedUrl(path, 3600);
            if (!string.IsNullOrWhiteSpace(signed))
                return signed;
        }
        catch { /* fall through */ }

        return BuildWorkforceMediaUrl(path);
    }

    private static string ExtractWorkforceMediaPath(string filePathOrUrl)
    {
        const string marker = "/storage/v1/object/public/workforce-media/";
        const string signedMarker = "/storage/v1/object/sign/workforce-media/";
        if (filePathOrUrl.Contains(marker, StringComparison.OrdinalIgnoreCase))
            return filePathOrUrl[(filePathOrUrl.IndexOf(marker, StringComparison.OrdinalIgnoreCase) + marker.Length)..];
        if (filePathOrUrl.Contains(signedMarker, StringComparison.OrdinalIgnoreCase))
            return filePathOrUrl[(filePathOrUrl.IndexOf(signedMarker, StringComparison.OrdinalIgnoreCase) + signedMarker.Length)..].Split('?')[0];
        return filePathOrUrl.TrimStart('/');
    }
}
