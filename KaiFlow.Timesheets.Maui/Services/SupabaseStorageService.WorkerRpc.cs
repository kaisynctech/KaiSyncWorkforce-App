using Supabase.Postgrest.Responses;

namespace KaiFlow.Timesheets.Services;

public partial class SupabaseStorageService
{
    /// <summary>RPCs that establish or refresh code-login sessions — never require p_session_token.</summary>
    private static readonly HashSet<string> WorkerSessionExcludedRpcs = new(StringComparer.OrdinalIgnoreCase)
    {
        "employee_resolve_by_code",
        "employee_sign_in_with_code",
        "employee_refresh_code_session",
        "employee_revoke_code_session",
        "employee_validate_session",
        "employee_get_my_memberships_by_code",
        "employee_self_register",
        "get_latest_app_version",
        "list_public_app_versions",
        "log_application_error",
    };

    private static readonly HashSet<string> WorkerSessionPaRpcs = new(StringComparer.OrdinalIgnoreCase)
    {
        "sync_operational_pa_tasks",
        "upsert_employee_pa_settings",
        "enqueue_pa_task_notifications",
    };

    private bool ShouldInjectWorkerSession(string rpcName, Dictionary<string, object> args)
    {
        if (!IsCodeLoginSession() || WorkerSessionExcludedRpcs.Contains(rpcName))
            return false;
        if (rpcName.StartsWith("employee_", StringComparison.OrdinalIgnoreCase))
            return true;
        if (WorkerSessionPaRpcs.Contains(rpcName)
            && args.ContainsKey("p_company_id"))
            return true;
        return false;
    }

    /// <summary>
    /// Central RPC gate for code-login workers: injects p_session_token and emits session telemetry.
    /// HR JWT sessions skip token injection (server validates via auth.uid()).
    /// </summary>
    private async Task<BaseResponse> RpcAsync(string rpcName, Dictionary<string, object> args)
    {
        var isWorkerSession = ShouldInjectWorkerSession(rpcName, args);

        if (isWorkerSession)
        {
            var token = CodeSessionStore.GetSessionToken();
            if (string.IsNullOrWhiteSpace(token))
            {
                _telemetry.LogEvent("worker_session_validation_failed", new Dictionary<string, string>
                {
                    ["rpc"] = rpcName,
                    ["reason"] = "token_missing",
                });
                throw new UnauthorizedAccessException("Worker session token is missing. Sign in again.");
            }

            args["p_session_token"] = token;
        }

        try
        {
            var result = await _supabase.Rpc(rpcName, args);
            if (isWorkerSession)
            {
                _telemetry.LogEvent("worker_session_validation_passed", new Dictionary<string, string>
                {
                    ["rpc"] = rpcName,
                });
            }

            return result;
        }
        catch (Exception ex) when (IsUnauthorizedRpcError(ex))
        {
            if (isWorkerSession)
            {
                _telemetry.LogEvent("worker_session_validation_failed", new Dictionary<string, string>
                {
                    ["rpc"] = rpcName,
                    ["reason"] = "unauthorized",
                    ["error"] = ex.Message,
                });
            }

            throw new UnauthorizedAccessException("Worker session is invalid or expired. Sign in again.", ex);
        }
    }

    private static bool IsUnauthorizedRpcError(Exception ex)
    {
        var msg = ex.Message;
        return msg.Contains("UNAUTHORIZED", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("42501", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("invalid_or_expired", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("session_token_required", StringComparison.OrdinalIgnoreCase);
    }
}
