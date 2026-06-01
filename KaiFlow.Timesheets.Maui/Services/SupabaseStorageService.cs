using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

public partial class SupabaseStorageService : IStorageService
{
    private static readonly SemaphoreSlim InitGate = new(1, 1);
    private readonly Supabase.Client _supabase;
    private readonly RealtimeService _realtime;
    private readonly AppTelemetry _telemetry;
    private readonly TimesheetStateService _state;

    public SupabaseStorageService(
        Supabase.Client supabase,
        RealtimeService realtime,
        AppTelemetry telemetry,
        TimesheetStateService state)
    {
        _supabase = supabase;
        _realtime = realtime;
        _telemetry = telemetry;
        _state = state;
    }

    // ─── Auth ────────────────────────────────────────────────────────────────

    public async Task InitializeSessionAsync()
    {
        await InitGate.WaitAsync().ConfigureAwait(false);
        try
        {
            await _supabase.InitializeAsync().ConfigureAwait(false);
            // If the loaded token is already expired, sign out immediately so
            // subsequent anon calls (e.g. employee code login) don't get PGRST303.
            var token = _supabase.Auth.CurrentSession?.AccessToken;
            if (token != null && IsJwtExpired(token))
                await _supabase.Auth.SignOut().ConfigureAwait(false);
        }
        finally
        {
            InitGate.Release();
        }
    }

    private static bool IsJwtExpired(string jwt)
    {
        try
        {
            var parts = jwt.Split('.');
            if (parts.Length != 3) return true;
            var payload = parts[1].PadRight(parts[1].Length + (4 - parts[1].Length % 4) % 4, '=');
            var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(payload));
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("exp", out var expEl))
                return DateTimeOffset.FromUnixTimeSeconds(expEl.GetInt64()).UtcDateTime <= DateTime.UtcNow;
        }
        catch { }
        return false;
    }

    /// <summary>Field workers sign in with employee code (anon + RPC), not Supabase JWT.</summary>
    private bool IsCodeLoginSession()
        => string.IsNullOrEmpty(_supabase.Auth.CurrentSession?.User?.Id);

    public async Task<Employee?> SignInAsync(string email, string password)
    {
        await _supabase.Auth.SignIn(email, password);
        return await GetCurrentEmployeeAsync();
    }

    public async Task<Employee?> SignInWithOtpAsync(string email, string otp)
    {
        await _supabase.Auth.VerifyOTP(email, otp, Supabase.Gotrue.Constants.EmailOtpType.MagicLink);
        return await GetCurrentEmployeeAsync();
    }

    public async Task SendOtpAsync(string email)
    {
        await _supabase.Auth.SignIn(Supabase.Gotrue.Constants.SignInType.Email, email);
    }

    public async Task SignOutAsync()
    {
        var token = CodeSessionStore.GetSessionToken();
        if (!string.IsNullOrWhiteSpace(token))
        {
            try
            {
                await _supabase.Rpc("employee_revoke_code_session", new Dictionary<string, object>
                {
                    ["p_session_token"] = token
                });
            }
            catch { /* ignore */ }
        }

        CodeSessionStore.Clear();
        await _supabase.Auth.SignOut();
    }

    public async Task<Employee?> GetCurrentEmployeeAsync()
    {
        var user = _supabase.Auth.CurrentUser;
        if (user == null) return null;

        var result = await _supabase
            .From<Employee>()
            .Filter("user_id", Supabase.Postgrest.Constants.Operator.Equals, user.Id!)
            .Get();

        return result.Models.FirstOrDefault();
    }

    public async Task<Employee?> GetEmployeeForCompanyAsync(Guid companyId)
    {
        var user = _supabase.Auth.CurrentUser;
        if (user != null)
        {
            var result = await _supabase
                .From<Employee>()
                .Filter("user_id", Supabase.Postgrest.Constants.Operator.Equals, user.Id!)
                .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
                .Get();

            return result.Models.FirstOrDefault();
        }

        var session = await RefreshCodeSessionAsync();
        if (session?.Employee.CompanyId == companyId)
            return session.Employee;

        return null;
    }

    private async Task<Guid?> ResolveCodeLoginEmployeeIdAsync()
    {
        if (_supabase.Auth.CurrentUser != null)
            return null;

        var session = await RefreshCodeSessionAsync();
        return session?.Employee.Id;
    }

    public async Task EnsureOwnerAccessLevelAsync(Employee employee, Company company)
    {
        var user = _supabase.Auth.CurrentUser;
        if (user == null) return;
        if (company.OwnerUserId == null) return;

        if (company.OwnerUserId?.ToString() == user.Id && employee.AccessLevelRaw != "owner")
        {
            employee.AccessLevelRaw = "owner";
            await _supabase.From<Employee>().Update(employee);
        }
    }

    public async Task<Dictionary<string, bool>> GetMyPermissionsAsync(Guid companyId)
    {
        var result = await _supabase.Rpc("my_permissions", new Dictionary<string, object>
        {
            ["p_company_id"] = companyId.ToString()
        });

        var map = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(result.Content) || result.Content == "null")
            return map;

        var rows = System.Text.Json.JsonSerializer.Deserialize<List<System.Text.Json.JsonElement>>(result.Content);
        if (rows == null) return map;

        foreach (var row in rows)
        {
            if (!row.TryGetProperty("permission_key", out var keyEl)) continue;
            var key = keyEl.GetString();
            if (string.IsNullOrWhiteSpace(key)) continue;
            var allowed = row.TryGetProperty("allowed", out var allowEl) && allowEl.GetBoolean();
            map[key] = allowed;
        }

        return map;
    }

    public async Task<Employee?> GetEmployeeByCodeAsync(string companyCode, string employeeCode)
    {
        var session = await ResolveCodeLoginAsync(companyCode, employeeCode);
        return session?.Employee;
    }

    private async Task<CodeLoginResult?> ResolveCodeLoginAsync(string companyCode, string employeeCode)
    {
        if (string.IsNullOrWhiteSpace(companyCode) || string.IsNullOrWhiteSpace(employeeCode))
            return null;

        var rows = await _supabase.Rpc("employee_resolve_by_code", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_employee_code"] = employeeCode.Trim()
        });

        var content = rows?.Content;
        if (string.IsNullOrEmpty(content)) return null;

        var list = System.Text.Json.JsonSerializer.Deserialize<List<System.Text.Json.JsonElement>>(content);
        if (list == null || list.Count == 0) return null;

        var row = list[0];
        Guid? userId = null;
        if (row.TryGetProperty("emp_user_id", out var uidEl) && uidEl.ValueKind == System.Text.Json.JsonValueKind.String)
            userId = Guid.TryParse(uidEl.GetString(), out var g) ? g : (Guid?)null;

        var employee = new Employee
        {
            Id = row.TryGetProperty("employee_id", out var eid) ? Guid.Parse(eid.GetString()!) : Guid.Empty,
            UserId = userId,
            EmployeeCode = row.TryGetProperty("employee_code", out var ec) ? ec.GetString() : null,
            Name = row.TryGetProperty("emp_name", out var n) ? n.GetString() ?? "" : "",
            Surname = row.TryGetProperty("emp_surname", out var s) ? s.GetString() ?? "" : "",
            Position = row.TryGetProperty("emp_position", out var pos) ? pos.GetString() : null,
            Branch = row.TryGetProperty("emp_branch", out var br) ? br.GetString() : null,
            AccessLevelRaw = row.TryGetProperty("access_level", out var al) ? al.GetString() ?? "employee" : "employee",
            CompanyId = row.TryGetProperty("company_id", out var cid) ? Guid.Parse(cid.GetString()!) : Guid.Empty,
            LoginPasswordReady = row.TryGetProperty("login_password_ready", out var lpr) && lpr.GetBoolean(),
            RegistrationStatus = row.TryGetProperty("registration_status", out var rs) ? rs.GetString() ?? "active" : "active",
            IsActive = !row.TryGetProperty("is_active", out var ia) || ia.GetBoolean()
        };

        var company = new Company
        {
            Id = employee.CompanyId,
            Code = row.TryGetProperty("company_code", out var cc) ? cc.GetString() ?? "" : "",
            Name = row.TryGetProperty("company_name", out var cn) ? cn.GetString() ?? "" : ""
        };

        var memberships = ParseMembershipList(
            (await _supabase.Rpc("employee_get_my_memberships_by_code", new Dictionary<string, object>
            {
                ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
                ["p_employee_code"] = employeeCode.Trim()
            })).Content);

        return new CodeLoginResult
        {
            Employee = employee,
            Company = company,
            Memberships = memberships
        };
    }

    public async Task<CodeLoginResult?> SignInWithCodeAsync(string companyCode, string employeeCode)
    {
        if (string.IsNullOrWhiteSpace(companyCode) || string.IsNullOrWhiteSpace(employeeCode))
            return null;

        var result = await _supabase.Rpc("employee_sign_in_with_code", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_employee_code"] = employeeCode.Trim()
        });

        var parsed = ParseCodeLoginResult(result?.Content);
        if (parsed == null) return null;

        CodeSessionStore.Save(companyCode, employeeCode, parsed.SessionToken);
        _telemetry.LogSuccess("code_login", nameof(SignInWithCodeAsync), new Dictionary<string, string>
        {
            ["company_code"] = companyCode,
        });
        return parsed;
    }

    public async Task<CodeLoginResult?> RefreshCodeSessionAsync()
    {
        var token = CodeSessionStore.GetSessionToken();
        if (!string.IsNullOrWhiteSpace(token))
        {
            try
            {
                var result = await _supabase.Rpc("employee_refresh_code_session", new Dictionary<string, object>
                {
                    ["p_session_token"] = token
                });
                var parsed = ParseCodeLoginResult(result?.Content);
                if (parsed != null)
                {
                    // Token binding (C3 hardening): confirm the session token is bound to the
                    // resolved company+employee server-side before trusting the restored session.
                    var bound = await ValidateCodeSessionAsync(
                        parsed.Employee.CompanyId, parsed.Employee.Id, parsed.SessionToken);
                    if (!bound)
                    {
                        _telemetry.LogWarning("worker_session_invalid", nameof(RefreshCodeSessionAsync),
                            new Dictionary<string, string>
                            {
                                ["company_id"] = parsed.Employee.CompanyId.ToString(),
                                ["employee_id"] = parsed.Employee.Id.ToString(),
                                ["reason"] = "token_binding_failed",
                            });
                        CodeSessionStore.Clear();
                        return null;
                    }

                    var creds = CodeSessionStore.GetCredentials();
                    if (creds.HasValue)
                        CodeSessionStore.Save(creds.Value.CompanyCode, creds.Value.EmployeeCode, parsed.SessionToken);
                    _telemetry.LogSuccess("code_session_refreshed", nameof(RefreshCodeSessionAsync));
                    return parsed;
                }
                _telemetry.LogWarning("code session refresh returned empty", nameof(RefreshCodeSessionAsync));
            }
            catch (Exception ex)
            {
                _telemetry.LogWarning(
                    "employee_refresh_code_session failed; will re-sign-in",
                    context: nameof(RefreshCodeSessionAsync),
                    properties: new Dictionary<string, string> { ["error"] = ex.Message });
            }
        }

        var codes = CodeSessionStore.GetCredentials();
        if (!codes.HasValue) return null;
        return await SignInWithCodeAsync(codes.Value.CompanyCode, codes.Value.EmployeeCode);
    }

    /// <summary>
    /// Server-side token-binding check (C3 hardening). Confirms the session token is bound
    /// to the given company+employee and is active/unexpired. <b>Fails open</b>: if the
    /// validation RPC is unavailable (e.g. migration not yet deployed) it returns true so
    /// existing sessions are never locked out — it only returns false on an explicit
    /// server "false".
    /// </summary>
    public async Task<bool> ValidateCodeSessionAsync(Guid companyId, Guid employeeId, string sessionToken)
    {
        if (string.IsNullOrWhiteSpace(sessionToken)) return false;
        try
        {
            var result = await _supabase.Rpc("employee_validate_session", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_employee_id"] = employeeId.ToString(),
                ["p_session_token"] = sessionToken,
            });
            var content = result?.Content?.Trim();
            if (string.IsNullOrWhiteSpace(content)) return true; // fail open
            return content.Equals("true", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex)
        {
            // Fail open on transport/availability errors to preserve login UX.
            _telemetry.LogWarning("employee_validate_session unavailable", nameof(ValidateCodeSessionAsync),
                new Dictionary<string, string> { ["error"] = ex.Message });
            return true;
        }
    }

    private static CodeLoginResult? ParseCodeLoginResult(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content == "null") return null;

        var root = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(content);
        if (root.ValueKind != System.Text.Json.JsonValueKind.Object) return null;

        var employeeEl = root.GetProperty("employee");
        var companyEl = root.GetProperty("company");

        Guid? userId = null;
        if (employeeEl.TryGetProperty("user_id", out var uidEl)
            && uidEl.ValueKind == System.Text.Json.JsonValueKind.String
            && Guid.TryParse(uidEl.GetString(), out var uid))
            userId = uid;

        var employee = new Employee
        {
            Id = Guid.Parse(employeeEl.GetProperty("id").GetString()!),
            CompanyId = Guid.Parse(employeeEl.GetProperty("company_id").GetString()!),
            UserId = userId,
            Name = employeeEl.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "",
            Surname = employeeEl.TryGetProperty("surname", out var s) ? s.GetString() ?? "" : "",
            Position = employeeEl.TryGetProperty("position", out var p) ? p.GetString() : null,
            Branch = employeeEl.TryGetProperty("branch", out var b) ? b.GetString() : null,
            AccessLevelRaw = employeeEl.TryGetProperty("access_level", out var al) ? al.GetString() ?? "employee" : "employee",
            EmployeeCode = employeeEl.TryGetProperty("employee_code", out var ec) ? ec.GetString() : null,
            RegistrationStatus = employeeEl.TryGetProperty("registration_status", out var rs) ? rs.GetString() ?? "active" : "active",
            IsActive = !employeeEl.TryGetProperty("is_active", out var ia) || ia.GetBoolean(),
            LoginPasswordReady = employeeEl.TryGetProperty("login_password_ready", out var lpr) && lpr.GetBoolean()
        };

        var company = new Company
        {
            Id = Guid.Parse(companyEl.GetProperty("id").GetString()!),
            Code = companyEl.TryGetProperty("code", out var cc) ? cc.GetString() ?? "" : "",
            Name = companyEl.TryGetProperty("name", out var cn) ? cn.GetString() ?? "" : ""
        };

        var memberships = new List<EmployeeMembership>();
        if (root.TryGetProperty("memberships", out var memEl) && memEl.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var item in memEl.EnumerateArray())
                memberships.Add(ParseMembership(item));
        }

        var sessionToken = root.TryGetProperty("session_token", out var tok)
            ? tok.GetString() ?? ""
            : "";

        return new CodeLoginResult
        {
            SessionToken = sessionToken,
            Employee = employee,
            Company = company,
            Memberships = memberships
        };
    }

    private static List<EmployeeMembership> ParseMembershipList(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content == "null")
            return [];

        var arr = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement[]>(content) ?? [];
        return arr.Select(ParseMembership).ToList();
    }

    public async Task<Company?> GetCurrentCompanyAsync(Guid companyId)
    {
        var result = await _supabase
            .From<Company>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Get();
        return result.Models.FirstOrDefault();
    }

    public async Task SendPasswordResetEmailAsync(string email)
    {
        await _supabase.Auth.ResetPasswordForEmail(email.Trim().ToLowerInvariant());
    }

    public async Task ChangePasswordAsync(string newPassword)
    {
        await _supabase.Auth.Update(new Supabase.Gotrue.UserAttributes { Password = newPassword });
    }

    public async Task TransferOwnershipAsync(Guid companyId, Guid targetEmployeeId)
    {
        var empResult = await _supabase
            .From<Employee>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, targetEmployeeId.ToString())
            .Get();
        var target = empResult.Models.FirstOrDefault();
        if (target?.UserId == null) return;

        var compResult = await _supabase
            .From<Company>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Get();
        var company = compResult.Models.FirstOrDefault();
        if (company == null) return;

        company.OwnerUserId = target.UserId;
        await _supabase.From<Company>().Update(company);

        target.AccessLevelRaw = "owner";
        await _supabase.From<Employee>().Update(target);
    }

    public async Task<bool> SendHrRegistrationOtpAsync(string email, string password)
    {
        try
        {
            await _supabase.Auth.SignUp(email, password);
            return true; // New/unconfirmed user — OTP sent
        }
        catch
        {
            // Email already exists with a confirmed account — try signing in directly
            try
            {
                await _supabase.Auth.SignIn(email, password);
                return false; // Already authenticated — no OTP needed, caller skips to company setup
            }
            catch
            {
                throw new Exception("This email is already registered. Sign in with your password, or use Forgot Password if you need to reset it.");
            }
        }
    }

    public async Task<bool> IsAuthenticatedAsync()
        => _supabase.Auth.CurrentUser != null;

    public Task<string?> GetCurrentUserEmailAsync()
        => Task.FromResult(_supabase.Auth.CurrentUser?.Email);

    public async Task<bool> HasCompanyAsync()
    {
        var user = _supabase.Auth.CurrentUser;
        if (user == null) return false;
        var result = await _supabase
            .From<Models.CompanyRelationship>()
            .Filter("user_id", Supabase.Postgrest.Constants.Operator.Equals, user.Id!)
            .Filter("is_active", Supabase.Postgrest.Constants.Operator.Equals, "true")
            .Get();
        return result.Models.Count > 0;
    }

    public async Task VerifyHrRegistrationOtpAsync(string email, string otp)
    {
        var token = new string(otp.Where(char.IsDigit).ToArray());
        // Try Signup OTP first (new/unconfirmed user), then MagicLink (returning confirmed user).
        foreach (var type in new[]
        {
            Supabase.Gotrue.Constants.EmailOtpType.Signup,
            Supabase.Gotrue.Constants.EmailOtpType.MagicLink,
            Supabase.Gotrue.Constants.EmailOtpType.Email,
        })
        {
            try
            {
                await _supabase.Auth.VerifyOTP(email, token, type);
                return;
            }
            catch { }
        }
        throw new Exception("The verification code is incorrect or has expired. Please request a new one.");
    }

    public async Task SetPasswordAsync(string password)
    {
        await _supabase.Auth.Update(new Supabase.Gotrue.UserAttributes { Password = password });
    }

    public async Task<(Guid companyId, string companyCode)> SelfRegisterCompanyAsync(
        string companyName, string ownerFirstName, string ownerLastName, string role = "owner")
    {
        var rows = await _supabase.Rpc("self_register_company", new Dictionary<string, object>
        {
            ["p_company_name"] = companyName.Trim(),
            ["p_owner_first_name"] = ownerFirstName.Trim(),
            ["p_owner_last_name"] = ownerLastName.Trim(),
            ["p_role"] = role
        });

        var content = rows?.Content;
        if (string.IsNullOrEmpty(content)) throw new Exception("Company registration failed.");

        var json = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(content);
        // RETURNS TABLE sends a JSON array; unwrap the first row.
        var row = json.ValueKind == System.Text.Json.JsonValueKind.Array ? json[0] : json;
        var companyId = Guid.Parse(row.GetProperty("company_id").GetString()!);
        var companyCode = row.GetProperty("company_code").GetString()!;
        return (companyId, companyCode);
    }

    public async Task<List<Company>> GetUserCompaniesAsync()
    {
        var user = _supabase.Auth.CurrentUser;
        if (user == null) return [];

        var userId = user.Id!;
        var rels = await _supabase
            .From<CompanyRelationship>()
            .Filter("user_id", Supabase.Postgrest.Constants.Operator.Equals, userId)
            .Filter("is_active", Supabase.Postgrest.Constants.Operator.Equals, "true")
            .Get();

        var companies = new List<Company>();
        foreach (var rel in rels.Models)
        {
            var company = await GetCurrentCompanyAsync(rel.CompanyId);
            if (company != null) companies.Add(company);
        }
        return companies;
    }

    public async Task<List<EmployeeMembership>> GetMyMembershipsAsync()
    {
        var user = _supabase.Auth.CurrentUser;
        if (user != null)
        {
            var result = await _supabase.Rpc("employee_get_my_memberships", new Dictionary<string, object>
            {
                ["p_user_id"] = user.Id!
            });

            if (!string.IsNullOrWhiteSpace(result.Content) && result.Content != "null")
                return ParseMembershipList(result.Content);
        }

        var codes = CodeSessionStore.GetCredentials();
        if (codes.HasValue)
        {
            var result = await _supabase.Rpc("employee_get_my_memberships_by_code", new Dictionary<string, object>
            {
                ["p_company_code"] = codes.Value.CompanyCode,
                ["p_employee_code"] = codes.Value.EmployeeCode
            });

            if (!string.IsNullOrWhiteSpace(result.Content) && result.Content != "null")
                return ParseMembershipList(result.Content);
        }

        var refreshed = await RefreshCodeSessionAsync();
        return refreshed?.Memberships ?? [];
    }

    public async Task<List<AppNotification>> GetMyNotificationsAsync(Guid? employeeId = null)
    {
        var user = _supabase.Auth.CurrentUser;
        if (user != null)
        {
            var result = await _supabase.Rpc("employee_get_my_notifications", new Dictionary<string, object>
            {
                ["p_user_id"] = user.Id!
            });

            if (string.IsNullOrWhiteSpace(result.Content) || result.Content == "null")
                return [];

            return Newtonsoft.Json.JsonConvert.DeserializeObject<List<AppNotification>>(result.Content) ?? [];
        }

        employeeId ??= await ResolveCodeLoginEmployeeIdAsync();
        if (!employeeId.HasValue)
            return [];

        try
        {
            var result = await _supabase.Rpc("employee_get_my_notifications_for_employee", new Dictionary<string, object>
            {
                ["p_employee_id"] = employeeId.Value.ToString()
            });

            if (string.IsNullOrWhiteSpace(result.Content) || result.Content == "null")
                return [];

            return Newtonsoft.Json.JsonConvert.DeserializeObject<List<AppNotification>>(result.Content) ?? [];
        }
        catch
        {
            return [];
        }
    }

    public async Task MarkNotificationReadAsync(long notificationId, Guid? employeeId = null)
    {
        var user = _supabase.Auth.CurrentUser;
        if (user != null)
        {
            await _supabase.Rpc("employee_mark_notification_read", new Dictionary<string, object>
            {
                ["p_user_id"] = user.Id!,
                ["p_notification_id"] = notificationId
            });
            return;
        }

        employeeId ??= await ResolveCodeLoginEmployeeIdAsync();
        if (!employeeId.HasValue)
            return;

        try
        {
            await _supabase.Rpc("employee_mark_notification_read_for_employee", new Dictionary<string, object>
            {
                ["p_employee_id"] = employeeId.Value.ToString(),
                ["p_notification_id"] = notificationId
            });
        }
        catch
        {
            /* non-blocking */
        }
    }

    private static EmployeeMembership ParseMembership(System.Text.Json.JsonElement el)
    {
        static Guid ReqGuid(System.Text.Json.JsonElement e, string key) =>
            Guid.Parse(e.GetProperty(key).GetString()!);
        static string ReqStr(System.Text.Json.JsonElement e, string key) =>
            e.GetProperty(key).GetString() ?? "";

        return new EmployeeMembership
        {
            EmployeeId = ReqGuid(el, "employee_id"),
            CompanyId = ReqGuid(el, "company_id"),
            RegistrationStatus = ReqStr(el, "registration_status"),
            IsActive = el.TryGetProperty("is_active", out var a) && a.GetBoolean(),
            Name = ReqStr(el, "name"),
            Surname = ReqStr(el, "surname"),
            Position = el.TryGetProperty("position", out var p) && p.ValueKind != System.Text.Json.JsonValueKind.Null
                ? p.GetString() : null,
            Branch = el.TryGetProperty("branch", out var b) && b.ValueKind != System.Text.Json.JsonValueKind.Null
                ? b.GetString() : null,
            AccessLevel = el.TryGetProperty("access_level", out var al) ? al.GetString() ?? "employee" : "employee",
            CompanyName = ReqStr(el, "company_name"),
            CompanyCode = ReqStr(el, "company_code")
        };
    }

    // ─── Shift Templates ─────────────────────────────────────────────────────

    public async Task<List<EmployeeShiftTemplate>> GetShiftTemplatesAsync(Guid companyId)
    {
        var json = await _supabase.Rpc("get_employee_shift_templates",
            new Dictionary<string, object> { ["p_company_id"] = companyId });
        if (string.IsNullOrWhiteSpace(json.Content)) return [];
        var list = Newtonsoft.Json.JsonConvert.DeserializeObject<List<EmployeeShiftTemplate>>(json.Content);
        return list ?? [];
    }

    public async Task<EmployeeShiftTemplate> CreateShiftTemplateAsync(EmployeeShiftTemplate template)
    {
        var breaksArray = Newtonsoft.Json.Linq.JArray.FromObject(template.Breaks ?? []);
        var json = await _supabase.Rpc("hr_upsert_shift_template", new Dictionary<string, object>
        {
            ["p_company_id"]    = template.CompanyId,
            ["p_id"]            = null!,
            ["p_name"]          = template.Name,
            ["p_start_time"]    = template.StartTimeRaw,
            ["p_end_time"]      = template.EndTimeRaw,
            ["p_break_minutes"] = template.BreakMinutes,
            ["p_breaks"]        = breaksArray
        });
        var result = Newtonsoft.Json.JsonConvert.DeserializeObject<EmployeeShiftTemplate>(json.Content ?? "{}");
        return result ?? template;
    }

    public async Task<EmployeeShiftTemplate> UpdateShiftTemplateAsync(EmployeeShiftTemplate template)
    {
        var breaksArray = Newtonsoft.Json.Linq.JArray.FromObject(template.Breaks ?? []);
        await _supabase.Rpc("hr_upsert_shift_template", new Dictionary<string, object>
        {
            ["p_company_id"]    = template.CompanyId,
            ["p_id"]            = template.Id,
            ["p_name"]          = template.Name,
            ["p_start_time"]    = template.StartTimeRaw,
            ["p_end_time"]      = template.EndTimeRaw,
            ["p_break_minutes"] = template.BreakMinutes,
            ["p_breaks"]        = breaksArray
        });
        return template;
    }

    public async Task<EmployeeShiftTemplate> SetDefaultShiftTemplateAsync(Guid companyId, Guid templateId)
    {
        var json = await _supabase.Rpc("hr_set_default_shift_template", new Dictionary<string, object>
        {
            ["p_company_id"]  = companyId,
            ["p_template_id"] = templateId
        });
        var result = Newtonsoft.Json.JsonConvert.DeserializeObject<EmployeeShiftTemplate>(json.Content ?? "{}");
        return result ?? throw new InvalidOperationException("Could not set default time template.");
    }

    public async Task DeleteShiftTemplateAsync(Guid templateId, Guid companyId)
    {
        await _supabase.Rpc("hr_delete_shift_template", new Dictionary<string, object>
        {
            ["p_id"]         = templateId,
            ["p_company_id"] = companyId
        });
    }

    // ─── Companies ───────────────────────────────────────────────────────────

    public async Task<Company> CreateCompanyAsync(Company company)
    {
        var result = await _supabase.From<Company>().Insert(company);
        return result.Models.First();
    }

    public async Task<Company> UpdateCompanyAsync(Company company)
    {
        var result = await _supabase.From<Company>().Update(company);
        return result.Models.First();
    }

    // ─── Employees ───────────────────────────────────────────────────────────

    public async Task<List<Employee>> GetEmployeesAsync(Guid companyId, Guid? forEmployeeId = null)
    {
        if (forEmployeeId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_list_company_peers", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = forEmployeeId.Value.ToString()
                });
                var peers = ParseEmployeesFromRpc(rpc?.Content);
                if (peers.Count > 0)
                    return peers;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"employee_list_company_peers: {ex.Message}");
            }
        }

        var result = await _supabase
            .From<Employee>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("is_active", Supabase.Postgrest.Constants.Operator.Equals, "true")
            .Order("name", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();

        return result.Models;
    }

    private static List<Employee> ParseEmployeesFromRpc(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content == "null")
            return [];

        try
        {
            return Newtonsoft.Json.JsonConvert.DeserializeObject<List<Employee>>(content) ?? [];
        }
        catch
        {
            return [];
        }
    }

    private static List<T> DeserializeRpcList<T>(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content is "null" or "[]")
            return [];

        try
        {
            return Newtonsoft.Json.JsonConvert.DeserializeObject<List<T>>(content) ?? [];
        }
        catch
        {
            return [];
        }
    }

    public async Task<Employee?> GetEmployeeAsync(Guid employeeId)
    {
        var result = await _supabase
            .From<Employee>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.ToString())
            .Get();
        return result.Models.FirstOrDefault();
    }

    public async Task<Employee> CreateEmployeeAsync(Employee employee)
    {
        var result = await _supabase.From<Employee>().Insert(employee);
        return result.Models.First();
    }

    public async Task<Employee> UpdateEmployeeAsync(Employee employee)
    {
        var result = await _supabase.From<Employee>().Update(employee);
        return result.Models.First();
    }

    public async Task DeleteEmployeeAsync(Guid employeeId)
    {
        await _supabase
            .From<Employee>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.ToString())
            .Delete();
    }

    public async Task<SelfRegisterResult> EmployeeSelfRegisterAsync(
        string email, string firstName, string lastName, string companyCode)
    {
        var user = _supabase.Auth.CurrentUser
            ?? throw new Exception("Not authenticated. Please verify your email first.");

        var rows = await _supabase.Rpc("employee_self_register", new Dictionary<string, object>
        {
            ["p_user_id"]      = user.Id!,
            ["p_email"]        = email.Trim().ToLowerInvariant(),
            ["p_first_name"]   = firstName.Trim(),
            ["p_last_name"]    = lastName.Trim(),
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant()
        });

        var content = rows?.Content;
        if (string.IsNullOrEmpty(content)) throw new Exception("Registration failed.");

        var json = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(content);
        var root = json.ValueKind == System.Text.Json.JsonValueKind.Array ? json[0] : json;

        return new SelfRegisterResult
        {
            Status      = root.GetProperty("status").GetString() ?? "",
            EmployeeId  = Guid.Parse(root.GetProperty("employee_id").GetString()!),
            CompanyId   = Guid.Parse(root.GetProperty("company_id").GetString()!),
            AccessLevel = root.TryGetProperty("access_level", out var al) ? al.GetString() : null,
            CompanyName = root.TryGetProperty("company_name", out var cn) ? cn.GetString() : null
        };
    }

    public async Task<Employee?> UpdateMyProfileAsync(
        Guid employeeId, Guid companyId,
        string? firstName, string? lastName,
        string? phone, string? idNumber,
        string? bankAccount, string? bankName, string? bankBranchCode)
    {
        var args = new Dictionary<string, object>
        {
            ["p_employee_id"] = employeeId.ToString(),
            ["p_company_id"]  = companyId.ToString()
        };
        if (firstName    != null) args["p_first_name"]      = firstName;
        if (lastName     != null) args["p_last_name"]       = lastName;
        if (phone        != null) args["p_phone"]           = phone;
        if (idNumber     != null) args["p_id_number"]       = idNumber;
        if (bankAccount  != null) args["p_bank_account"]    = bankAccount;
        if (bankName     != null) args["p_bank_name"]       = bankName;
        if (bankBranchCode != null) args["p_bank_branch_code"] = bankBranchCode;

        var result = await _supabase.Rpc("employee_update_profile", args);
        if (string.IsNullOrWhiteSpace(result.Content) || result.Content == "null")
            return null;

        return Newtonsoft.Json.JsonConvert.DeserializeObject<Employee>(result.Content);
    }

    public async Task<List<Employee>> GetPendingEmployeesAsync(Guid companyId)
    {
        var result = await _supabase
            .From<Employee>()
            .Filter("company_id",          Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("registration_status", Supabase.Postgrest.Constants.Operator.Equals, "pending")
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<Employee> ApproveEmployeeAsync(Guid employeeId)
    {
        await _supabase.Rpc("approve_pending_employee", new Dictionary<string, object>
        {
            ["p_employee_id"] = employeeId.ToString()
        });
        var result = await _supabase
            .From<Employee>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.ToString())
            .Get();
        return result.Models.First();
    }

    public async Task RejectEmployeeAsync(Guid employeeId)
    {
        await _supabase.Rpc("reject_pending_employee", new Dictionary<string, object>
        {
            ["p_employee_id"] = employeeId.ToString()
        });
    }

    // ─── Punches ─────────────────────────────────────────────────────────────

    public async Task<List<TimePunch>> GetPunchesAsync(Guid companyId, DateOnly from, DateOnly to, Guid? employeeId = null)
    {
        // Code-login field workers use anon PostgREST; RLS hides rows — route through RPC.
        if (string.IsNullOrEmpty(_supabase.Auth.CurrentSession?.User?.Id)
            && employeeId.HasValue)
        {
            return await GetMyPunchesAsync(companyId, employeeId.Value, from, to);
        }

        var query = _supabase
            .From<TimePunch>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("date_time", Supabase.Postgrest.Constants.Operator.GreaterThanOrEqual, from.ToDateTime(TimeOnly.MinValue).ToString("o"))
            .Filter("date_time", Supabase.Postgrest.Constants.Operator.LessThanOrEqual, to.ToDateTime(TimeOnly.MaxValue).ToString("o"))
            .Order("date_time", Supabase.Postgrest.Constants.Ordering.Ascending);

        if (employeeId.HasValue)
            query = query.Filter("employee_id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.Value.ToString());

        var result = await query.Get();
        return result.Models;
    }

    public async Task<TimePunch?> GetLastPunchAsync(Guid employeeId)
    {
        if (string.IsNullOrEmpty(_supabase.Auth.CurrentSession?.User?.Id))
            return await GetMyLastPunchAsync(employeeId);

        var result = await _supabase
            .From<TimePunch>()
            .Filter("employee_id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.ToString())
            .Order("date_time", Supabase.Postgrest.Constants.Ordering.Descending)
            .Limit(1)
            .Get();

        return result.Models.FirstOrDefault();
    }

    public async Task<TimePunch> InsertPunchAsync(TimePunch punch)
    {
        // Stamp an idempotency key on first attempt so that offline-replay of a punch
        // that actually committed server-side is de-duplicated, not inserted twice.
        // Set before any insert attempt so the same key persists into the offline queue.
        if (punch.IdempotencyKey is null || punch.IdempotencyKey == Guid.Empty)
            punch.IdempotencyKey = Guid.NewGuid();

        var args = new Dictionary<string, object>
        {
            ["p_company_id"]  = punch.CompanyId.ToString(),
            ["p_employee_id"] = punch.EmployeeId.ToString(),
            ["p_type"]        = punch.TypeRaw,
            ["p_date_time"]   = punch.DateTime.ToString("o"),
            ["p_idempotency_key"] = punch.IdempotencyKey.Value.ToString(),
        };
        if (punch.Latitude.HasValue)            args["p_latitude"]              = punch.Latitude.Value;
        if (punch.Longitude.HasValue)           args["p_longitude"]             = punch.Longitude.Value;
        if (punch.Address != null)              args["p_address"]               = punch.Address;
        if (punch.JobId.HasValue)               args["p_job_id"]                = punch.JobId.Value.ToString();
        if (punch.Notes != null)                args["p_notes"]                 = punch.Notes;
        // Always send manager param so PostgREST resolves the 10-arg overload (avoids PGRST203).
        args["p_punched_by_manager_id"] = punch.PunchedByManagerId is { } mgr && mgr != Guid.Empty
            ? mgr.ToString()
            : null!;

        try
        {
            var rpc = await _supabase.Rpc("employee_insert_punch", args);
            var json = rpc?.Content;
            if (!string.IsNullOrWhiteSpace(json) && json != "null")
            {
                var el = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(json);
                var saved = ParsePunch(el);
                _realtime.NotifyPunchChanged();
                _telemetry.LogSuccess("punch_inserted", nameof(InsertPunchAsync), new Dictionary<string, string>
                {
                    ["company_id"] = punch.CompanyId.ToString(),
                    ["employee_id"] = punch.EmployeeId.ToString(),
                    ["type"] = punch.TypeRaw,
                    ["punch_id"] = saved.Id.ToString(),
                });
                return saved;
            }
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(InsertPunchAsync), new Dictionary<string, string>
            {
                ["company_id"] = punch.CompanyId.ToString(),
                ["employee_id"] = punch.EmployeeId.ToString(),
                ["type"] = punch.TypeRaw,
                ["path"] = "employee_insert_punch",
            });
            if (IsCodeLoginSession())
                throw new Exception($"Could not save punch: {ex.Message}", ex);
            _telemetry.LogWarning(
                "employee_insert_punch RPC failed; attempting direct insert",
                context: nameof(InsertPunchAsync),
                properties: new Dictionary<string, string>
                {
                    ["company_id"] = punch.CompanyId.ToString(),
                    ["employee_id"] = punch.EmployeeId.ToString(),
                    ["type"] = punch.TypeRaw,
                    ["error"] = ex.Message,
                });
        }

        if (IsCodeLoginSession())
            throw new Exception("Could not save punch. Please check your connection and try again.");

        try
        {
            if (punch.Id == Guid.Empty)
                punch.Id = Guid.NewGuid();
            var result = await _supabase.From<TimePunch>().Insert(punch);
            var inserted = result.Models.FirstOrDefault();
            if (inserted != null)
            {
                _realtime.NotifyPunchChanged();
                return inserted;
            }
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(InsertPunchAsync), new Dictionary<string, string>
            {
                ["company_id"] = punch.CompanyId.ToString(),
                ["employee_id"] = punch.EmployeeId.ToString(),
                ["fallback"] = "direct_insert_failed",
            });
            throw new Exception($"Could not save punch: {ex.Message}", ex);
        }

        throw new Exception("Could not save punch. Please check your connection and try again.");
    }

    public async Task<TimePunch?> GetMyLastPunchAsync(Guid employeeId)
    {
        var rpc = await _supabase.Rpc("employee_get_last_punch",
            new Dictionary<string, object> { ["p_employee_id"] = employeeId.ToString() });
        var json = rpc?.Content;
        if (string.IsNullOrEmpty(json) || json == "null") return null;
        var el = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(json);
        return ParsePunch(el);
    }

    public async Task<List<TimePunch>> GetMyPunchesAsync(Guid companyId, Guid employeeId, DateOnly from, DateOnly to)
    {
        var rpc = await _supabase.Rpc("employee_get_my_punches", new Dictionary<string, object>
        {
            ["p_company_id"]  = companyId.ToString(),
            ["p_employee_id"] = employeeId.ToString(),
            ["p_from"]        = from.ToString("yyyy-MM-dd"),
            ["p_to"]          = to.ToString("yyyy-MM-dd"),
        });
        var json = rpc?.Content;
        if (string.IsNullOrEmpty(json) || json == "null") return [];
        var arr = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement[]>(json) ?? [];
        return arr.Select(ParsePunch).ToList();
    }

    public async Task UpdatePunchAddressAsync(Guid punchId, string address, Guid? companyId = null, Guid? employeeId = null)
    {
        if (IsCodeLoginSession() && companyId.HasValue && employeeId.HasValue)
        {
            await _supabase.Rpc("employee_update_punch_address", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.Value.ToString(),
                ["p_employee_id"] = employeeId.Value.ToString(),
                ["p_punch_id"] = punchId.ToString(),
                ["p_address"] = address,
            });
            _telemetry.LogSuccess("punch_address_updated", nameof(UpdatePunchAddressAsync), new Dictionary<string, string>
            {
                ["punch_id"] = punchId.ToString(),
            });
            return;
        }

        await _supabase.From<TimePunch>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, punchId.ToString())
            .Set(p => p.Address!, address)
            .Update();
    }

    public async Task<List<TimePunch>> GetEmployeesLastPunchAsync(Guid companyId, List<Guid> employeeIds)
    {
        if (employeeIds.Count == 0) return [];

        try
        {
            var rpc = await _supabase.Rpc("hr_get_employees_last_punch", new Dictionary<string, object>
            {
                ["p_company_id"]   = companyId.ToString(),
                ["p_employee_ids"] = employeeIds.Select(id => id.ToString()).ToArray()
            });

            var json = rpc?.Content;
            if (!string.IsNullOrWhiteSpace(json) && json != "null" && json != "[]")
            {
                var arr = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement[]>(json) ?? [];
                if (arr.Length > 0)
                    return arr.Select(ParsePunch).ToList();
            }
        }
        catch
        {
            // Fall back to per-employee lookup below.
        }

        var results = new List<TimePunch>();
        foreach (var id in employeeIds)
        {
            var punch = await GetLastPunchAsync(id);
            if (punch != null)
                results.Add(punch);
        }
        return results;
    }

    public async Task<List<TimePunch>> InsertTeamPunchAsync(
        List<Guid> employeeIds, Guid companyId, bool clockIn,
        double? lat, double? lng, string? address, Guid? punchedByManagerId,
        Guid? managerEmployeeId = null)
    {
        var results = new List<TimePunch>();
        var now = DateTime.UtcNow;
        var typeRaw = clockIn ? "in" : "out";

        foreach (var empId in employeeIds)
        {
            var punchedBy = managerEmployeeId.HasValue && empId == managerEmployeeId.Value
                ? null
                : punchedByManagerId;

            var punch = new TimePunch
            {
                Id                 = Guid.NewGuid(),
                EmployeeId         = empId,
                CompanyId          = companyId,
                TypeRaw            = typeRaw,
                DateTime           = now,
                Latitude           = lat,
                Longitude          = lng,
                Address            = address,
                PunchedByManagerId = punchedBy,
            };
            var inserted = await InsertPunchAsync(punch);
            results.Add(inserted);
        }

        return results;
    }

    public async Task<bool> IsOnLeaveTodayAsync(Guid companyId, Guid employeeId)
    {
        var result = await _supabase.Rpc("employee_is_on_leave_today", new Dictionary<string, object>
        {
            ["p_company_id"]  = companyId,
            ["p_employee_id"] = employeeId
        });
        return bool.TryParse(result.Content?.Trim('"'), out var b) && b;
    }

    private static TimePunch ParsePunch(System.Text.Json.JsonElement el)
    {
        static Guid? OptGuid(System.Text.Json.JsonElement e, string key)
            => e.TryGetProperty(key, out var v) && v.ValueKind != System.Text.Json.JsonValueKind.Null
               ? Guid.Parse(v.GetString()!) : null;
        static double? OptDouble(System.Text.Json.JsonElement e, string key)
            => e.TryGetProperty(key, out var v) && v.ValueKind != System.Text.Json.JsonValueKind.Null
               ? v.GetDouble() : null;
        static string? OptStr(System.Text.Json.JsonElement e, string key)
            => e.TryGetProperty(key, out var v) && v.ValueKind != System.Text.Json.JsonValueKind.Null
               ? v.GetString() : null;

        return new TimePunch
        {
            Id                  = Guid.Parse(el.GetProperty("id").GetString()!),
            EmployeeId          = Guid.Parse(el.GetProperty("employee_id").GetString()!),
            CompanyId           = Guid.Parse(el.GetProperty("company_id").GetString()!),
            TypeRaw             = el.GetProperty("type").GetString()!,
            DateTime            = DateTime.Parse(el.GetProperty("date_time").GetString()!, null,
                                      System.Globalization.DateTimeStyles.RoundtripKind),
            Latitude            = OptDouble(el, "latitude"),
            Longitude           = OptDouble(el, "longitude"),
            Address             = OptStr(el, "address"),
            JobId               = OptGuid(el, "job_id"),
            Notes               = OptStr(el, "notes"),
            PunchedByManagerId  = OptGuid(el, "punched_by_manager_id"),
            CreatedAt           = DateTime.Parse(el.GetProperty("created_at").GetString()!, null,
                                      System.Globalization.DateTimeStyles.RoundtripKind),
        };
    }

    // ─── Jobs ─────────────────────────────────────────────────────────────────

    public async Task<List<Job>> GetJobsAsync(Guid companyId, Guid? employeeId = null)
    {
        if (employeeId.HasValue)
        {
            var rpcJobs = await TryGetEmployeeJobsViaRpcAsync(companyId, employeeId.Value);
            if (rpcJobs != null)
                return rpcJobs;
        }

        var query = _supabase
            .From<Job>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending);

        var result = await query.Get();
        var jobs = result.Models;

        if (employeeId.HasValue)
            jobs = jobs.Where(j => j.IsAssignedTo(employeeId.Value)).ToList();

        return jobs;
    }

    private async Task<List<Job>?> TryGetEmployeeJobsViaRpcAsync(Guid companyId, Guid employeeId)
    {
        try
        {
            var rpc = await _supabase.Rpc("employee_get_jobs_for_employee", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_employee_id"] = employeeId.ToString()
            });
            var content = rpc?.Content;
            if (string.IsNullOrWhiteSpace(content) || content == "null")
                return [];

            var parsed = ParseJobsFromRpcContent(content);
            foreach (var j in parsed)
                JobAssignmentHelper.Normalize(j);

            var missingCreator = parsed.Count(j => !j.CreatedByEmployeeId.HasValue);
            if (missingCreator > 0)
            {
                _telemetry.LogEvent("jobs_missing_creator_id", new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["employee_id"] = employeeId.ToString(),
                    ["count"] = missingCreator.ToString(),
                    ["total"] = parsed.Count.ToString(),
                });
            }

            return parsed;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"employee_get_jobs_for_employee: {ex.Message}");
            return null;
        }
    }

    private static List<Job> ParseJobsFromRpcContent(string content)
    {
        var parsed = ParseEmployeeJobsFromRpc(content);
        if (!RpcParseLooksFailed(content, parsed))
            return parsed;

        try
        {
            if (content.TrimStart().StartsWith('{'))
            {
                var single = Newtonsoft.Json.JsonConvert.DeserializeObject<Job>(content);
                if (single != null)
                    return [single];
            }

            var alt = Newtonsoft.Json.JsonConvert.DeserializeObject<List<Job>>(content);
            if (alt is { Count: > 0 })
                return alt.OrderByDescending(j => j.CreatedAt).ToList();
        }
        catch
        {
            /* fall through */
        }

        return parsed;
    }

    private static bool RpcParseLooksFailed(string content, List<Job> parsed) =>
        content.TrimStart().StartsWith('[') && content.Length > 4 && parsed.Count == 0;

    public async Task EnsureEmployeeCompanyRelationshipAsync(Employee employee)
    {
        var user = _supabase.Auth.CurrentUser;
        if (user == null || !employee.IsActive) return;
        if (employee.UserId is not { } empUserId || empUserId.ToString() != user.Id) return;

        try
        {
            var role = employee.AccessLevelRaw switch
            {
                "owner" => "owner",
                "hr_admin" or "admin" => "admin",
                "manager" => "manager",
                _ => "employee"
            };

            await _supabase.From<CompanyRelationship>().Upsert(new CompanyRelationship
            {
                UserId = empUserId,
                CompanyId = employee.CompanyId,
                Role = role,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"EnsureEmployeeCompanyRelationship: {ex.Message}");
        }
    }

    public async Task<Job?> GetJobAsync(Guid jobId, Guid? companyId = null, Guid? employeeId = null)
    {
        Job? job = null;

        if (companyId.HasValue && employeeId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_job_for_employee", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.Value.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_job_id"] = jobId.ToString()
                });
                job = ParseJobsFromRpcContent(rpc?.Content ?? "[]").FirstOrDefault();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"employee_get_job_for_employee: {ex.Message}");
            }
        }

        if (job == null)
        {
            var result = await _supabase
                .From<Job>()
                .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, jobId.ToString())
                .Get();
            job = result.Models.FirstOrDefault();
        }

        if (job != null)
        {
            JobAssignmentHelper.Normalize(job);
            await ApplyJobPhotoUrlsAsync(job, companyId, employeeId);
        }

        return job;
    }

    public async Task<(List<string> Before, List<string> After)> GetJobPhotoUrlsAsync(
        Guid jobId, Guid? companyId = null, Guid? employeeId = null)
    {
        if (companyId.HasValue && employeeId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_job_photo_urls", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.Value.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_job_id"] = jobId.ToString()
                });
                return JobPhotoUrlParser.Parse(rpc?.Content);
            }
            catch
            {
                /* fall through */
            }
        }

        try
        {
            var rpc = await _supabase.Rpc("get_job_photo_urls", new Dictionary<string, object>
            {
                ["p_job_id"] = jobId.ToString()
            });
            return JobPhotoUrlParser.Parse(rpc?.Content);
        }
        catch
        {
            var job = await _supabase
                .From<Job>()
                .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, jobId.ToString())
                .Get();
            var row = job.Models.FirstOrDefault();
            return (row?.PhotoUrlsBefore ?? [], row?.PhotoUrlsAfter ?? []);
        }
    }

    private async Task ApplyJobPhotoUrlsAsync(Job job, Guid? companyId = null, Guid? employeeId = null)
    {
        var (before, after) = await GetJobPhotoUrlsAsync(
            job.Id, companyId ?? job.CompanyId, employeeId);
        job.PhotoUrlsBefore = before;
        job.PhotoUrlsAfter = after;
    }

    public async Task<Job> CreateJobAsync(Job job)
    {
        if (IsCodeLoginSession() && _state.CurrentEmployee?.Id is { } creatorId)
        {
            return await EmployeeCreateJobAsync(new EmployeeCreateJobRequest
            {
                CompanyId = job.CompanyId,
                CreatorEmployeeId = creatorId,
                Title = job.Title,
                Description = job.Description,
                PriorityRaw = job.PriorityRaw,
                ScheduledStart = job.ScheduledStart,
                ScheduledEnd = job.ScheduledEnd,
                SiteId = job.SiteId,
                ClientId = job.ClientId,
                AssigneeEmployeeId = job.AssigneeEmployeeId,
                AssignedEmployeeIds = job.AssignedEmployeeIds?.ToList() ?? [],
                VisibilityRaw = job.VisibilityRaw,
            });
        }

        if (job.Id == Guid.Empty)
            job.Id = Guid.NewGuid();
        JobAssignmentHelper.Normalize(job);
        var assignee = job.AssigneeEmployeeId;
        var teamIds = job.AssignedEmployeeIds?.ToList() ?? [];

        if (string.IsNullOrWhiteSpace(job.JobCode))
            job.JobCode = await GenerateNextJobCodeAsync(job.CompanyId);
        job.UpdatedAt = DateTime.UtcNow;
        if (job.CreatedAt == default)
            job.CreatedAt = DateTime.UtcNow;

        // Clear assignment columns for insert — persisted via hr_set_job_assignments RPC.
        job.AssigneeEmployeeId = null;
        job.AssignedEmployeeIds = [];

        var result = await _supabase.From<Job>().Insert(job);
        if (result.Models.Count == 0)
            throw new InvalidOperationException("Job was not created.");

        var created = result.Models.First();
        return await SetJobAssignmentsAsync(created.Id, created.CompanyId, assignee, teamIds) ?? created;
    }

    public async Task<Job> EmployeeCreateJobAsync(EmployeeCreateJobRequest request)
    {
        JobAssignmentHelper.Normalize(new Job
        {
            AssigneeEmployeeId = request.AssigneeEmployeeId,
            AssignedEmployeeIds = request.AssignedEmployeeIds,
        });
        var assignee = request.AssigneeEmployeeId ?? request.CreatorEmployeeId;
        var teamIds = new List<Guid>(request.AssignedEmployeeIds ?? []);
        if (!teamIds.Contains(request.CreatorEmployeeId))
            teamIds.Insert(0, request.CreatorEmployeeId);
        if (assignee != Guid.Empty && !teamIds.Contains(assignee))
            teamIds.Insert(0, assignee);

        try
        {
            var args = new Dictionary<string, object>
            {
                ["p_company_id"] = request.CompanyId.ToString(),
                ["p_creator_employee_id"] = request.CreatorEmployeeId.ToString(),
                ["p_title"] = request.Title.Trim(),
                ["p_description"] = request.Description ?? null!,
                ["p_priority"] = request.PriorityRaw ?? "medium",
                ["p_assignee_employee_id"] = assignee.ToString(),
                ["p_assigned_employee_ids"] = teamIds.Select(id => id.ToString()).ToArray(),
                ["p_visibility"] = request.VisibilityRaw ?? "inherit",
            };
            if (request.ScheduledStart.HasValue)
                args["p_scheduled_start"] = request.ScheduledStart.Value.ToString("o");
            if (request.ScheduledEnd.HasValue)
                args["p_scheduled_end"] = request.ScheduledEnd.Value.ToString("o");
            if (request.SiteId.HasValue)
                args["p_site_id"] = request.SiteId.Value.ToString();
            if (request.ClientId.HasValue)
                args["p_client_id"] = request.ClientId.Value.ToString();
            if (request.NotifyManagerEmployeeId.HasValue)
                args["p_notify_manager_employee_id"] = request.NotifyManagerEmployeeId.Value.ToString();

            var rpc = await _supabase.Rpc("employee_create_job", args);
            var created = ParseJobsFromRpcContent(rpc?.Content ?? "").FirstOrDefault();
            if (created == null && !string.IsNullOrWhiteSpace(rpc?.Content) && rpc.Content.TrimStart().StartsWith('{'))
                created = Newtonsoft.Json.JsonConvert.DeserializeObject<Job>(rpc.Content);

            if (created != null)
            {
                JobAssignmentHelper.Normalize(created);
                _realtime.NotifyPunchChanged(); // triggers dashboard refresh hooks; jobs share company channel pattern
                _telemetry.LogSuccess("employee_job_created", nameof(EmployeeCreateJobAsync), new Dictionary<string, string>
                {
                    ["job_id"] = created.Id.ToString(),
                    ["company_id"] = request.CompanyId.ToString(),
                    ["assignee_count"] = teamIds.Count.ToString(),
                    ["created_by_employee_id"] = created.CreatedByEmployeeId?.ToString() ?? "",
                });
                return created;
            }

            throw new InvalidOperationException("Job RPC returned empty response.");
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(EmployeeCreateJobAsync), new Dictionary<string, string>
            {
                ["company_id"] = request.CompanyId.ToString(),
                ["creator_id"] = request.CreatorEmployeeId.ToString(),
                ["path"] = "employee_create_job",
            });
            throw new InvalidOperationException($"Could not create job: {ex.Message}", ex);
        }
    }

    public async Task<Job> UpdateJobAsync(Job job)
    {
        JobAssignmentHelper.Normalize(job);
        var assignee = job.AssigneeEmployeeId;
        var teamIds = job.AssignedEmployeeIds?.ToList() ?? [];
        job.UpdatedAt = DateTime.UtcNow;

        var result = await _supabase.From<Job>().Update(job);
        var updated = result.Models.First();
        return await SetJobAssignmentsAsync(updated.Id, updated.CompanyId, assignee, teamIds) ?? updated;
    }

    private async Task<Job?> SetJobAssignmentsAsync(
        Guid jobId,
        Guid companyId,
        Guid? assigneeEmployeeId,
        IReadOnlyList<Guid> assignedEmployeeIds)
    {
        try
        {
            var rpc = await _supabase.Rpc("hr_set_job_assignments", new Dictionary<string, object>
            {
                ["p_job_id"] = jobId.ToString(),
                ["p_company_id"] = companyId.ToString(),
                ["p_assignee_employee_id"] = assigneeEmployeeId.HasValue
                    ? assigneeEmployeeId.Value.ToString()
                    : (object)DBNull.Value,
                ["p_assigned_employee_ids"] = assignedEmployeeIds.Count > 0
                    ? assignedEmployeeIds.Select(id => id.ToString()).ToArray()
                    : Array.Empty<string>()
            });

            var parsed = ParseJobsFromRpcContent(rpc?.Content ?? "");
            if (parsed.Count > 0)
                return parsed[0];

            return await GetJobAsync(jobId);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"hr_set_job_assignments: {ex.Message}");
            throw new InvalidOperationException(
                "Job was saved but team assignment could not be stored. Apply migration 20260526200000_fix_employee_jobs_anon_and_assignments.sql.",
                ex);
        }
    }

    public async Task DeleteJobAsync(Guid jobId)
    {
        await _supabase
            .From<Job>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, jobId.ToString())
            .Delete();
    }

    // ─── Job Cards ────────────────────────────────────────────────────────────

    public async Task<JobCard?> GetJobCardAsync(Guid jobId, Guid? employeeId = null, Guid? companyId = null)
    {
        if (employeeId.HasValue && companyId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_job_card_for_employee", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.Value.ToString(),
                    ["p_job_id"] = jobId.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString()
                });
                return ParseJobCardFromRpc(rpc?.Content);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"employee_get_job_card_for_employee: {ex.Message}");
            }
        }

        var result = await _supabase
            .From<JobCard>()
            .Filter("job_id", Supabase.Postgrest.Constants.Operator.Equals, jobId.ToString())
            .Get();
        return result.Models.FirstOrDefault();
    }

    public async Task<JobCard> SaveJobCardAsync(JobCard card, Guid? actingEmployeeId = null)
    {
        var employeeId = actingEmployeeId ?? card.EmployeeId;
        if (employeeId is not { } eid || eid == Guid.Empty)
            throw new InvalidOperationException("Employee is required to save a job card.");

        // Preserve timestamps when a partial save omits them (prevents UI reload wipe).
        if (!card.StartTime.HasValue || !card.EndTime.HasValue)
        {
            var existing = await GetJobCardAsync(card.JobId, eid, card.CompanyId);
            if (existing != null)
            {
                card.StartTime ??= existing.StartTime;
                card.EndTime ??= existing.EndTime;
            }
        }

        var rpc = await _supabase.Rpc("employee_upsert_job_card", new Dictionary<string, object>
        {
            ["p_company_id"] = card.CompanyId.ToString(),
            ["p_employee_id"] = eid.ToString(),
            ["p_job_id"] = card.JobId.ToString(),
            ["p_start_time"] = card.StartTime.HasValue ? card.StartTime.Value.ToString("o") : null!,
            ["p_end_time"] = card.EndTime.HasValue ? card.EndTime.Value.ToString("o") : null!,
            ["p_work_performed"] = card.WorkPerformed ?? null!,
            ["p_materials_used"] = card.MaterialsUsed ?? null!,
            ["p_photo_urls"] = card.PhotoUrls?.Count > 0
                ? card.PhotoUrls.ToArray()
                : Array.Empty<string>(),
            ["p_is_completed"] = card.IsCompleted,
            ["p_client_signature_url"] = card.ClientSignatureUrl ?? null!,
        });

        var saved = ParseJobCardFromRpc(rpc?.Content);
        if (saved != null)
        {
            _telemetry.LogSuccess("job_card_saved", nameof(SaveJobCardAsync), new Dictionary<string, string>
            {
                ["job_id"] = card.JobId.ToString(),
                ["has_start"] = saved.StartTime.HasValue.ToString(),
                ["has_end"] = saved.EndTime.HasValue.ToString(),
            });
            return saved;
        }

        _telemetry.LogWarning("job card RPC returned empty", nameof(SaveJobCardAsync), new Dictionary<string, string>
        {
            ["job_id"] = card.JobId.ToString(),
        });
        throw new InvalidOperationException("Could not save job card.");
    }

    private static JobCard? ParseJobCardFromRpc(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content == "null")
            return null;
        try
        {
            return Newtonsoft.Json.JsonConvert.DeserializeObject<JobCard>(content);
        }
        catch
        {
            return null;
        }
    }

    // ─── Checklist ────────────────────────────────────────────────────────────

    public async Task<List<JobChecklistItem>> GetChecklistItemsAsync(Guid jobId, Guid? employeeId = null, Guid? companyId = null)
    {
        if (employeeId.HasValue && companyId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_checklist_for_job", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.Value.ToString(),
                    ["p_job_id"] = jobId.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString()
                });
                var content = rpc?.Content;
                if (!string.IsNullOrWhiteSpace(content) && content != "null")
                {
                    var list = Newtonsoft.Json.JsonConvert.DeserializeObject<List<JobChecklistItem>>(content);
                    if (list is { Count: > 0 })
                        return list.OrderBy(c => c.SortOrder).ToList();
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"employee_get_checklist_for_job: {ex.Message}");
            }
        }

        var result = await _supabase
            .From<JobChecklistItem>()
            .Filter("job_id", Supabase.Postgrest.Constants.Operator.Equals, jobId.ToString())
            .Order("sort_order", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<JobChecklistItem> SaveChecklistItemAsync(JobChecklistItem item, Guid? employeeId = null)
    {
        if (employeeId.HasValue && item.CompanyId != Guid.Empty)
        {
            await _supabase.Rpc("employee_update_checklist_item", new Dictionary<string, object>
            {
                ["p_company_id"] = item.CompanyId.ToString(),
                ["p_employee_id"] = employeeId.Value.ToString(),
                ["p_item_id"] = item.Id.ToString(),
                ["p_is_checked"] = item.IsChecked
            });
            return item;
        }

        var existing = await _supabase
            .From<JobChecklistItem>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, item.Id.ToString())
            .Get();

        var exists = existing.Models.Count > 0;
        if (ChecklistPersistence.ShouldInsert(exists))
        {
            var inserted = await _supabase.From<JobChecklistItem>().Insert(item);
            return inserted.Models.First();
        }

        var updated = await _supabase.From<JobChecklistItem>().Update(item);
        return updated.Models.First();
    }

    public async Task SaveChecklistItemsAsync(List<JobChecklistItem> items, Guid? employeeId = null)
    {
        foreach (var item in items)
            await SaveChecklistItemAsync(item, employeeId);
    }

    public async Task<JobChecklistItem> CreateChecklistItemForJobAsync(
        Guid companyId, Guid employeeId, Guid jobId, string description)
    {
        try
        {
            var rpc = await _supabase.Rpc("employee_insert_checklist_item", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_employee_id"] = employeeId.ToString(),
                ["p_job_id"] = jobId.ToString(),
                ["p_description"] = description.Trim(),
            });
            var item = Newtonsoft.Json.JsonConvert.DeserializeObject<JobChecklistItem>(rpc?.Content ?? "");
            if (item != null) return item;
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(CreateChecklistItemForJobAsync));
            throw new InvalidOperationException($"Could not add checklist item: {ex.Message}", ex);
        }

        throw new InvalidOperationException("Could not add checklist item.");
    }

    // ─── Clients ──────────────────────────────────────────────────────────────

    public async Task<List<Client>> GetClientsAsync(Guid companyId)
    {
        var result = await _supabase
            .From<Client>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Order("name", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<Client?> GetClientAsync(Guid clientId)
    {
        var result = await _supabase
            .From<Client>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, clientId.ToString())
            .Get();
        return result.Models.FirstOrDefault();
    }

    public async Task<Client> CreateClientAsync(Client client)
    {
        if (client.Id == Guid.Empty)
            client.Id = Guid.NewGuid();
        if (string.IsNullOrWhiteSpace(client.ClientCode))
            client.ClientCode = await GenerateNextClientCodeAsync(client.CompanyId);
        client.CreatedAt = DateTime.UtcNow;
        var result = await _supabase.From<Client>().Insert(client);
        if (result.Models.Count == 0)
            throw new InvalidOperationException("Client was not created. Check your connection and try again.");
        return result.Models.First();
    }

    public async Task<string> GenerateNextClientCodeAsync(Guid companyId)
    {
        var company = await GetCurrentCompanyAsync(companyId);
        var prefix = EntityCodeHelper.ClientPrefix(company?.Code ?? "");
        var clients = await GetClientsAsync(companyId);
        return EntityCodeHelper.NextCode(prefix, clients.Select(c => c.ClientCode));
    }

    public async Task<string> GenerateNextProjectCodeAsync(Guid companyId)
    {
        var company = await GetCurrentCompanyAsync(companyId);
        var prefix = EntityCodeHelper.ProjectPrefix(company?.Code ?? "");
        var deals = await GetClientDealsAsync(companyId);
        return EntityCodeHelper.NextCode(prefix, deals.Select(d => d.ProjectCode));
    }

    public async Task<string> GenerateNextJobCodeAsync(Guid companyId)
    {
        var company = await GetCurrentCompanyAsync(companyId);
        var prefix = EntityCodeHelper.JobPrefix(company?.Code ?? "");
        var jobs = await GetJobsAsync(companyId);
        return EntityCodeHelper.NextCode(prefix, jobs.Select(j => j.JobCode));
    }

    public async Task<ClientPortalLogin?> ResolveClientByCodeAsync(string companyCode, string clientCode)
    {
        if (string.IsNullOrWhiteSpace(companyCode) || string.IsNullOrWhiteSpace(clientCode))
            return null;

        var rows = await _supabase.Rpc("client_resolve_by_code", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_client_code"] = clientCode.Trim().ToUpperInvariant()
        });

        var content = rows?.Content;
        if (string.IsNullOrEmpty(content)) return null;

        var list = System.Text.Json.JsonSerializer.Deserialize<List<System.Text.Json.JsonElement>>(content);
        if (list == null || list.Count == 0) return null;

        var row = list[0];
        return new ClientPortalLogin
        {
            ClientId = row.TryGetProperty("client_id", out var cid) ? Guid.Parse(cid.GetString()!) : Guid.Empty,
            CompanyId = row.TryGetProperty("company_id", out var coid) ? Guid.Parse(coid.GetString()!) : Guid.Empty,
            CompanyCode = row.TryGetProperty("company_code", out var cc) ? cc.GetString() ?? "" : "",
            ClientCode = row.TryGetProperty("client_code", out var clc) ? clc.GetString() ?? "" : "",
            ClientName = row.TryGetProperty("client_name", out var cn) ? cn.GetString() ?? "" : "",
            Email = row.TryGetProperty("email", out var em) && em.ValueKind != System.Text.Json.JsonValueKind.Null
                ? em.GetString() : null
        };
    }

    public async Task<List<ClientDeal>> GetClientPortalProjectsAsync(string companyCode, string clientCode)
    {
        var rows = await _supabase.Rpc("client_portal_list_projects", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_client_code"] = clientCode.Trim().ToUpperInvariant()
        });
        return ParseClientPortalDeals(rows?.Content);
    }

    public async Task<List<ClientPortalMessageInboxItem>> GetClientPortalMessageInboxAsync(
        string companyCode, string clientCode)
    {
        var rows = await _supabase.Rpc("client_portal_list_message_inbox", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_client_code"] = clientCode.Trim().ToUpperInvariant()
        });
        return ParseClientPortalMessageInbox(rows?.Content);
    }

    private static List<ClientPortalMessageInboxItem> ParseClientPortalMessageInbox(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content == "null") return [];
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array)
                return [];

            var list = new List<ClientPortalMessageInboxItem>();
            foreach (var row in doc.RootElement.EnumerateArray())
            {
                DateTime? lastAt = null;
                if (row.TryGetProperty("last_message_at", out var la)
                    && la.ValueKind == System.Text.Json.JsonValueKind.String
                    && DateTime.TryParse(la.GetString(), out var parsed))
                    lastAt = parsed;

                list.Add(new ClientPortalMessageInboxItem
                {
                    DealId = row.TryGetProperty("deal_id", out var did)
                        && Guid.TryParse(did.GetString(), out var dg) ? dg : Guid.Empty,
                    ProjectTitle = row.TryGetProperty("project_title", out var pt) ? pt.GetString() ?? "" : "",
                    ProjectCode = row.TryGetProperty("project_code", out var pc) ? pc.GetString() : null,
                    LastMessageAt = lastAt,
                    LastMessagePreview = row.TryGetProperty("last_message_preview", out var lp) ? lp.GetString() : null,
                    LastFromHr = row.TryGetProperty("last_from_hr", out var lh) && lh.ValueKind == System.Text.Json.JsonValueKind.True
                });
            }
            return list.Where(i => i.DealId != Guid.Empty).ToList();
        }
        catch
        {
            return [];
        }
    }

    public async Task<ClientDeal?> GetClientPortalProjectAsync(string companyCode, string clientCode, Guid dealId)
    {
        var rows = await _supabase.Rpc("client_portal_get_project", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_client_code"] = clientCode.Trim().ToUpperInvariant(),
            ["p_deal_id"] = dealId.ToString()
        });
        var content = rows?.Content;
        if (string.IsNullOrWhiteSpace(content) || content == "null") return null;
        var list = ParseClientPortalDeals(content);
        return list.FirstOrDefault();
    }

    private static List<ClientDeal> ParseClientPortalDeals(string? content)
    {
        if (string.IsNullOrWhiteSpace(content)) return [];
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array)
                return doc.RootElement.EnumerateArray().Select(ParseClientPortalDeal).ToList();
            if (doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object)
                return [ParseClientPortalDeal(doc.RootElement)];
        }
        catch { /* ignore malformed */ }
        return [];
    }

    private static ClientDeal ParseClientPortalDeal(System.Text.Json.JsonElement row)
    {
        static Guid G(System.Text.Json.JsonElement el, string name) =>
            el.TryGetProperty(name, out var p) && Guid.TryParse(p.GetString(), out var g) ? g : Guid.Empty;
        static string S(System.Text.Json.JsonElement el, string name) =>
            el.TryGetProperty(name, out var p) && p.ValueKind == System.Text.Json.JsonValueKind.String ? p.GetString() ?? "" : "";
        static double N(System.Text.Json.JsonElement el, string name) =>
            el.TryGetProperty(name, out var p) && p.TryGetDouble(out var d) ? d : 0;
        static int I(System.Text.Json.JsonElement el, string name) =>
            el.TryGetProperty(name, out var p) && p.TryGetInt32(out var i) ? i : 0;

        static DateOnly? ParseDateOnly(System.Text.Json.JsonElement el, string name)
        {
            if (!el.TryGetProperty(name, out var p) || p.ValueKind == System.Text.Json.JsonValueKind.Null)
                return null;
            if (p.ValueKind == System.Text.Json.JsonValueKind.String)
            {
                var s = p.GetString();
                if (string.IsNullOrWhiteSpace(s)) return null;
                return DateOnly.TryParse(s, out var d) && d.Year >= 1900 ? d : null;
            }
            return null;
        }

        var close = ParseDateOnly(row, "expected_close_date");
        var siteStart = ParseDateOnly(row, "site_start_date");
        var expectedCompletion = ParseDateOnly(row, "expected_completion_date");
        var nextVisit = ParseDateOnly(row, "next_visit_date");

        DateTime? lastAt = null;
        if (row.TryGetProperty("last_update_at", out var lu) && lu.ValueKind == System.Text.Json.JsonValueKind.String
            && DateTime.TryParse(lu.GetString(), out var dt))
            lastAt = dt;

        Guid? jobId = null;
        if (row.TryGetProperty("job_id", out var jid) && jid.ValueKind == System.Text.Json.JsonValueKind.String
            && Guid.TryParse(jid.GetString(), out var jg))
            jobId = jg;

        DateOnly? validUntil = null;
        validUntil = ParseDateOnly(row, "quotation_valid_until");

        DateTime? sentAt = null;
        if (row.TryGetProperty("quotation_sent_at", out var qs) && qs.ValueKind == System.Text.Json.JsonValueKind.String
            && DateTime.TryParse(qs.GetString(), out var dSent))
            sentAt = dSent;

        var deal = new ClientDeal
        {
            Id = G(row, "id"),
            CompanyId = G(row, "company_id"),
            ClientId = G(row, "client_id"),
            ProjectCode = row.TryGetProperty("project_code", out var pc) ? pc.GetString() : null,
            Title = S(row, "title"),
            StatusRaw = S(row, "status"),
            OfferAmount = N(row, "offer_amount"),
            DepositRequired = N(row, "deposit_required"),
            AmountPaid = N(row, "amount_paid"),
            ProgressPercent = I(row, "progress_percent"),
            AgreementNotes = row.TryGetProperty("agreement_notes", out var an) ? an.GetString() : null,
            LastUpdateNote = row.TryGetProperty("last_update_note", out var un) ? un.GetString() : null,
            LastUpdateAt = lastAt,
            ExpectedCloseDate = close,
            SiteStartDate = siteStart,
            ExpectedCompletionDate = expectedCompletion,
            NextVisitDate = nextVisit,
            JobId = jobId,
            QuotationNotes = row.TryGetProperty("quotation_notes", out var qn) ? qn.GetString() : null,
            QuotationValidUntil = validUntil,
            QuotationSentAt = sentAt,
            CreatedAt = row.TryGetProperty("created_at", out var ca) && DateTime.TryParse(ca.GetString(), out var created)
                ? created : DateTime.UtcNow,
            UpdatedAt = row.TryGetProperty("updated_at", out var ua) && DateTime.TryParse(ua.GetString(), out var updated)
                ? updated : DateTime.UtcNow,
            JobCount = I(row, "job_count")
        };

        if (row.TryGetProperty("quotation_lines", out var ql) && ql.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            var lineNo = 1;
            foreach (var line in ql.EnumerateArray())
            {
                deal.QuotationLines.Add(new ProjectQuotationLine
                {
                    DealId = deal.Id,
                    CompanyId = deal.CompanyId,
                    LineNo = line.TryGetProperty("line_no", out var ln) && ln.TryGetInt32(out var n) ? n : lineNo++,
                    Description = line.TryGetProperty("description", out var d) ? d.GetString() ?? "" : "",
                    Quantity = line.TryGetProperty("quantity", out var q) && q.TryGetDouble(out var qty) ? qty : 1,
                    UnitPrice = line.TryGetProperty("unit_price", out var up) && up.TryGetDouble(out var price) ? price : 0
                });
            }
        }

        if (row.TryGetProperty("documents", out var docs) && docs.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var doc in docs.EnumerateArray())
            {
                deal.PortalDocuments.Add(new ProjectDocument
                {
                    Id = doc.TryGetProperty("id", out var did) && Guid.TryParse(did.GetString(), out var dg) ? dg : Guid.Empty,
                    DealId = deal.Id,
                    CompanyId = deal.CompanyId,
                    DocumentName = doc.TryGetProperty("document_name", out var dn) ? dn.GetString() ?? "" : "",
                    DocumentType = doc.TryGetProperty("document_type", out var docType) ? docType.GetString() ?? "other" : "other",
                    FileUrl = doc.TryGetProperty("file_url", out var fu) ? fu.GetString() ?? "" : "",
                    CreatedAt = doc.TryGetProperty("created_at", out var docCa) && DateTime.TryParse(docCa.GetString(), out var docCreated)
                        ? docCreated : DateTime.UtcNow
                });
            }
        }

        if (row.TryGetProperty("activity_updates", out var acts) && acts.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var act in acts.EnumerateArray())
            {
                deal.PortalActivity.Add(new ClientDealUpdate
                {
                    DealId = deal.Id,
                    CompanyId = deal.CompanyId,
                    Body = act.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "",
                    StatusFrom = act.TryGetProperty("status_from", out var sf) ? sf.GetString() : null,
                    StatusTo = act.TryGetProperty("status_to", out var st) ? st.GetString() : null,
                    CreatedAt = act.TryGetProperty("created_at", out var ac) && DateTime.TryParse(ac.GetString(), out var at)
                        ? at : DateTime.UtcNow
                });
            }
        }

        if (row.TryGetProperty("progress_photos", out var photos) && photos.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var photo in photos.EnumerateArray())
            {
                deal.PortalPhotos.Add(new ClientPortalPhotoItem
                {
                    JobTitle = photo.TryGetProperty("job_title", out var jt) ? jt.GetString() ?? "" : "",
                    Phase = photo.TryGetProperty("phase", out var ph) ? ph.GetString() ?? "before" : "before",
                    Url = photo.TryGetProperty("url", out var u) ? u.GetString() ?? "" : ""
                });
            }
        }

        if (row.TryGetProperty("messages", out var msgs) && msgs.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var msg in msgs.EnumerateArray())
            {
                var hasClientSender = msg.TryGetProperty("sender_client_id", out var sc)
                    && sc.ValueKind == System.Text.Json.JsonValueKind.String
                    && Guid.TryParse(sc.GetString(), out _);
                deal.PortalMessages.Add(new ClientDealMessage
                {
                    Id = msg.TryGetProperty("id", out var mid) && Guid.TryParse(mid.GetString(), out var mg) ? mg : Guid.Empty,
                    DealId = deal.Id,
                    CompanyId = deal.CompanyId,
                    Author = hasClientSender ? "client" : "hr",
                    Body = msg.TryGetProperty("body", out var mb) ? mb.GetString() ?? "" : "",
                    CreatedAt = msg.TryGetProperty("created_at", out var mc) && DateTime.TryParse(mc.GetString(), out var mt)
                        ? mt : DateTime.UtcNow
                });
            }
        }

        if (row.TryGetProperty("payments", out var pays) && pays.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var pay in pays.EnumerateArray())
            {
                deal.PortalPayments.Add(new ProjectClientPayment
                {
                    Id = pay.TryGetProperty("id", out var pid) && Guid.TryParse(pid.GetString(), out var pg) ? pg : Guid.Empty,
                    DealId = deal.Id,
                    CompanyId = deal.CompanyId,
                    Amount = pay.TryGetProperty("amount", out var pa) && pa.TryGetDouble(out var amt) ? amt : 0,
                    PaidAt = pay.TryGetProperty("paid_at", out var pp) && DateTime.TryParse(pp.GetString(), out var paid) ? paid : DateTime.UtcNow,
                    PaymentMethod = pay.TryGetProperty("payment_method", out var pm) ? pm.GetString() : null,
                    Reference = pay.TryGetProperty("reference", out var pr) ? pr.GetString() : null,
                    Notes = pay.TryGetProperty("notes", out var pn) ? pn.GetString() : null,
                    ReceiptUrl = pay.TryGetProperty("receipt_url", out var ru) ? ru.GetString() : null
                });
            }
        }

        return deal;
    }

    public async Task<Guid> ClientPortalAddDocumentLinkAsync(
        string companyCode, string clientCode, Guid dealId, string documentName, string fileUrl)
    {
        var rows = await _supabase.Rpc("client_portal_add_document_link", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_client_code"] = clientCode.Trim().ToUpperInvariant(),
            ["p_deal_id"] = dealId.ToString(),
            ["p_document_name"] = documentName.Trim(),
            ["p_file_url"] = fileUrl.Trim()
        });
        var content = rows?.Content?.Trim();
        if (string.IsNullOrEmpty(content) || content == "null")
            throw new InvalidOperationException("Could not save document.");
        return Guid.Parse(content.Trim('"'));
    }

    public async Task<Guid> ClientPortalRegisterDocumentAsync(
        string companyCode, string clientCode, Guid dealId, string documentName, string fileUrl)
    {
        var rows = await _supabase.Rpc("client_portal_register_document", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_client_code"] = clientCode.Trim().ToUpperInvariant(),
            ["p_deal_id"] = dealId.ToString(),
            ["p_document_name"] = documentName.Trim(),
            ["p_file_url"] = fileUrl.Trim()
        });
        var content = rows?.Content?.Trim();
        if (string.IsNullOrEmpty(content) || content == "null")
            throw new InvalidOperationException("Could not save document.");
        return Guid.Parse(content.Trim('"'));
    }

    public async Task<ProjectDocument> ClientPortalUploadDocumentAsync(
        string companyCode, string clientCode, Guid dealId, Guid companyId, FileResult file, string documentName)
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var filePath = $"project_documents/{companyId}/{dealId}/client_{Guid.NewGuid()}{ext}";
        await _supabase.Storage.From("workforce-media").Upload(bytes, filePath);
        var fileUrl = BuildWorkforceMediaUrl(filePath);
        var id = await ClientPortalRegisterDocumentAsync(companyCode, clientCode, dealId, documentName, fileUrl);
        return new ProjectDocument
        {
            Id = id,
            CompanyId = companyId,
            DealId = dealId,
            DocumentName = documentName,
            DocumentType = "client_upload",
            FileUrl = fileUrl,
            CreatedAt = DateTime.UtcNow
        };
    }

    public async Task<AppMessage> ClientPortalSendMessageAsync(
        string companyCode, string clientCode, Guid dealId, string body)
    {
        var rows = await _supabase.Rpc("client_portal_send_message", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_client_code"] = clientCode.Trim().ToUpperInvariant(),
            ["p_deal_id"] = dealId.ToString(),
            ["p_body"] = body.Trim()
        });
        var content = rows?.Content;
        if (string.IsNullOrWhiteSpace(content) || content == "null")
            throw new InvalidOperationException("Could not send message.");
        return Newtonsoft.Json.JsonConvert.DeserializeObject<AppMessage>(content)!;
    }

    public async Task<MessageThread> GetOrCreateClientDealThreadAsync(Guid companyId, Guid dealId)
    {
        var subject = $"Deal:{dealId}";
        var existing = await _supabase
            .From<MessageThread>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("subject", Supabase.Postgrest.Constants.Operator.Equals, subject)
            .Get();
        if (existing.Models.FirstOrDefault() is { } found)
            return found;

        var deal = await GetClientDealAsync(dealId)
            ?? throw new InvalidOperationException("Project not found.");
        var employees = await GetEmployeesAsync(companyId);
        var participantIds = employees
            .Where(e => e.IsActive && (e.IsHr || e.IsManager || e.Id == deal.ManagerEmployeeId))
            .Select(e => e.Id)
            .Distinct()
            .ToList();

        if (participantIds.Count == 0 && deal.ManagerEmployeeId.HasValue)
            participantIds.Add(deal.ManagerEmployeeId.Value);

        var thread = new MessageThread
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Subject = subject,
            TypeRaw = "client_deal",
            ParticipantIds = participantIds,
            CreatedAt = DateTime.UtcNow
        };
        var created = await _supabase.From<MessageThread>().Insert(thread);
        return created.Models.First();
    }

    public async Task<Client> UpdateClientAsync(Client client)
    {
        var result = await _supabase.From<Client>().Update(client);
        return result.Models.First();
    }

    public async Task DeleteClientAsync(Guid clientId)
    {
        await _supabase
            .From<Client>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, clientId.ToString())
            .Delete();
    }

    // ─── Client projects (client_deals) ─────────────────────────────────────

    public async Task<List<ClientDeal>> GetClientDealsAsync(Guid companyId, Guid? clientId = null)
    {
        var query = _supabase
            .From<ClientDeal>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString());

        if (clientId.HasValue)
            query = query.Filter("client_id", Supabase.Postgrest.Constants.Operator.Equals, clientId.Value.ToString());

        var result = await query
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<ClientDeal?> GetClientDealAsync(Guid dealId)
    {
        var result = await _supabase
            .From<ClientDeal>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, dealId.ToString())
            .Get();
        return result.Models.FirstOrDefault();
    }

    public async Task<ClientDeal> CreateClientDealAsync(ClientDeal deal)
    {
        if (deal.Id == Guid.Empty)
            deal.Id = Guid.NewGuid();
        if (string.IsNullOrWhiteSpace(deal.ProjectCode))
            deal.ProjectCode = await GenerateNextProjectCodeAsync(deal.CompanyId);
        deal.UpdatedAt = DateTime.UtcNow;
        if (deal.CreatedAt == default)
            deal.CreatedAt = DateTime.UtcNow;
        var result = await _supabase.From<ClientDeal>().Insert(deal);
        if (result.Models.Count == 0)
            throw new InvalidOperationException("Project was not created.");
        return result.Models.First();
    }

    public async Task<ClientDeal> UpdateClientDealAsync(ClientDeal deal)
    {
        deal.UpdatedAt = DateTime.UtcNow;
        var result = await _supabase.From<ClientDeal>().Update(deal);
        return result.Models.First();
    }

    public async Task DeleteClientDealAsync(Guid dealId)
    {
        await _supabase
            .From<ClientDeal>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, dealId.ToString())
            .Delete();
    }

    public async Task LinkClientDealToJobAsync(Guid dealId, Guid jobId)
    {
        var deal = await GetClientDealAsync(dealId)
            ?? throw new InvalidOperationException("Project not found.");

        if (!deal.JobId.HasValue)
        {
            deal.JobId = jobId;
            deal.UpdatedAt = DateTime.UtcNow;
            await _supabase.From<ClientDeal>().Update(deal);
        }

        var job = await GetJobAsync(jobId)
            ?? throw new InvalidOperationException("Job not found.");

        job.DealId = dealId;
        job.UpdatedAt = DateTime.UtcNow;
        await _supabase.From<Job>().Update(job);
    }

    public async Task<List<Job>> GetJobsByDealIdAsync(Guid dealId)
    {
        var result = await _supabase
            .From<Job>()
            .Filter("deal_id", Supabase.Postgrest.Constants.Operator.Equals, dealId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<List<ClientDealUpdate>> GetClientDealUpdatesAsync(Guid dealId)
    {
        var result = await _supabase
            .From<ClientDealUpdate>()
            .Filter("deal_id", Supabase.Postgrest.Constants.Operator.Equals, dealId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<ClientDealUpdate> AddClientDealUpdateAsync(ClientDealUpdate update)
    {
        if (update.Id == Guid.Empty)
            update.Id = Guid.NewGuid();
        if (update.CreatedAt == default)
            update.CreatedAt = DateTime.UtcNow;
        var result = await _supabase.From<ClientDealUpdate>().Insert(update);
        return result.Models.First();
    }

    public async Task<List<ProjectDocument>> GetProjectDocumentsAsync(Guid dealId)
    {
        var result = await _supabase
            .From<ProjectDocument>()
            .Filter("deal_id", Supabase.Postgrest.Constants.Operator.Equals, dealId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<ProjectDocument> UploadProjectDocumentAsync(
        Guid companyId, Guid dealId, FileResult file, string documentType, string documentName)
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var filePath = $"project_documents/{companyId}/{dealId}/{Guid.NewGuid()}{ext}";
        await _supabase.Storage.From("workforce-media").Upload(bytes, filePath);
        var fileUrl = BuildWorkforceMediaUrl(filePath);

        var doc = new ProjectDocument
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            DealId = dealId,
            DocumentName = documentName,
            DocumentType = documentType,
            FileUrl = fileUrl,
            CreatedAt = DateTime.UtcNow
        };
        var result = await _supabase.From<ProjectDocument>().Insert(doc);
        return result.Models.First();
    }

    public async Task DeleteProjectDocumentAsync(ProjectDocument document)
    {
        await _supabase
            .From<ProjectDocument>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, document.Id.ToString())
            .Delete();
        await TryDeleteStorageFileAsync(document.FileUrl);
    }

    public async Task<List<ProjectQuotationLine>> GetProjectQuotationLinesAsync(Guid dealId)
    {
        var result = await _supabase
            .From<ProjectQuotationLine>()
            .Filter("deal_id", Supabase.Postgrest.Constants.Operator.Equals, dealId.ToString())
            .Order("line_no", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<ProjectQuotationLine> AddProjectQuotationLineAsync(ProjectQuotationLine line)
    {
        var result = await _supabase.From<ProjectQuotationLine>().Insert(line);
        return result.Models.First();
    }

    public async Task DeleteProjectQuotationLineAsync(Guid lineId)
    {
        await _supabase
            .From<ProjectQuotationLine>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, lineId.ToString())
            .Delete();
    }

    public async Task<List<ProjectClientPayment>> GetProjectClientPaymentsAsync(Guid dealId)
    {
        var result = await _supabase
            .From<ProjectClientPayment>()
            .Filter("deal_id", Supabase.Postgrest.Constants.Operator.Equals, dealId.ToString())
            .Order("paid_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<ProjectClientPayment> AddProjectClientPaymentAsync(ProjectClientPayment payment)
    {
        if (payment.Id == Guid.Empty) payment.Id = Guid.NewGuid();
        if (payment.PaidAt == default) payment.PaidAt = DateTime.UtcNow;
        if (payment.CreatedAt == default) payment.CreatedAt = DateTime.UtcNow;
        var result = await _supabase.From<ProjectClientPayment>().Insert(payment);
        return result.Models.First();
    }

    public async Task<ProjectClientPayment> UpdateProjectClientPaymentAsync(ProjectClientPayment payment)
    {
        var result = await _supabase.From<ProjectClientPayment>().Update(payment);
        return result.Models.First();
    }

    public async Task<ProjectClientPayment> AttachPaymentReceiptAsync(
        Guid companyId, ProjectClientPayment payment, FileResult file)
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var filePath = $"project_documents/{companyId}/{payment.DealId}/receipts/{payment.Id}{ext}";
        await _supabase.Storage.From("workforce-media").Upload(bytes, filePath);
        payment.ReceiptUrl = BuildWorkforceMediaUrl(filePath);
        return await UpdateProjectClientPaymentAsync(payment);
    }

    public async Task<List<ClientDealMessage>> GetClientDealMessagesAsync(Guid dealId)
    {
        var result = await _supabase
            .From<ClientDealMessage>()
            .Filter("deal_id", Supabase.Postgrest.Constants.Operator.Equals, dealId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<ClientDealMessage> AddClientDealMessageAsync(ClientDealMessage message)
    {
        if (message.Id == Guid.Empty) message.Id = Guid.NewGuid();
        if (message.CreatedAt == default) message.CreatedAt = DateTime.UtcNow;
        var result = await _supabase.From<ClientDealMessage>().Insert(message);
        return result.Models.First();
    }

    public async Task<ClientDeal> SyncClientDealFinancialsAsync(Guid dealId)
    {
        var deal = await GetClientDealAsync(dealId)
            ?? throw new InvalidOperationException("Project not found.");
        var payments = await GetProjectClientPaymentsAsync(dealId);
        var jobs = await GetJobsByDealIdAsync(dealId);

        deal.AmountPaid = payments.Sum(p => p.Amount);
        deal.ProgressPercent = ProjectProgressHelper.ComputePercent(deal, jobs);
        deal.UpdatedAt = DateTime.UtcNow;
        return await UpdateClientDealAsync(deal);
    }

    public async Task<List<JobDocument>> GetJobDocumentsAsync(
        Guid jobId, Guid? companyId = null, Guid? employeeId = null)
    {
        if (IsCodeLoginSession() && companyId.HasValue && employeeId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_job_documents", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.Value.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_job_id"] = jobId.ToString(),
                });
                return DeserializeRpcList<JobDocument>(rpc?.Content);
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetJobDocumentsAsync));
            }
        }

        var result = await _supabase
            .From<JobDocument>()
            .Filter("job_id", Supabase.Postgrest.Constants.Operator.Equals, jobId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<JobDocument> UploadJobDocumentAsync(
        Guid companyId, Guid jobId, FileResult file, string documentType, string documentName, Guid? employeeId = null)
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var filePath = $"job_documents/{companyId}/{jobId}/{Guid.NewGuid()}{ext}";
        await _supabase.Storage.From("workforce-media").Upload(bytes, filePath);
        var fileUrl = BuildWorkforceMediaUrl(filePath);

        if (IsCodeLoginSession() && employeeId.HasValue)
        {
            var rpc = await _supabase.Rpc("employee_insert_job_document", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_employee_id"] = employeeId.Value.ToString(),
                ["p_job_id"] = jobId.ToString(),
                ["p_document_name"] = documentName,
                ["p_document_type"] = documentType,
                ["p_file_url"] = fileUrl,
            });
            var doc = Newtonsoft.Json.JsonConvert.DeserializeObject<JobDocument>(rpc?.Content ?? "");
            if (doc != null)
            {
                _telemetry.LogSuccess("job_document_uploaded", nameof(UploadJobDocumentAsync));
                return doc;
            }
            throw new InvalidOperationException("Could not save job document.");
        }

        var insert = new JobDocument
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JobId = jobId,
            DocumentName = documentName,
            DocumentType = documentType,
            FileUrl = fileUrl,
            CreatedAt = DateTime.UtcNow
        };
        var result = await _supabase.From<JobDocument>().Insert(insert);
        return result.Models.First();
    }

    public async Task DeleteJobDocumentAsync(JobDocument document)
    {
        await _supabase
            .From<JobDocument>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, document.Id.ToString())
            .Delete();
        await TryDeleteStorageFileAsync(document.FileUrl);
    }

    public async Task<string> UploadJobPhotoAsync(Guid companyId, Guid jobId, FileResult file, string phase)
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var safePhase = string.IsNullOrWhiteSpace(phase) ? "misc" : phase.Trim().ToLowerInvariant();
        var filePath = $"job_photos/{companyId}/{jobId}/{safePhase}/{Guid.NewGuid()}{ext}";
        await _supabase.Storage.From("workforce-media").Upload(bytes, filePath);
        return BuildWorkforceMediaUrl(filePath);
    }

    public async Task AppendJobPhotoAsync(Guid companyId, Guid jobId, string phase, string photoUrl, Guid? employeeId = null)
    {
        var safePhase = string.IsNullOrWhiteSpace(phase) ? "before" : phase.Trim().ToLowerInvariant();
        try
        {
            if (employeeId.HasValue)
            {
                await _supabase.Rpc("employee_append_job_photo", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_job_id"] = jobId.ToString(),
                    ["p_phase"] = safePhase,
                    ["p_photo_url"] = photoUrl
                });
                return;
            }

            await _supabase.Rpc("append_job_photo", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_job_id"] = jobId.ToString(),
                ["p_phase"] = safePhase,
                ["p_photo_url"] = photoUrl
            });
        }
        catch
        {
            var job = await GetJobAsync(jobId, companyId, employeeId)
                ?? throw new InvalidOperationException("Job not found.");
            job.PhotoUrlsBefore ??= [];
            job.PhotoUrlsAfter ??= [];
            if (safePhase == "after")
                job.PhotoUrlsAfter.Add(photoUrl);
            else
                job.PhotoUrlsBefore.Add(photoUrl);
            await UpdateJobAsync(job);
        }
    }

    // ─── Sites ────────────────────────────────────────────────────────────────

    public async Task<List<Site>> GetSitesAsync(Guid companyId, Guid? clientId = null)
    {
        var query = _supabase
            .From<Site>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString());

        if (clientId.HasValue)
            query = query.Filter("client_id", Supabase.Postgrest.Constants.Operator.Equals, clientId.Value.ToString());

        var result = await query.Order("name", Supabase.Postgrest.Constants.Ordering.Ascending).Get();
        return result.Models;
    }

    public async Task<Site> CreateSiteAsync(Site site)
    {
        var result = await _supabase.From<Site>().Insert(site);
        return result.Models.First();
    }

    public async Task<Site> UpdateSiteAsync(Site site)
    {
        var result = await _supabase.From<Site>().Update(site);
        return result.Models.First();
    }

    // ─── Units ────────────────────────────────────────────────────────────────

    public async Task<List<Unit>> GetUnitsAsync(Guid siteId)
    {
        var result = await _supabase
            .From<Unit>()
            .Filter("site_id", Supabase.Postgrest.Constants.Operator.Equals, siteId.ToString())
            .Order("unit_number", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<Unit> CreateUnitAsync(Unit unit)
    {
        var result = await _supabase.From<Unit>().Insert(unit);
        return result.Models.First();
    }

    public async Task<Unit> UpdateUnitAsync(Unit unit)
    {
        var result = await _supabase.From<Unit>().Update(unit);
        return result.Models.First();
    }

    // ─── Residents ────────────────────────────────────────────────────────────

    public async Task<List<Resident>> GetResidentsAsync(Guid siteId)
    {
        var result = await _supabase
            .From<Resident>()
            .Filter("site_id", Supabase.Postgrest.Constants.Operator.Equals, siteId.ToString())
            .Order("name", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<Resident> CreateResidentAsync(Resident resident)
    {
        var result = await _supabase.From<Resident>().Insert(resident);
        return result.Models.First();
    }

    public async Task<Resident> UpdateResidentAsync(Resident resident)
    {
        var result = await _supabase.From<Resident>().Update(resident);
        return result.Models.First();
    }

    // ─── Assets ───────────────────────────────────────────────────────────────

    public async Task<List<Asset>> GetAssetsAsync(Guid companyId, Guid? siteId = null)
    {
        var query = _supabase
            .From<Asset>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString());

        if (siteId.HasValue)
            query = query.Filter("site_id", Supabase.Postgrest.Constants.Operator.Equals, siteId.Value.ToString());

        var result = await query.Order("asset_type", Supabase.Postgrest.Constants.Ordering.Ascending).Get();
        return result.Models;
    }

    public async Task<Asset> CreateAssetAsync(Asset asset)
    {
        var result = await _supabase.From<Asset>().Insert(asset);
        return result.Models.First();
    }

    public async Task<Asset> UpdateAssetAsync(Asset asset)
    {
        var result = await _supabase.From<Asset>().Update(asset);
        return result.Models.First();
    }

    // ─── Leave ────────────────────────────────────────────────────────────────

    public async Task<List<LeaveRequest>> GetLeaveRequestsAsync(Guid companyId, Guid? employeeId = null)
    {
        if (employeeId.HasValue)
        {
            try
            {
                return await GetMyLeaveRequestsAsync(companyId, employeeId.Value);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"employee_get_leave_requests: {ex.Message}");
            }
        }
        else if (_supabase.Auth.CurrentUser == null)
        {
            var codeEmployeeId = await ResolveCodeLoginEmployeeIdAsync();
            if (codeEmployeeId.HasValue)
            {
                try
                {
                    var rpc = await _supabase.Rpc("employee_get_company_approved_leave", new Dictionary<string, object>
                    {
                        ["p_company_id"] = companyId.ToString(),
                        ["p_employee_id"] = codeEmployeeId.Value.ToString()
                    });
                    return ParseLeaveRequestsFromRpc(rpc?.Content);
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"employee_get_company_approved_leave: {ex.Message}");
                }
            }
        }

        var query = _supabase
            .From<LeaveRequest>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString());

        if (employeeId.HasValue)
            query = query.Filter("employee_id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.Value.ToString());

        var result = await query.Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending).Get();
        return result.Models;
    }

    private static List<LeaveRequest> ParseLeaveRequestsFromRpc(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content == "null")
            return [];

        try
        {
            return Newtonsoft.Json.JsonConvert.DeserializeObject<List<LeaveRequest>>(content) ?? [];
        }
        catch
        {
            return [];
        }
    }

    public async Task<List<LeaveRequest>> GetMyLeaveRequestsAsync(Guid companyId, Guid employeeId)
    {
        var rpcResult = await _supabase.Rpc("employee_get_leave_requests", new Dictionary<string, object>
        {
            ["p_company_id"]  = companyId.ToString(),
            ["p_employee_id"] = employeeId.ToString()
        });

        var json = rpcResult?.Content;
        if (string.IsNullOrEmpty(json) || json == "null") return [];

        var arr = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement[]>(json) ?? [];
        return arr.Select(el => new LeaveRequest
        {
            Id            = Guid.Parse(el.GetProperty("id").GetString()!),
            CompanyId     = Guid.Parse(el.GetProperty("company_id").GetString()!),
            EmployeeId    = Guid.Parse(el.GetProperty("employee_id").GetString()!),
            LeaveType     = el.GetProperty("leave_type").GetString()!,
            StartDate     = DateOnly.Parse(el.GetProperty("start_date").GetString()!),
            EndDate       = DateOnly.Parse(el.GetProperty("end_date").GetString()!),
            TotalDays     = el.GetProperty("total_days").GetDouble(),
            StatusRaw     = el.GetProperty("status").GetString()!,
            Reason        = el.TryGetProperty("reason", out var r) && r.ValueKind != System.Text.Json.JsonValueKind.Null ? r.GetString() : null,
            DecisionNote  = el.TryGetProperty("decision_note", out var d) && d.ValueKind != System.Text.Json.JsonValueKind.Null ? d.GetString() : null,
            AttachmentUrl = el.TryGetProperty("attachment_url", out var a) && a.ValueKind != System.Text.Json.JsonValueKind.Null ? a.GetString() : null,
            DecidedAt     = el.TryGetProperty("decided_at", out var dt) && dt.ValueKind != System.Text.Json.JsonValueKind.Null ? DateTime.Parse(dt.GetString()!) : null,
            CreatedAt     = DateTime.Parse(el.GetProperty("created_at").GetString()!)
        }).ToList();
    }

    public async Task<LeaveRequest> CreateLeaveRequestAsync(LeaveRequest request)
    {
        // Use a SECURITY DEFINER RPC so anon (code-login) employees bypass RLS
        var rpcResult = await _supabase.Rpc("employee_submit_leave_request", new Dictionary<string, object>
        {
            ["p_company_id"]      = request.CompanyId.ToString(),
            ["p_employee_id"]     = request.EmployeeId.ToString(),
            ["p_leave_type"]      = request.LeaveType,
            ["p_start_date"]      = request.StartDate.ToString("yyyy-MM-dd"),
            ["p_end_date"]        = request.EndDate.ToString("yyyy-MM-dd"),
            ["p_total_days"]      = request.TotalDays,
            ["p_reason"]          = (object?)request.Reason ?? DBNull.Value,
            ["p_attachment_url"]  = (object?)request.AttachmentUrl ?? DBNull.Value
        });

        var json = rpcResult?.Content;
        if (string.IsNullOrEmpty(json))
            throw new Exception("Leave request submission failed.");

        var el = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(json);
        return new LeaveRequest
        {
            Id            = Guid.Parse(el.GetProperty("id").GetString()!),
            CompanyId     = Guid.Parse(el.GetProperty("company_id").GetString()!),
            EmployeeId    = Guid.Parse(el.GetProperty("employee_id").GetString()!),
            LeaveType     = el.GetProperty("leave_type").GetString()!,
            StartDate     = DateOnly.Parse(el.GetProperty("start_date").GetString()!),
            EndDate       = DateOnly.Parse(el.GetProperty("end_date").GetString()!),
            TotalDays     = el.GetProperty("total_days").GetDouble(),
            StatusRaw     = el.GetProperty("status").GetString()!,
            Reason        = el.TryGetProperty("reason", out var r) && r.ValueKind != System.Text.Json.JsonValueKind.Null ? r.GetString() : null,
            AttachmentUrl = el.TryGetProperty("attachment_url", out var a) && a.ValueKind != System.Text.Json.JsonValueKind.Null ? a.GetString() : null,
            CreatedAt     = DateTime.Parse(el.GetProperty("created_at").GetString()!)
        };
    }

    public async Task<LeaveRequest> UpdatePendingLeaveAsync(LeaveRequest request)
    {
        var rpcResult = await _supabase.Rpc("employee_update_leave_request", new Dictionary<string, object>
        {
            ["p_id"]             = request.Id.ToString(),
            ["p_employee_id"]    = request.EmployeeId.ToString(),
            ["p_leave_type"]     = request.LeaveType,
            ["p_start_date"]     = request.StartDate.ToString("yyyy-MM-dd"),
            ["p_end_date"]       = request.EndDate.ToString("yyyy-MM-dd"),
            ["p_total_days"]     = request.TotalDays,
            ["p_reason"]         = (object?)request.Reason ?? DBNull.Value,
            ["p_attachment_url"] = (object?)request.AttachmentUrl ?? DBNull.Value
        });

        var json = rpcResult?.Content;
        if (string.IsNullOrEmpty(json))
            throw new Exception("Leave request update failed.");

        var el = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(json);
        return new LeaveRequest
        {
            Id            = Guid.Parse(el.GetProperty("id").GetString()!),
            CompanyId     = Guid.Parse(el.GetProperty("company_id").GetString()!),
            EmployeeId    = Guid.Parse(el.GetProperty("employee_id").GetString()!),
            LeaveType     = el.GetProperty("leave_type").GetString()!,
            StartDate     = DateOnly.Parse(el.GetProperty("start_date").GetString()!),
            EndDate       = DateOnly.Parse(el.GetProperty("end_date").GetString()!),
            TotalDays     = el.GetProperty("total_days").GetDouble(),
            StatusRaw     = el.GetProperty("status").GetString()!,
            Reason        = el.TryGetProperty("reason", out var r) && r.ValueKind != System.Text.Json.JsonValueKind.Null ? r.GetString() : null,
            AttachmentUrl = el.TryGetProperty("attachment_url", out var a) && a.ValueKind != System.Text.Json.JsonValueKind.Null ? a.GetString() : null,
            CreatedAt     = DateTime.Parse(el.GetProperty("created_at").GetString()!)
        };
    }

    public async Task<string?> UploadLeaveAttachmentAsync(Guid employeeId, string localFilePath)
    {
        try
        {
            var ext = Path.GetExtension(localFilePath);
            var fileName = $"leave_attachments/{employeeId}/{Guid.NewGuid()}{ext}";
            var bytes = await File.ReadAllBytesAsync(localFilePath);

            await _supabase.Storage
                .From("workforce-media")
                .Upload(bytes, fileName);

            return $"{KaiFlow.Timesheets.Constants.SupabaseConfig.Url}/storage/v1/object/public/workforce-media/{fileName}";
        }
        catch
        {
            return null;
        }
    }

    // ─── Employee Documents ───────────────────────────────────────────────────

    public async Task<List<EmployeeDocument>> GetEmployeeDocumentsAsync(Guid companyId, Guid employeeId)
        => await GetMyDocumentsAsync(companyId, employeeId);

    public async Task<List<EmployeeDocument>> GetMyDocumentsAsync(Guid companyId, Guid employeeId)
    {
        var result = await _supabase.Rpc("employee_get_documents", new Dictionary<string, object>
        {
            ["p_company_id"]  = companyId.ToString(),
            ["p_employee_id"] = employeeId.ToString()
        });

        if (string.IsNullOrWhiteSpace(result.Content) || result.Content == "null")
            return [];

        var arr = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement[]>(result.Content) ?? [];
        return arr.Select(ParseEmployeeDocument).ToList();
    }

    public async Task<EmployeeDocument> UploadEmployeeDocumentAsync(
        Guid companyId, Guid employeeId, FileResult file,
        string documentType, string documentName, string uploadedByRole = "hr")
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var filePath = $"employee_documents/{companyId}/{employeeId}/{Guid.NewGuid()}{ext}";

        try
        {
            await _supabase.Storage.From("workforce-media").Upload(bytes, filePath);
        }
        catch (Exception ex)
        {
            throw new Exception($"Could not upload file to storage: {ex.Message}", ex);
        }

        var fileUrl = BuildWorkforceMediaUrl(filePath);
        if (uploadedByRole == "employee")
        {
            var rpcResult = await _supabase.Rpc("employee_submit_document", new Dictionary<string, object>
            {
                ["p_company_id"]    = companyId.ToString(),
                ["p_employee_id"]   = employeeId.ToString(),
                ["p_document_type"] = documentType,
                ["p_document_name"] = documentName,
                ["p_file_url"]      = fileUrl
            });
            return ParseEmployeeDocumentRpcResult(rpcResult?.Content);
        }

        return await InsertEmployeeDocumentViaTable(companyId, employeeId, documentType, documentName, fileUrl, "hr");
    }

    public async Task<EmployeeDocument> ReplaceEmployeeDocumentAsync(
        EmployeeDocument existing, FileResult file,
        string documentType, string documentName, string uploadedByRole)
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var filePath = $"employee_documents/{existing.CompanyId}/{existing.EmployeeId}/{Guid.NewGuid()}{ext}";

        try
        {
            await _supabase.Storage.From("workforce-media").Upload(bytes, filePath);
        }
        catch (Exception ex)
        {
            throw new Exception($"Could not upload replacement file: {ex.Message}", ex);
        }

        var fileUrl = BuildWorkforceMediaUrl(filePath);
        var oldUrl = existing.FileUrl;

        EmployeeDocument updated;
        if (uploadedByRole == "employee")
        {
            updated = await UpdateEmployeeDocumentViaRpc(
                existing.Id, existing.CompanyId, existing.EmployeeId,
                documentType, documentName, fileUrl);
        }
        else
        {
            existing.DocumentType = documentType;
            existing.DocumentName = documentName;
            existing.FileUrl = fileUrl;
            existing.UploadedByRole = "hr";
            var result = await _supabase.From<EmployeeDocument>().Update(existing);
            updated = result.Models.FirstOrDefault() ?? existing;
        }

        await TryDeleteStorageFileAsync(oldUrl);
        return updated;
    }

    public async Task DeleteEmployeeDocumentAsync(EmployeeDocument document)
    {
        await _supabase
            .From<EmployeeDocument>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, document.Id.ToString())
            .Delete();

        await TryDeleteStorageFileAsync(document.FileUrl);
    }

    private static async Task<(byte[] Bytes, string Extension)> ReadPickerFileAsync(FileResult file)
    {
        await using var stream = await file.OpenReadAsync();
        using var ms = new MemoryStream();
        await stream.CopyToAsync(ms);

        var ext = Path.GetExtension(file.FileName);
        if (string.IsNullOrEmpty(ext))
            ext = Path.GetExtension(file.FullPath);
        if (string.IsNullOrEmpty(ext))
            ext = ".bin";

        return (ms.ToArray(), ext);
    }

    private static string BuildWorkforceMediaUrl(string filePath) =>
        $"{KaiFlow.Timesheets.Constants.SupabaseConfig.Url}/storage/v1/object/public/workforce-media/{filePath}";

    private async Task<EmployeeDocument> InsertEmployeeDocumentViaTable(
        Guid companyId, Guid employeeId, string documentType, string documentName, string fileUrl, string role)
    {
        var doc = new EmployeeDocument
        {
            CompanyId      = companyId,
            EmployeeId     = employeeId,
            DocumentType   = documentType,
            DocumentName   = documentName,
            FileUrl        = fileUrl,
            UploadedByRole = role
        };
        var result = await _supabase.From<EmployeeDocument>().Insert(doc);
        var inserted = result.Models.First();
        inserted.CreatedAt = NormalizeDocumentCreatedAt(inserted.CreatedAt);
        return inserted;
    }

    private async Task<EmployeeDocument> UpdateEmployeeDocumentViaRpc(
        Guid documentId, Guid companyId, Guid employeeId,
        string documentType, string documentName, string fileUrl)
    {
        var rpcResult = await _supabase.Rpc("employee_update_document", new Dictionary<string, object>
        {
            ["p_document_id"]   = documentId.ToString(),
            ["p_company_id"]    = companyId.ToString(),
            ["p_employee_id"]   = employeeId.ToString(),
            ["p_document_type"] = documentType,
            ["p_document_name"] = documentName,
            ["p_file_url"]      = fileUrl
        });
        return ParseEmployeeDocumentRpcResult(rpcResult?.Content);
    }

    private static EmployeeDocument ParseEmployeeDocumentRpcResult(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json == "null")
            throw new Exception("Document operation failed.");

        var el = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(json);
        return ParseEmployeeDocument(el);
    }

    private static EmployeeDocument ParseEmployeeDocument(System.Text.Json.JsonElement el)
    {
        static Guid ReqGuid(System.Text.Json.JsonElement e, string key) =>
            Guid.Parse(e.GetProperty(key).GetString()!);
        static string ReqStr(System.Text.Json.JsonElement e, string key) =>
            e.GetProperty(key).GetString() ?? "";

        return new EmployeeDocument
        {
            Id             = ReqGuid(el, "id"),
            CompanyId      = ReqGuid(el, "company_id"),
            EmployeeId     = ReqGuid(el, "employee_id"),
            DocumentType   = ReqStr(el, "document_type"),
            DocumentName   = ReqStr(el, "document_name"),
            FileUrl        = ReqStr(el, "file_url"),
            UploadedByRole = ReqStr(el, "uploaded_by_role"),
            CreatedAt      = ParseDocumentCreatedAt(el)
        };
    }

    private static DateTime ParseDocumentCreatedAt(System.Text.Json.JsonElement el)
    {
        if (!el.TryGetProperty("created_at", out var ca) || ca.ValueKind == System.Text.Json.JsonValueKind.Null)
            return DateTime.UtcNow;

        if (ca.ValueKind == System.Text.Json.JsonValueKind.String)
        {
            var raw = ca.GetString();
            if (!string.IsNullOrWhiteSpace(raw)
                && DateTime.TryParse(raw, null, System.Globalization.DateTimeStyles.RoundtripKind, out var parsed))
                return parsed.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(parsed, DateTimeKind.Utc) : parsed;
        }

        return DateTime.UtcNow;
    }

    private static DateTime NormalizeDocumentCreatedAt(DateTime createdAt)
        => createdAt.Year < 2000 ? DateTime.UtcNow : createdAt;

    private static string? StoragePathFromPublicUrl(string? fileUrl)
    {
        if (string.IsNullOrWhiteSpace(fileUrl)) return null;
        const string marker = "/storage/v1/object/public/workforce-media/";
        var idx = fileUrl.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        return idx < 0 ? null : fileUrl[(idx + marker.Length)..];
    }

    private async Task TryDeleteStorageFileAsync(string? fileUrl)
    {
        var path = StoragePathFromPublicUrl(fileUrl);
        if (path == null) return;
        try
        {
            await _supabase.Storage.From("workforce-media").Remove([path]);
        }
        catch
        {
            // Storage delete is best-effort; DB row is already removed/updated.
        }
    }

    public async Task<List<DailyAbsence>> GetDailyAbsencesAsync(Guid companyId, DateOnly date, Guid? employeeId = null)
    {
        if (employeeId.HasValue)
        {
            var range = await GetDailyAbsencesRangeAsync(companyId, date, date, employeeId);
            return range;
        }

        var query = _supabase
            .From<DailyAbsence>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("date", Supabase.Postgrest.Constants.Operator.Equals, date.ToString("yyyy-MM-dd"));

        var result = await query.Get();
        return result.Models;
    }

    public async Task<List<DailyAbsence>> GetDailyAbsencesRangeAsync(Guid companyId, DateOnly from, DateOnly to, Guid? employeeId = null)
    {
        if (employeeId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_daily_absences", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_from"] = from.ToString("yyyy-MM-dd"),
                    ["p_to"] = to.ToString("yyyy-MM-dd")
                });
                if (!string.IsNullOrWhiteSpace(rpc?.Content) && rpc.Content != "null")
                    return Newtonsoft.Json.JsonConvert.DeserializeObject<List<DailyAbsence>>(rpc.Content) ?? [];
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"employee_get_daily_absences: {ex.Message}");
            }
        }

        var query = _supabase
            .From<DailyAbsence>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("date", Supabase.Postgrest.Constants.Operator.GreaterThanOrEqual, from.ToString("yyyy-MM-dd"))
            .Filter("date", Supabase.Postgrest.Constants.Operator.LessThanOrEqual,    to.ToString("yyyy-MM-dd"));

        if (employeeId.HasValue)
            query = query.Filter("employee_id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.Value.ToString());

        var result = await query.Get();
        return result.Models;
    }

    public async Task<DailyAbsence> ReportAbsenceAsync(DailyAbsence absence)
    {
        var rpcResult = await _supabase.Rpc("employee_report_absence", new Dictionary<string, object>
        {
            ["p_company_id"]  = absence.CompanyId.ToString(),
            ["p_employee_id"] = absence.EmployeeId.ToString(),
            ["p_date"]        = absence.Date.ToString("yyyy-MM-dd"),
            ["p_reason"]      = absence.Reason,
            ["p_note"]        = (object?)absence.Note ?? DBNull.Value
        });

        var json = rpcResult?.Content;
        if (string.IsNullOrEmpty(json))
            throw new Exception("Absence report failed.");

        var el = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(json);
        return new DailyAbsence
        {
            Id         = Guid.Parse(el.GetProperty("id").GetString()!),
            CompanyId  = Guid.Parse(el.GetProperty("company_id").GetString()!),
            EmployeeId = Guid.Parse(el.GetProperty("employee_id").GetString()!),
            Date       = DateOnly.Parse(el.GetProperty("date").GetString()!),
            Reason     = el.GetProperty("reason").GetString()!,
            Note       = el.TryGetProperty("note", out var n) && n.ValueKind != System.Text.Json.JsonValueKind.Null ? n.GetString() : null,
            CreatedAt  = DateTime.Parse(el.GetProperty("created_at").GetString()!)
        };
    }

    public async Task<LeaveRequest> UpdateLeaveStatusAsync(Guid requestId, string status, string? decisionNote = null)
    {
        var fetched = await _supabase
            .From<LeaveRequest>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, requestId.ToString())
            .Get();

        var request = fetched.Models.First();
        request.StatusRaw = status;
        if (decisionNote != null) request.DecisionNote = decisionNote;

        var result = await _supabase.From<LeaveRequest>().Update(request);
        return result.Models.First();
    }

    // ─── Labor ────────────────────────────────────────────────────────────────

    public async Task<List<LaborEntry>> GetLaborEntriesAsync(Guid companyId, DateOnly from, DateOnly to, Guid? employeeId = null, Guid? jobId = null)
    {
        var query = _supabase
            .From<LaborEntry>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("work_date", Supabase.Postgrest.Constants.Operator.GreaterThanOrEqual, from.ToString())
            .Filter("work_date", Supabase.Postgrest.Constants.Operator.LessThanOrEqual, to.ToString());

        if (employeeId.HasValue)
            query = query.Filter("employee_id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.Value.ToString());

        if (jobId.HasValue)
            query = query.Filter("job_id", Supabase.Postgrest.Constants.Operator.Equals, jobId.Value.ToString());

        var result = await query.Order("work_date", Supabase.Postgrest.Constants.Ordering.Descending).Get();
        return result.Models;
    }

    public async Task<LaborEntry> CreateLaborEntryAsync(LaborEntry entry)
    {
        var result = await _supabase.From<LaborEntry>().Insert(entry);
        return result.Models.First();
    }

    public async Task DeleteLaborEntryAsync(Guid entryId)
    {
        await _supabase
            .From<LaborEntry>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, entryId.ToString())
            .Delete();
    }

    // ─── Incidents ────────────────────────────────────────────────────────────

    public async Task<List<IncidentReport>> GetIncidentsAsync(
        Guid companyId, Guid? employeeId = null, Guid? jobId = null, bool includeClosed = true)
    {
        if (employeeId.HasValue)
        {
            try
            {
                var args = new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_include_closed"] = includeClosed,
                };
                if (jobId.HasValue)
                    args["p_job_id"] = jobId.Value.ToString();

                var rpc = await _supabase.Rpc("employee_get_incidents", args);
                var list = DeserializeRpcList<IncidentReport>(rpc?.Content);
                if (list.Count > 0 || IsCodeLoginSession())
                    return list;
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetIncidentsAsync), new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["path"] = "employee_get_incidents",
                });
                if (IsCodeLoginSession())
                    return [];
            }
        }

        var query = _supabase
            .From<IncidentReport>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString());

        if (jobId.HasValue)
            query = query.Filter("job_id", Supabase.Postgrest.Constants.Operator.Equals, jobId.Value.ToString());
        if (!includeClosed)
            query = query.Filter("is_closed", Supabase.Postgrest.Constants.Operator.Equals, "false");

        var result = await query
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<IncidentReport?> GetIncidentAsync(Guid incidentId, Guid? companyId = null, Guid? employeeId = null)
    {
        if (IsCodeLoginSession() && companyId.HasValue && employeeId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_incident", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.Value.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_incident_id"] = incidentId.ToString(),
                });
                return ParseIncidentFromRpc(rpc?.Content);
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetIncidentAsync), new Dictionary<string, string>
                {
                    ["incident_id"] = incidentId.ToString(),
                    ["path"] = "employee_get_incident",
                });
                return null;
            }
        }

        var result = await _supabase
            .From<IncidentReport>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, incidentId.ToString())
            .Single();
        return result;
    }

    public async Task<IncidentReport> CreateIncidentAsync(
        IncidentReport incident, IReadOnlyList<string>? localPhotoPaths = null)
    {
        if (incident.EmployeeId is not { } empId || empId == Guid.Empty)
        {
            if (IsCodeLoginSession())
                throw new InvalidOperationException("Could not save incident: employee context required.");
            var inserted = await _supabase.From<IncidentReport>().Insert(incident);
            _realtime.NotifyIncidentChanged();
            return inserted.Models.First();
        }

        if (Connectivity.NetworkAccess != NetworkAccess.Internet)
            throw new InvalidOperationException("No internet connection. Incident will be queued for sync.");

        var photoUrls = new List<string>(incident.PhotoUrls ?? []);
        if (localPhotoPaths is { Count: > 0 })
        {
            foreach (var path in localPhotoPaths)
            {
                var url = await UploadIncidentPhotoAsync(incident.CompanyId, empId, path);
                if (url != null)
                    photoUrls.Add(url);
                else
                    _telemetry.LogWarning("incident photo upload failed", nameof(CreateIncidentAsync),
                        new Dictionary<string, string> { ["path"] = path });
            }
        }

        try
        {
            var args = new Dictionary<string, object>
            {
                ["p_company_id"] = incident.CompanyId.ToString(),
                ["p_employee_id"] = empId.ToString(),
                ["p_description"] = incident.Description.Trim(),
                ["p_severity"] = incident.SeverityRaw ?? "low",
                ["p_category"] = incident.CategoryRaw ?? "general",
                ["p_photo_urls"] = photoUrls.Count > 0 ? photoUrls.ToArray() : Array.Empty<string>(),
            };
            if (!string.IsNullOrWhiteSpace(incident.Title))
                args["p_title"] = incident.Title.Trim();
            if (incident.JobId.HasValue)
                args["p_job_id"] = incident.JobId.Value.ToString();
            if (incident.SiteId.HasValue)
                args["p_site_id"] = incident.SiteId.Value.ToString();
            if (incident.AssigneeId.HasValue)
                args["p_assignee_id"] = incident.AssigneeId.Value.ToString();
            if (!string.IsNullOrWhiteSpace(incident.ReportedByName))
                args["p_reported_by_name"] = incident.ReportedByName;
            if (incident.OccurredAt.HasValue)
                args["p_occurred_at"] = incident.OccurredAt.Value.ToString("o");
            if (incident.Latitude.HasValue)
                args["p_latitude"] = incident.Latitude.Value;
            if (incident.Longitude.HasValue)
                args["p_longitude"] = incident.Longitude.Value;
            if (!string.IsNullOrWhiteSpace(incident.LocationText))
                args["p_location_text"] = incident.LocationText;

            var rpc = await _supabase.Rpc("employee_insert_incident", args);
            var created = ParseIncidentFromRpc(rpc?.Content);
            if (created != null)
            {
                _realtime.NotifyIncidentChanged();
                _telemetry.LogSuccess("incident_created", nameof(CreateIncidentAsync), new Dictionary<string, string>
                {
                    ["incident_id"] = created.Id.ToString(),
                    ["job_id"] = incident.JobId?.ToString() ?? "",
                    ["standalone"] = incident.JobId.HasValue ? "false" : "true",
                });
                return created;
            }

            throw new InvalidOperationException("Incident RPC returned empty response.");
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(CreateIncidentAsync), new Dictionary<string, string>
            {
                ["company_id"] = incident.CompanyId.ToString(),
                ["employee_id"] = empId.ToString(),
                ["job_id"] = incident.JobId?.ToString() ?? "",
                ["path"] = "employee_insert_incident",
            });
            if (IsCodeLoginSession())
                throw new InvalidOperationException($"Could not save incident: {ex.Message}", ex);
            throw;
        }
    }

    public async Task<IncidentReport> UpdateIncidentAsync(IncidentReport incident, Guid? actingEmployeeId = null)
    {
        var actorId = actingEmployeeId ?? _state.CurrentEmployee?.Id;

        if (IsCodeLoginSession() && actorId is { } aid && aid != Guid.Empty)
        {
            try
            {
                var args = new Dictionary<string, object>
                {
                    ["p_company_id"] = incident.CompanyId.ToString(),
                    ["p_employee_id"] = aid.ToString(),
                    ["p_incident_id"] = incident.Id.ToString(),
                };
                if (!string.IsNullOrWhiteSpace(incident.StatusRaw))
                    args["p_status"] = incident.StatusRaw;
                if (incident.ResolutionNotes != null)
                    args["p_resolution_notes"] = incident.ResolutionNotes;
                if (incident.AssigneeId.HasValue)
                    args["p_assignee_id"] = incident.AssigneeId.Value.ToString();
                else if (incident.AssigneeId == null && incident.IsClosed)
                    args["p_clear_assignee"] = false;

                var rpc = await _supabase.Rpc("employee_update_incident", args);
                var updated = ParseIncidentFromRpc(rpc?.Content);
                if (updated != null)
                {
                    _realtime.NotifyIncidentChanged();
                    _telemetry.LogSuccess("incident_updated", nameof(UpdateIncidentAsync), new Dictionary<string, string>
                    {
                        ["incident_id"] = incident.Id.ToString(),
                        ["status"] = incident.StatusRaw,
                    });
                    return updated;
                }
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(UpdateIncidentAsync), new Dictionary<string, string>
                {
                    ["incident_id"] = incident.Id.ToString(),
                    ["path"] = "employee_update_incident",
                });
                throw new InvalidOperationException($"Could not update incident: {ex.Message}", ex);
            }
        }

        incident.UpdatedAt = DateTime.UtcNow;
        if (incident.IsClosed || incident.StatusRaw is "closed" or "resolved")
            incident.IsClosed = true;

        var result = await _supabase.From<IncidentReport>().Update(incident);
        _realtime.NotifyIncidentChanged();
        _telemetry.LogSuccess("incident_updated", nameof(UpdateIncidentAsync), new Dictionary<string, string>
        {
            ["incident_id"] = incident.Id.ToString(),
            ["path"] = "postgrest",
        });
        return result.Models.First();
    }

    public async Task<List<IncidentComment>> GetIncidentCommentsAsync(
        Guid companyId, Guid employeeId, Guid incidentId)
    {
        if (IsCodeLoginSession())
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_incident_comments", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.ToString(),
                    ["p_incident_id"] = incidentId.ToString(),
                });
                return DeserializeRpcList<IncidentComment>(rpc?.Content);
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetIncidentCommentsAsync));
            }
        }

        var result = await _supabase
            .From<IncidentComment>()
            .Filter("incident_id", Supabase.Postgrest.Constants.Operator.Equals, incidentId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<IncidentComment> AddIncidentCommentAsync(
        Guid companyId, Guid employeeId, Guid incidentId, string body)
    {
        try
        {
            var rpc = await _supabase.Rpc("employee_add_incident_comment", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_employee_id"] = employeeId.ToString(),
                ["p_incident_id"] = incidentId.ToString(),
                ["p_body"] = body.Trim(),
            });
            var comment = Newtonsoft.Json.JsonConvert.DeserializeObject<IncidentComment>(rpc?.Content ?? "");
            if (comment != null)
            {
                _realtime.NotifyIncidentChanged();
                _telemetry.LogSuccess("incident_comment_added", nameof(AddIncidentCommentAsync), new Dictionary<string, string>
                {
                    ["incident_id"] = incidentId.ToString(),
                });
                return comment;
            }
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(AddIncidentCommentAsync));
            throw new InvalidOperationException($"Could not add comment: {ex.Message}", ex);
        }

        throw new InvalidOperationException("Could not add comment.");
    }

    public async Task<List<IncidentStatusHistory>> GetIncidentStatusHistoryAsync(
        Guid companyId, Guid employeeId, Guid incidentId)
    {
        if (IsCodeLoginSession())
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_incident_status_history", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.ToString(),
                    ["p_incident_id"] = incidentId.ToString(),
                });
                return DeserializeRpcList<IncidentStatusHistory>(rpc?.Content);
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetIncidentStatusHistoryAsync));
            }
        }

        var result = await _supabase
            .From<IncidentStatusHistory>()
            .Filter("incident_id", Supabase.Postgrest.Constants.Operator.Equals, incidentId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<string?> UploadIncidentPhotoAsync(Guid companyId, Guid employeeId, string localFilePath)
    {
        try
        {
            var ext = Path.GetExtension(localFilePath);
            var fileName = $"incident_reports/{companyId}/{employeeId}/{Guid.NewGuid()}{ext}";
            var bytes = await File.ReadAllBytesAsync(localFilePath);

            await _supabase.Storage
                .From("workforce-media")
                .Upload(bytes, fileName);

            var url = $"{KaiFlow.Timesheets.Constants.SupabaseConfig.Url}/storage/v1/object/public/workforce-media/{fileName}";
            _telemetry.LogSuccess("incident_photo_uploaded", nameof(UploadIncidentPhotoAsync));
            return url;
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(UploadIncidentPhotoAsync));
            return null;
        }
    }

    public async Task<JobFeedback> SubmitJobFeedbackAsync(
        Guid companyId, Guid employeeId, Guid jobId, int rating, string? comments = null)
    {
        try
        {
            var rpc = await _supabase.Rpc("employee_submit_job_feedback", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_employee_id"] = employeeId.ToString(),
                ["p_job_id"] = jobId.ToString(),
                ["p_rating"] = rating,
                ["p_comments"] = comments ?? null!,
            });
            var content = rpc?.Content;
            if (!string.IsNullOrWhiteSpace(content) && content != "null")
            {
                var saved = Newtonsoft.Json.JsonConvert.DeserializeObject<JobFeedback>(content);
                if (saved != null)
                {
                    _telemetry.LogSuccess("job_feedback_submitted", nameof(SubmitJobFeedbackAsync), new Dictionary<string, string>
                    {
                        ["job_id"] = jobId.ToString(),
                        ["rating"] = rating.ToString(),
                    });
                    return saved;
                }
            }
        }
        catch (Exception ex)
        {
            _telemetry.LogError(ex, nameof(SubmitJobFeedbackAsync), new Dictionary<string, string>
            {
                ["job_id"] = jobId.ToString(),
                ["path"] = "employee_submit_job_feedback",
            });
            throw new InvalidOperationException($"Could not save feedback: {ex.Message}", ex);
        }

        throw new InvalidOperationException("Could not save feedback.");
    }

    public async Task<List<JobFeedback>> GetJobFeedbackAsync(Guid companyId, Guid employeeId, Guid jobId)
    {
        if (IsCodeLoginSession())
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_job_feedback", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.ToString(),
                    ["p_job_id"] = jobId.ToString(),
                });
                return DeserializeRpcList<JobFeedback>(rpc?.Content);
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetJobFeedbackAsync), new Dictionary<string, string>
                {
                    ["job_id"] = jobId.ToString(),
                });
            }
        }

        var result = await _supabase
            .From<JobFeedback>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("job_id", Supabase.Postgrest.Constants.Operator.Equals, jobId.ToString())
            .Order("submitted_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    private static IncidentReport? ParseIncidentFromRpc(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content == "null")
            return null;
        try
        {
            return Newtonsoft.Json.JsonConvert.DeserializeObject<IncidentReport>(content);
        }
        catch
        {
            return null;
        }
    }

    // ─── Inventory ────────────────────────────────────────────────────────────

    public async Task<List<InventoryItem>> GetInventoryItemsAsync(Guid companyId)
    {
        if (IsCodeLoginSession())
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_inventory_items", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                });
                var items = DeserializeRpcList<InventoryItem>(rpc?.Content);
                if (items.Count > 0 || !string.IsNullOrWhiteSpace(rpc?.Content))
                    return items;
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetInventoryItemsAsync), new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["path"] = "employee_get_inventory_items",
                });
            }
        }

        var result = await _supabase
            .From<InventoryItem>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Order("name", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<InventoryItem?> GetInventoryItemAsync(Guid itemId)
    {
        var result = await _supabase
            .From<InventoryItem>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, itemId.ToString())
            .Get();
        return result.Models.FirstOrDefault();
    }

    public async Task<InventoryItem> CreateInventoryItemAsync(InventoryItem item)
    {
        var result = await _supabase.From<InventoryItem>().Insert(item);
        return result.Models.First();
    }

    public async Task<InventoryItem> UpdateInventoryItemAsync(InventoryItem item)
    {
        var result = await _supabase.From<InventoryItem>().Update(item);
        return result.Models.First();
    }

    public async Task<List<InventoryUsage>> GetInventoryUsageAsync(Guid companyId, Guid? jobId = null)
    {
        if (IsCodeLoginSession() && jobId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_inventory_usage_for_job", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_job_id"] = jobId.Value.ToString(),
                });
                var usage = DeserializeRpcList<InventoryUsage>(rpc?.Content);
                if (usage.Count > 0 || !string.IsNullOrWhiteSpace(rpc?.Content))
                    return usage;
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetInventoryUsageAsync), new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["job_id"] = jobId.Value.ToString(),
                    ["path"] = "employee_get_inventory_usage_for_job",
                });
            }
        }

        var query = _supabase
            .From<InventoryUsage>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString());

        if (jobId.HasValue)
            query = query.Filter("job_id", Supabase.Postgrest.Constants.Operator.Equals, jobId.Value.ToString());

        var result = await query.Get();
        return result.Models;
    }

    public async Task<InventoryUsage> CreateInventoryUsageAsync(InventoryUsage usage)
    {
        if (IsCodeLoginSession()
            && usage.JobId is { } jobId
            && usage.EmployeeId is { } employeeId)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_inventory_usage_for_job", new Dictionary<string, object>
                {
                    ["p_company_id"] = usage.CompanyId.ToString(),
                    ["p_job_id"] = jobId.ToString(),
                    ["p_employee_id"] = employeeId.ToString(),
                });
                var existing = DeserializeRpcList<InventoryUsage>(rpc?.Content);
                var merged = existing
                    .GroupBy(u => u.InventoryItemId)
                    .ToDictionary(g => g.Key, g => g.Sum(u => u.QuantityUsed));

                merged.TryGetValue(usage.InventoryItemId, out var priorQty);
                merged[usage.InventoryItemId] = priorQty + usage.QuantityUsed;

                var payload = merged
                    .Where(kv => kv.Value > 0)
                    .Select(kv => new { inventory_item_id = kv.Key.ToString(), quantity = kv.Value.ToString() })
                    .ToArray();

                await _supabase.Rpc("employee_set_inventory_usage_for_job", new Dictionary<string, object>
                {
                    ["p_company_id"] = usage.CompanyId.ToString(),
                    ["p_employee_id"] = employeeId.ToString(),
                    ["p_job_id"] = jobId.ToString(),
                    ["p_usages"] = Newtonsoft.Json.JsonConvert.SerializeObject(payload),
                });

                usage.Id = Guid.NewGuid();
                if (!PortalDateHelper.IsSet(usage.UsedAt))
                    usage.UsedAt = DateTime.UtcNow;
                return usage;
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(CreateInventoryUsageAsync), new Dictionary<string, string>
                {
                    ["company_id"] = usage.CompanyId.ToString(),
                    ["job_id"] = jobId.ToString(),
                    ["path"] = "employee_set_inventory_usage_for_job",
                });
                throw;
            }
        }

        var result = await _supabase.From<InventoryUsage>().Insert(usage);
        return result.Models.First();
    }

    public async Task<InventoryItem?> AllocateInventoryToJobAsync(
        Guid companyId, Guid jobId, Guid employeeId, Guid inventoryItemId, double quantity, double unitCost)
    {
        // HR / JWT → single atomic, row-locked RPC (insert usage + decrement stock in one tx).
        if (!IsCodeLoginSession())
        {
            try
            {
                await _supabase.Rpc("hr_allocate_inventory_to_job", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_job_id"] = jobId.ToString(),
                    ["p_employee_id"] = employeeId.ToString(),
                    ["p_inventory_item_id"] = inventoryItemId.ToString(),
                    ["p_quantity"] = quantity,
                    ["p_unit_cost"] = unitCost,
                });
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(AllocateInventoryToJobAsync), new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["job_id"] = jobId.ToString(),
                    ["inventory_item_id"] = inventoryItemId.ToString(),
                    ["path"] = "hr_allocate_inventory_to_job",
                });
                throw;
            }

            // Re-fetch authoritative post-decrement state.
            return await GetInventoryItemAsync(inventoryItemId);
        }

        // Code-login worker → the (now fixed) merge RPC handles stock atomically server-side.
        await CreateInventoryUsageAsync(new InventoryUsage
        {
            CompanyId = companyId,
            JobId = jobId,
            EmployeeId = employeeId,
            InventoryItemId = inventoryItemId,
            QuantityUsed = quantity,
            UnitCostAtUse = unitCost,
            UsedAt = DateTime.UtcNow
        });
        return await GetInventoryItemAsync(inventoryItemId);
    }

    // ─── Contractors ──────────────────────────────────────────────────────────

    public async Task<List<Contractor>> GetContractorsAsync(Guid companyId)
    {
        var result = await _supabase
            .From<Contractor>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Order("name", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<List<Contractor>> GetLinkedContractorsForEmployeeAsync(Guid companyId, Guid employeeId)
    {
        if (IsCodeLoginSession())
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_linked_contractors", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.ToString(),
                });
                return DeserializeRpcList<Contractor>(rpc?.Content);
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetLinkedContractorsForEmployeeAsync), new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["employee_id"] = employeeId.ToString(),
                });
            }
        }

        var contractors = await GetContractorsAsync(companyId);
        var linked = new List<Contractor>();
        foreach (var c in contractors)
        {
            var links = await GetContractorMemberLinksAsync(c.Id);
            if (links.Any(l => l.EmployeeId == employeeId))
                linked.Add(c);
        }
        return linked;
    }

    public async Task<Contractor> CreateContractorAsync(Contractor contractor)
    {
        if (string.IsNullOrWhiteSpace(contractor.ContractorCode)
            && PartnerKinds.IsContractorKind(contractor.PartnerKindRaw))
            contractor.ContractorCode = await GenerateNextContractorCodeAsync(contractor.CompanyId);
        var result = await _supabase.From<Contractor>().Insert(contractor);
        return result.Models.First();
    }

    public async Task<string> GenerateNextContractorCodeAsync(Guid companyId)
    {
        var company = await GetCurrentCompanyAsync(companyId);
        var prefix = EntityCodeHelper.ContractorPrefix(company?.Code ?? "");
        var contractors = await GetContractorsAsync(companyId);
        return EntityCodeHelper.NextCode(prefix, contractors.Select(c => c.ContractorCode));
    }

    public async Task<ContractorPortalLogin?> ResolveContractorByCodeAsync(string companyCode, string contractorCode)
    {
        if (string.IsNullOrWhiteSpace(companyCode) || string.IsNullOrWhiteSpace(contractorCode))
            return null;

        var rows = await _supabase.Rpc("contractor_resolve_by_code", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant()
        });

        var content = rows?.Content;
        if (string.IsNullOrWhiteSpace(content) || content == "[]") return null;

        using var doc = System.Text.Json.JsonDocument.Parse(content);
        var el = doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array
            ? doc.RootElement[0]
            : doc.RootElement;

        return new ContractorPortalLogin
        {
            ContractorId = el.TryGetProperty("contractor_id", out var cid) ? Guid.Parse(cid.GetString()!) : Guid.Empty,
            CompanyId = el.TryGetProperty("company_id", out var coid) ? Guid.Parse(coid.GetString()!) : Guid.Empty,
            CompanyCode = el.TryGetProperty("company_code", out var cc) ? cc.GetString() ?? "" : "",
            ContractorCode = el.TryGetProperty("contractor_code", out var ctc) ? ctc.GetString() ?? "" : "",
            ContractorName = el.TryGetProperty("contractor_name", out var cn) ? cn.GetString() ?? "" : ""
        };
    }

    public async Task<Contractor> UpdateContractorAsync(Contractor contractor)
    {
        var result = await _supabase.From<Contractor>().Update(contractor);
        return result.Models.First();
    }

    public async Task<List<ContractorMemberLink>> GetContractorMemberLinksAsync(Guid contractorId)
    {
        var result = await _supabase
            .From<ContractorMemberLink>()
            .Filter("contractor_id", Supabase.Postgrest.Constants.Operator.Equals, contractorId.ToString())
            .Get();
        return result.Models;
    }

    public async Task<ContractorMemberLink> CreateContractorMemberLinkAsync(ContractorMemberLink link)
    {
        var result = await _supabase.From<ContractorMemberLink>().Insert(link);
        return result.Models.First();
    }

    // ─── Job site visits ──────────────────────────────────────────────────────

    public async Task<List<JobSiteVisit>> GetJobSiteVisitsAsync(Guid jobId)
    {
        var rows = await _supabase.Rpc("get_job_site_visits", new Dictionary<string, object>
        {
            ["p_job_id"] = jobId.ToString()
        });
        return ParseJobSiteVisits(rows?.Content);
    }

    public async Task<JobSiteVisit?> EmployeeJobSiteOpenVisitAsync(Guid companyId, Guid employeeId)
    {
        var rows = await _supabase.Rpc("employee_job_site_open_visit", new Dictionary<string, object>
        {
            ["p_company_id"] = companyId.ToString(),
            ["p_employee_id"] = employeeId.ToString()
        });
        return ParseJobSiteVisit(rows?.Content);
    }

    public async Task<JobSiteVisit> EmployeeJobSiteSignInAsync(
        Guid companyId, Guid employeeId, Guid jobId,
        double? lat, double? lng, string? address, string? reportedByName = null, string? notes = null)
    {
        var args = BuildSiteVisitArgs(companyId, employeeId, jobId, lat, lng, address, reportedByName, notes);
        var rows = await _supabase.Rpc("employee_job_site_sign_in", args);
        return ParseJobSiteVisit(rows?.Content) ?? throw new InvalidOperationException("Sign-in failed.");
    }

    public async Task<JobSiteVisit> EmployeeJobSiteSignOutAsync(
        Guid companyId, Guid employeeId, Guid jobId,
        double? lat, double? lng, string? address, string? notes = null)
    {
        var args = new Dictionary<string, object>
        {
            ["p_company_id"] = companyId.ToString(),
            ["p_employee_id"] = employeeId.ToString(),
            ["p_job_id"] = jobId.ToString()
        };
        if (lat.HasValue) args["p_latitude"] = lat.Value;
        if (lng.HasValue) args["p_longitude"] = lng.Value;
        if (address != null) args["p_address"] = address;
        if (notes != null) args["p_notes"] = notes;
        var rows = await _supabase.Rpc("employee_job_site_sign_out", args);
        return ParseJobSiteVisit(rows?.Content) ?? throw new InvalidOperationException("Sign-out failed.");
    }

    public async Task<JobSiteVisit?> EmployeeJobSiteSignOutOpenVisitAsync(
        Guid companyId, Guid employeeId, string? notes = null)
    {
        try
        {
            var args = new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_employee_id"] = employeeId.ToString()
            };
            if (notes != null) args["p_notes"] = notes;
            var rows = await _supabase.Rpc("employee_job_site_sign_out_open_visit", args);
            return ParseJobSiteVisit(rows?.Content);
        }
        catch
        {
            return null;
        }
    }

    public async Task<JobSiteVisit> EmployeeJobSiteSwitchToJobAsync(
        Guid companyId, Guid employeeId, Guid jobId,
        double? lat, double? lng, string? address, string? reportedByName = null, string? notes = null)
    {
        var args = BuildSiteVisitArgs(companyId, employeeId, jobId, lat, lng, address, reportedByName, notes);
        var rows = await _supabase.Rpc("employee_job_site_switch_to_job", args);
        return ParseJobSiteVisit(rows?.Content) ?? throw new InvalidOperationException("Could not switch to this job site.");
    }

    // ─── Contractor portal ────────────────────────────────────────────────────

    public async Task<List<Job>> GetContractorPortalJobsAsync(string companyCode, string contractorCode)
    {
        var rows = await _supabase.Rpc("contractor_portal_list_jobs", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant()
        });
        return ParseContractorPortalJobs(rows?.Content);
    }

    public async Task<JobSiteVisit?> ContractorPortalOpenVisitAsync(string companyCode, string contractorCode)
    {
        var rows = await _supabase.Rpc("contractor_portal_open_visit", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant()
        });
        return ParseJobSiteVisit(rows?.Content);
    }

    public async Task<JobSiteVisit> ContractorPortalSignInAsync(
        string companyCode, string contractorCode, Guid jobId,
        double? lat, double? lng, string? address, string? reportedByName = null, string? notes = null)
    {
        var args = new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant(),
            ["p_job_id"] = jobId.ToString()
        };
        if (lat.HasValue) args["p_latitude"] = lat.Value;
        if (lng.HasValue) args["p_longitude"] = lng.Value;
        if (address != null) args["p_address"] = address;
        if (reportedByName != null) args["p_reported_by_name"] = reportedByName;
        if (notes != null) args["p_notes"] = notes;
        var rows = await _supabase.Rpc("contractor_portal_site_sign_in", args);
        return ParseJobSiteVisit(rows?.Content) ?? throw new InvalidOperationException("Sign-in failed.");
    }

    public async Task<JobSiteVisit> ContractorPortalSignOutAsync(
        string companyCode, string contractorCode, Guid jobId,
        double? lat, double? lng, string? address, string? notes = null)
    {
        var args = new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant(),
            ["p_job_id"] = jobId.ToString()
        };
        if (lat.HasValue) args["p_latitude"] = lat.Value;
        if (lng.HasValue) args["p_longitude"] = lng.Value;
        if (address != null) args["p_address"] = address;
        if (notes != null) args["p_notes"] = notes;
        var rows = await _supabase.Rpc("contractor_portal_site_sign_out", args);
        return ParseJobSiteVisit(rows?.Content) ?? throw new InvalidOperationException("Sign-out failed.");
    }

    public async Task<List<JobSiteVisit>> ContractorPortalVisitHistoryAsync(
        string companyCode, string contractorCode, Guid? jobId = null)
    {
        var args = new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant()
        };
        if (jobId.HasValue) args["p_job_id"] = jobId.Value.ToString();
        var rows = await _supabase.Rpc("contractor_portal_visit_history", args);
        return ParseJobSiteVisits(rows?.Content);
    }

    public async Task<IncidentReport> ContractorPortalCreateIncidentAsync(
        string companyCode, string contractorCode, Guid jobId,
        string description, string severity = "low", string? reportedByName = null)
    {
        var rows = await _supabase.Rpc("contractor_portal_create_incident", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant(),
            ["p_job_id"] = jobId.ToString(),
            ["p_description"] = description.Trim(),
            ["p_severity"] = severity,
            ["p_reported_by_name"] = reportedByName ?? ""
        });
        var content = rows?.Content;
        if (string.IsNullOrWhiteSpace(content) || content == "null")
            throw new InvalidOperationException("Could not report incident.");
        return Newtonsoft.Json.JsonConvert.DeserializeObject<IncidentReport>(content)!;
    }

    public async Task ContractorPortalAppendJobPhotoAsync(
        string companyCode, string contractorCode, Guid jobId, string phase, string photoUrl)
    {
        await _supabase.Rpc("contractor_portal_append_job_photo", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant(),
            ["p_job_id"] = jobId.ToString(),
            ["p_phase"] = phase,
            ["p_photo_url"] = photoUrl
        });
    }

    public async Task<List<AppMessage>> ContractorPortalGetJobMessagesAsync(
        string companyCode, string contractorCode, Guid jobId)
    {
        var rows = await _supabase.Rpc("contractor_portal_get_job_messages", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant(),
            ["p_job_id"] = jobId.ToString()
        });
        var content = rows?.Content;
        if (string.IsNullOrWhiteSpace(content)) return [];
        return Newtonsoft.Json.JsonConvert.DeserializeObject<List<AppMessage>>(content) ?? [];
    }

    public async Task<AppMessage> ContractorPortalSendJobMessageAsync(
        string companyCode, string contractorCode, Guid jobId, string body, string? senderName = null)
    {
        var rows = await _supabase.Rpc("contractor_portal_send_job_message", new Dictionary<string, object>
        {
            ["p_company_code"] = companyCode.Trim().ToUpperInvariant(),
            ["p_contractor_code"] = contractorCode.Trim().ToUpperInvariant(),
            ["p_job_id"] = jobId.ToString(),
            ["p_body"] = body.Trim(),
            ["p_sender_name"] = senderName ?? ""
        });
        var content = rows?.Content;
        if (string.IsNullOrWhiteSpace(content) || content == "null")
            throw new InvalidOperationException("Could not send message.");
        return Newtonsoft.Json.JsonConvert.DeserializeObject<AppMessage>(content)!;
    }

    public async Task<string> UploadContractorPortalJobPhotoAsync(Guid companyId, Guid jobId, FileResult file, string phase)
        => await UploadJobPhotoAsync(companyId, jobId, file, phase);

    private static Dictionary<string, object> BuildSiteVisitArgs(
        Guid companyId, Guid employeeId, Guid jobId,
        double? lat, double? lng, string? address, string? reportedByName, string? notes)
    {
        var args = new Dictionary<string, object>
        {
            ["p_company_id"] = companyId.ToString(),
            ["p_employee_id"] = employeeId.ToString(),
            ["p_job_id"] = jobId.ToString()
        };
        if (lat.HasValue) args["p_latitude"] = lat.Value;
        if (lng.HasValue) args["p_longitude"] = lng.Value;
        if (address != null) args["p_address"] = address;
        if (reportedByName != null) args["p_reported_by_name"] = reportedByName;
        if (notes != null) args["p_notes"] = notes;
        return args;
    }

    private static JobSiteVisit? ParseJobSiteVisit(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content == "null") return null;
        try
        {
            return Newtonsoft.Json.JsonConvert.DeserializeObject<JobSiteVisit>(content);
        }
        catch { return null; }
    }

    private static List<JobSiteVisit> ParseJobSiteVisits(string? content)
    {
        if (string.IsNullOrWhiteSpace(content)) return [];
        try
        {
            return Newtonsoft.Json.JsonConvert.DeserializeObject<List<JobSiteVisit>>(content) ?? [];
        }
        catch { return []; }
    }

    private static List<Job> ParseEmployeeJobsFromRpc(string? content)
    {
        if (string.IsNullOrWhiteSpace(content)) return [];
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array) return [];
            var jobs = new List<Job>();
            foreach (var row in doc.RootElement.EnumerateArray())
            {
                jobs.Add(new Job
                {
                    Id = row.TryGetProperty("id", out var id) ? Guid.Parse(id.GetString()!) : Guid.Empty,
                    CompanyId = row.TryGetProperty("company_id", out var cid) ? Guid.Parse(cid.GetString()!) : Guid.Empty,
                    Title = row.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "",
                    Description = row.TryGetProperty("description", out var d) ? d.GetString() : null,
                    StatusRaw = row.TryGetProperty("status", out var st) ? st.GetString() ?? "scheduled" : "scheduled",
                    PriorityRaw = row.TryGetProperty("priority", out var pr) ? pr.GetString() ?? "none" : "none",
                    JobCode = row.TryGetProperty("job_code", out var jc) ? jc.GetString() : null,
                    ClientId = OptGuid(row, "client_id"),
                    SiteId = OptGuid(row, "site_id"),
                    DealId = OptGuid(row, "deal_id"),
                    AssigneeEmployeeId = OptGuid(row, "assignee_employee_id"),
                    AssignedEmployeeIds = ParseGuidArray(row, "assigned_employee_ids"),
                    ScheduledStart = OptDateTime(row, "scheduled_start"),
                    ScheduledEnd = OptDateTime(row, "scheduled_end"),
                    OpenedAt = OptDateTime(row, "opened_at"),
                    CreatedAt = OptDateTime(row, "created_at") ?? DateTime.UtcNow,
                    UpdatedAt = OptDateTime(row, "updated_at") ?? DateTime.UtcNow,
                    CreatedByEmployeeId = OptGuid(row, "created_by_employee_id"),
                    VisibilityRaw = row.TryGetProperty("visibility", out var vis) ? vis.GetString() ?? "inherit" : "inherit",
                    PhotoUrlsBefore = ParseStringArray(row, "photo_urls_before"),
                    PhotoUrlsAfter = ParseStringArray(row, "photo_urls_after")
                });
            }
            return jobs.OrderByDescending(j => j.CreatedAt).ToList();
        }
        catch { return []; }
    }

    private static Guid? OptGuid(System.Text.Json.JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var el) || el.ValueKind != System.Text.Json.JsonValueKind.String)
            return null;
        return Guid.TryParse(el.GetString(), out var g) ? g : null;
    }

    private static DateTime? OptDateTime(System.Text.Json.JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var el) || el.ValueKind != System.Text.Json.JsonValueKind.String)
            return null;
        return DateTime.TryParse(el.GetString(), null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt)
            ? dt : null;
    }

    private static List<Guid> ParseGuidArray(System.Text.Json.JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var arr) || arr.ValueKind != System.Text.Json.JsonValueKind.Array)
            return [];
        var ids = new List<Guid>();
        foreach (var e in arr.EnumerateArray())
        {
            Guid g = Guid.Empty;
            if (e.ValueKind == System.Text.Json.JsonValueKind.String)
                Guid.TryParse(e.GetString(), out g);
            else
                Guid.TryParse(e.GetRawText().Trim('"'), out g);
            if (g != Guid.Empty)
                ids.Add(g);
        }
        return ids;
    }

    private static List<Job> ParseContractorPortalJobs(string? content)
    {
        if (string.IsNullOrWhiteSpace(content)) return [];
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array) return [];
            var jobs = new List<Job>();
            foreach (var row in doc.RootElement.EnumerateArray())
            {
                jobs.Add(new Job
                {
                    Id = row.TryGetProperty("id", out var id) ? Guid.Parse(id.GetString()!) : Guid.Empty,
                    Title = row.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "",
                    StatusRaw = row.TryGetProperty("status", out var st) ? st.GetString() ?? "scheduled" : "scheduled",
                    JobCode = row.TryGetProperty("job_code", out var jc) ? jc.GetString() : null,
                    ContractorCost = row.TryGetProperty("contractor_cost", out var cc) && cc.TryGetDouble(out var cost) ? cost : 0,
                    DealId = row.TryGetProperty("deal_id", out var did) && did.ValueKind == System.Text.Json.JsonValueKind.String
                        && Guid.TryParse(did.GetString(), out var dg) ? dg : null,
                    ClientId = row.TryGetProperty("client_id", out var cid) && cid.ValueKind == System.Text.Json.JsonValueKind.String
                        && Guid.TryParse(cid.GetString(), out var cg) ? cg : null,
                    PhotoUrlsBefore = ParseStringArray(row, "photo_urls_before"),
                    PhotoUrlsAfter = ParseStringArray(row, "photo_urls_after")
                });
            }
            return jobs;
        }
        catch { return []; }
    }

    private static List<string> ParseStringArray(System.Text.Json.JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var arr) || arr.ValueKind != System.Text.Json.JsonValueKind.Array)
            return [];
        return arr.EnumerateArray()
            .Where(e => e.ValueKind == System.Text.Json.JsonValueKind.String)
            .Select(e => e.GetString() ?? "")
            .Where(s => !string.IsNullOrEmpty(s))
            .ToList();
    }

    // ─── Work Teams ───────────────────────────────────────────────────────────

    public async Task<List<WorkTeam>> GetWorkTeamsAsync(Guid companyId, Guid? forEmployeeId = null)
    {
        if (forEmployeeId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_work_teams", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = forEmployeeId.Value.ToString()
                });
                if (!string.IsNullOrWhiteSpace(rpc?.Content) && rpc.Content != "null")
                    return Newtonsoft.Json.JsonConvert.DeserializeObject<List<WorkTeam>>(rpc.Content) ?? [];
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"employee_get_work_teams: {ex.Message}");
            }
        }

        var result = await _supabase
            .From<WorkTeam>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Get();
        return result.Models;
    }

    public async Task<WorkTeam> CreateWorkTeamAsync(WorkTeam team)
    {
        var result = await _supabase.From<WorkTeam>().Insert(team);
        return result.Models.First();
    }

    public async Task<WorkTeam> UpdateWorkTeamAsync(WorkTeam team)
    {
        var result = await _supabase.From<WorkTeam>().Update(team);
        return result.Models.First();
    }

    // ─── Messages ─────────────────────────────────────────────────────────────

    public async Task<List<MessageThread>> GetMessageThreadsAsync(Guid companyId, Guid userId)
    {
        if (IsCodeLoginSession())
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_message_threads_for_worker", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = userId.ToString(),
                });
                var threads = DeserializeRpcList<MessageThread>(rpc?.Content);
                await EnrichMessageThreadDisplayAsync(companyId, threads);
                return threads;
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetMessageThreadsAsync), new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["employee_id"] = userId.ToString(),
                    ["path"] = "employee_get_message_threads_for_worker",
                });
            }
        }

        var result = await _supabase
            .From<MessageThread>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Order("last_message_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();

        var hrThreads = result.Models.Where(t => t.ParticipantIds.Contains(userId)).ToList();
        await EnrichMessageThreadDisplayAsync(companyId, hrThreads);
        return hrThreads;
    }

    private async Task EnrichMessageThreadDisplayAsync(Guid companyId, List<MessageThread> threads)
    {
        if (threads.Count == 0) return;

        var dealIds = threads
            .Select(t => MessageThreadDisplay.TryParseDealId(t.Subject, out var id) ? id : (Guid?)null)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        var jobIds = threads
            .Select(t => MessageThreadDisplay.TryParseJobId(t.Subject, out var id) ? id : (Guid?)null)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        Dictionary<Guid, ClientDeal> dealsById = [];
        Dictionary<Guid, string> clientNamesById = [];
        if (dealIds.Count > 0)
        {
            var allDeals = await GetClientDealsAsync(companyId);
            dealsById = allDeals.Where(d => dealIds.Contains(d.Id)).ToDictionary(d => d.Id);
            var clients = await GetClientsAsync(companyId);
            clientNamesById = clients.ToDictionary(c => c.Id, c => string.IsNullOrWhiteSpace(c.Name) ? "Client" : c.Name.Trim());
        }

        Dictionary<Guid, Job> jobsById = [];
        if (jobIds.Count > 0)
        {
            var jobs = await GetJobsAsync(companyId);
            jobsById = jobs.Where(j => jobIds.Contains(j.Id)).ToDictionary(j => j.Id);
        }

        foreach (var thread in threads)
        {
            if (MessageThreadDisplay.TryParseDealId(thread.Subject, out var dealId)
                && dealsById.TryGetValue(dealId, out var deal))
            {
                var clientName = deal.ClientId.HasValue && clientNamesById.TryGetValue(deal.ClientId.Value, out var cn)
                    ? cn
                    : "Client";
                thread.DisplaySubject = MessageThreadDisplay.DealThreadTitle(clientName, deal.Title);
            }
            else if (MessageThreadDisplay.TryParseJobId(thread.Subject, out var jobId)
                     && jobsById.TryGetValue(jobId, out var job))
            {
                thread.DisplaySubject = MessageThreadDisplay.JobThreadTitle(job.Title);
            }
            else if (thread.IsCompanyFeed)
            {
                thread.DisplaySubject = "Company feed";
            }
            else
            {
                thread.DisplaySubject = thread.Subject ?? "Conversation";
            }
        }
    }

    public async Task<List<AppMessage>> GetMessagesAsync(
        Guid threadId,
        Guid? companyId = null,
        Guid? employeeId = null,
        bool isCompanyFeed = false)
    {
        if (IsCodeLoginSession() && companyId.HasValue && employeeId.HasValue)
        {
            try
            {
                var rpcName = isCompanyFeed
                    ? "employee_get_company_messages_for_worker"
                    : "employee_get_thread_messages_for_worker";

                var args = new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.Value.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                };
                if (!isCompanyFeed)
                    args["p_thread_id"] = threadId.ToString();

                var rpc = await _supabase.Rpc(rpcName, args);
                var messages = DeserializeRpcList<AppMessage>(rpc?.Content);
                messages.Reverse();
                return messages;
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetMessagesAsync), new Dictionary<string, string>
                {
                    ["thread_id"] = threadId.ToString(),
                    ["company_id"] = companyId.Value.ToString(),
                    ["is_company_feed"] = isCompanyFeed.ToString(),
                });
            }
        }

        var result = await _supabase
            .From<AppMessage>()
            .Filter("thread_id", Supabase.Postgrest.Constants.Operator.Equals, threadId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<AppMessage> SendMessageAsync(AppMessage message, bool isCompanyFeed = false)
    {
        if (!PortalDateHelper.IsSet(message.CreatedAt))
            message.CreatedAt = DateTime.UtcNow;

        if (IsCodeLoginSession())
        {
            try
            {
                if (isCompanyFeed)
                {
                    await _supabase.Rpc("employee_send_company_feed_message", new Dictionary<string, object>
                    {
                        ["p_company_id"] = message.CompanyId.ToString(),
                        ["p_sender_employee_id"] = message.SenderId.ToString(),
                        ["p_body"] = message.Body ?? "",
                    });
                }
                else
                {
                    await _supabase.Rpc("employee_send_thread_message", new Dictionary<string, object>
                    {
                        ["p_company_id"] = message.CompanyId.ToString(),
                        ["p_thread_id"] = message.ThreadId.ToString(),
                        ["p_sender_employee_id"] = message.SenderId.ToString(),
                        ["p_body"] = message.Body ?? "",
                    });
                }

                message.Id = Guid.NewGuid();
                _telemetry.LogSuccess(isCompanyFeed ? "company_feed_sent" : "thread_message_sent", nameof(SendMessageAsync));
                return message;
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(SendMessageAsync), new Dictionary<string, string>
                {
                    ["thread_id"] = message.ThreadId.ToString(),
                    ["company_id"] = message.CompanyId.ToString(),
                    ["is_company_feed"] = isCompanyFeed.ToString(),
                });
                throw;
            }
        }

        var result = await _supabase.From<AppMessage>().Insert(message);
        var sent = result.Models.First();
        if (!PortalDateHelper.IsSet(sent.CreatedAt))
            sent.CreatedAt = message.CreatedAt;
        return sent;
    }

    public async Task<MessageThread> CreateThreadAsync(MessageThread thread)
    {
        if (IsCodeLoginSession() && thread.ParticipantIds.Count == 2)
        {
            try
            {
                var creatorId = thread.ParticipantIds[0];
                var peerId = thread.ParticipantIds[1];
                var rpc = await _supabase.Rpc("employee_get_or_create_direct_thread_peer", new Dictionary<string, object>
                {
                    ["p_company_id"] = thread.CompanyId.ToString(),
                    ["p_creator_id"] = creatorId.ToString(),
                    ["p_peer_id"] = peerId.ToString(),
                    ["p_title"] = thread.Subject ?? "Direct chat",
                });

                var threadIdText = rpc?.Content?.Trim().Trim('"');
                if (Guid.TryParse(threadIdText, out var threadId))
                {
                    var threads = await GetMessageThreadsAsync(thread.CompanyId, creatorId);
                    if (threads.FirstOrDefault(t => t.Id == threadId) is { } found)
                        return found;

                    return new MessageThread
                    {
                        Id = threadId,
                        CompanyId = thread.CompanyId,
                        Subject = thread.Subject,
                        TypeRaw = "direct",
                        ParticipantIds = thread.ParticipantIds,
                        CreatedAt = DateTime.UtcNow,
                    };
                }
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(CreateThreadAsync), new Dictionary<string, string>
                {
                    ["company_id"] = thread.CompanyId.ToString(),
                    ["path"] = "employee_get_or_create_direct_thread_peer",
                });
            }
        }

        var result = await _supabase.From<MessageThread>().Insert(thread);
        return result.Models.First();
    }

    public async Task<MessageThread> GetOrCreateJobThreadAsync(Guid companyId, Guid jobId, Guid employeeId)
    {
        if (IsCodeLoginSession())
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_job_thread", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.ToString(),
                    ["p_job_id"] = jobId.ToString(),
                });
                var workerThread = Newtonsoft.Json.JsonConvert.DeserializeObject<MessageThread>(rpc?.Content ?? "");
                if (workerThread != null) return workerThread;
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetOrCreateJobThreadAsync));
                throw new InvalidOperationException($"Could not open job chat: {ex.Message}", ex);
            }
        }

        var subject = $"Job:{jobId}";
        var existing = await _supabase
            .From<MessageThread>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("subject", Supabase.Postgrest.Constants.Operator.Equals, subject)
            .Get();
        if (existing.Models.FirstOrDefault() is { } found)
            return found;

        var thread = new MessageThread
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Subject = subject,
            TypeRaw = "job",
            ParticipantIds = [employeeId],
            CreatedAt = DateTime.UtcNow
        };
        var created = await _supabase.From<MessageThread>().Insert(thread);
        return created.Models.First();
    }

    // ─── Payments ─────────────────────────────────────────────────────────────

    public async Task<List<PaymentApproval>> GetPaymentsAsync(Guid companyId)
    {
        var result = await _supabase
            .From<PaymentApproval>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<PaymentApproval> CreatePaymentApprovalAsync(PaymentApproval payment)
    {
        if (payment.CreatedAt.Year < 2000)
            payment.CreatedAt = DateTime.UtcNow;
        var result = await _supabase.From<PaymentApproval>().Insert(payment);
        var created = result.Models.First();
        if (created.CreatedAt.Year < 2000)
            created.CreatedAt = payment.CreatedAt;
        return created;
    }

    public async Task<PaymentApproval> UpdatePaymentStatusAsync(Guid paymentId, string status)
    {
        var fetched = await _supabase
            .From<PaymentApproval>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, paymentId.ToString())
            .Get();

        var payment = fetched.Models.First();
        payment.StatusRaw = status;

        var result = await _supabase.From<PaymentApproval>().Update(payment);
        return result.Models.First();
    }

    public async Task<PaymentApproval> UpdatePaymentAsync(PaymentApproval payment)
    {
        var result = await _supabase.From<PaymentApproval>().Update(payment);
        return result.Models.First();
    }

    public async Task SharePayslipWithEmployeeAsync(Guid paymentId)
    {
        var fetched = await _supabase
            .From<PaymentApproval>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, paymentId.ToString())
            .Get();

        var payment = fetched.Models.First();
        payment.SharedWithEmployee = true;
        await _supabase.From<PaymentApproval>().Update(payment);
    }

    public async Task<List<PaymentApproval>> GetMyPayslipsAsync(Guid companyId, Guid employeeId)
    {
        var result = await _supabase.Rpc("employee_get_payslips", new Dictionary<string, object>
        {
            ["p_company_id"]  = companyId.ToString(),
            ["p_employee_id"] = employeeId.ToString()
        });

        if (string.IsNullOrWhiteSpace(result.Content) || result.Content == "null")
            return [];

        var raw = result.Content.Trim('"').Replace("\\\"", "\"").Replace("\\n", "");
        if (raw.StartsWith('"')) raw = System.Text.Json.JsonSerializer.Deserialize<string>(result.Content) ?? "[]";

        return Newtonsoft.Json.JsonConvert.DeserializeObject<List<PaymentApproval>>(raw) ?? [];
    }

    public async Task<List<PayrollPeriodLock>> GetPayrollPeriodLocksAsync(Guid companyId)
    {
        var result = await _supabase
            .From<PayrollPeriodLock>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Get();
        return result.Models;
    }

    public async Task LockPayrollPeriodAsync(PayrollPeriodLock periodLock)
    {
        periodLock.LockedAt = DateTime.UtcNow;
        await _supabase.From<PayrollPeriodLock>().Insert(periodLock);
    }

    public async Task<List<EmployeeSalaryHistory>> GetEmployeeSalaryHistoryAsync(Guid companyId, Guid? employeeId = null)
    {
        var query = _supabase
            .From<EmployeeSalaryHistory>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString());
        if (employeeId.HasValue)
            query = query.Filter("employee_id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.Value.ToString());
        var result = await query.Order("effective_date", Supabase.Postgrest.Constants.Ordering.Ascending).Get();
        return result.Models;
    }

    public async Task<EmployeeSalaryHistory> AddEmployeeSalaryHistoryAsync(EmployeeSalaryHistory entry)
    {
        entry.CreatedAt = DateTime.UtcNow;
        var result = await _supabase.From<EmployeeSalaryHistory>().Insert(entry);
        return result.Models.First();
    }

    // ─── PA Tasks ─────────────────────────────────────────────────────────────

    public async Task<int> SyncOperationalPaTasksAsync(Guid companyId, Guid? scopeEmployeeId = null)
    {
        try
        {
            var args = new Dictionary<string, object> { ["p_company_id"] = companyId.ToString() };
            if (scopeEmployeeId.HasValue)
                args["p_scope_employee_id"] = scopeEmployeeId.Value.ToString();
            var rpc = await _supabase.Rpc("sync_operational_pa_tasks", args);
            return int.TryParse(rpc?.Content?.Trim(), out var n) ? n : 0;
        }
        catch
        {
            return 0;
        }
    }

    public async Task<List<PaTask>> GetPaTasksAsync(Guid companyId, Guid? employeeId = null)
    {
        if (employeeId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_pa_tasks", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString()
                });
                return ParsePaTasksFromRpc(rpc?.Content);
            }
            catch
            {
                /* table fallback */
            }
        }

        var query = _supabase
            .From<PaTask>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString());

        var result = await query.Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending).Get();
        var tasks = result.Models;

        if (employeeId.HasValue)
        {
            tasks = tasks.Where(t =>
                t.OwnerEmployeeId == employeeId.Value
                || t.AssignedEmployeeId == employeeId.Value).ToList();
        }

        return tasks;
    }

    public async Task<List<MyPaLinkOption>> GetPaLinkOptionsAsync(Guid companyId, string linkedType)
    {
        return linkedType switch
        {
            "client" => (await GetClientsAsync(companyId))
                .Select(c => new MyPaLinkOption { Id = c.Id.ToString(), Label = string.IsNullOrWhiteSpace(c.Name) ? $"Client" : c.Name })
                .ToList(),
            "job" => (await GetJobsAsync(companyId))
                .Select(j => new MyPaLinkOption { Id = j.Id.ToString(), Label = string.IsNullOrWhiteSpace(j.Title) ? "Job" : j.Title })
                .ToList(),
            "deal" => (await GetClientDealsAsync(companyId))
                .Select(d => new MyPaLinkOption
                {
                    Id = d.Id.ToString(),
                    Label = string.IsNullOrWhiteSpace(d.Title) ? d.ProjectCodeDisplay : d.Title
                })
                .ToList(),
            _ => []
        };
    }

    public async Task<List<MyPaCalendarEntry>> GetMyPaCalendarEntriesAsync(Guid companyId, Guid? employeeId = null)
    {
        var tasks = await GetPaTasksAsync(companyId, employeeId);
        var jobs = employeeId.HasValue
            ? await GetJobsAsync(companyId, employeeId)
            : await GetJobsAsync(companyId);
        var deals = await GetClientDealsAsync(companyId);
        return MyPaHelper.BuildCalendarEntries(tasks, jobs, deals, employeeId);
    }

    public async Task<List<MyPaCalendarEntry>> GetMyPaCalendarEntriesMergedAsync(Guid companyId, Guid? employeeId = null)
    {
        var entries = await GetMyPaCalendarEntriesAsync(companyId, employeeId);
        if (!employeeId.HasValue) return entries;
        try
        {
            var from = DateTime.Today.AddMonths(-1);
            var to = DateTime.Today.AddMonths(2);
            var external = await GetExternalCalendarEventsAsync(employeeId.Value, from, to);
            return MyPaHelper.MergeWithExternal(entries, external);
        }
        catch
        {
            return entries;
        }
    }

    public async Task<List<PaTaskTemplate>> GetPaTaskTemplatesAsync(Guid companyId)
    {
        try
        {
            var result = await _supabase
                .From<PaTaskTemplate>()
                .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
                .Filter("is_active", Supabase.Postgrest.Constants.Operator.Equals, "true")
                .Get();
            return result.Models.OrderBy(t => t.Title).ToList();
        }
        catch
        {
            return [];
        }
    }

    public async Task<EmployeePaSettings> GetEmployeePaSettingsAsync(Guid employeeId, Guid companyId)
    {
        try
        {
            var rpc = await _supabase.Rpc("employee_get_pa_settings", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_employee_id"] = employeeId.ToString()
            });
            if (!string.IsNullOrWhiteSpace(rpc?.Content) && rpc.Content != "null")
            {
                var list = Newtonsoft.Json.JsonConvert.DeserializeObject<List<EmployeePaSettings>>(rpc.Content);
                if (list is { Count: > 0 })
                    return list[0];
            }
        }
        catch
        {
            /* table fallback */
        }

        try
        {
            var result = await _supabase
                .From<EmployeePaSettings>()
                .Filter("employee_id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.ToString())
                .Get();
            return result.Models.FirstOrDefault() ?? new EmployeePaSettings
            {
                EmployeeId = employeeId,
                CompanyId = companyId
            };
        }
        catch
        {
            return new EmployeePaSettings { EmployeeId = employeeId, CompanyId = companyId };
        }
    }

    public async Task SaveEmployeePaSettingsAsync(EmployeePaSettings settings)
    {
        try
        {
            await _supabase.Rpc("upsert_employee_pa_settings", new Dictionary<string, object>
            {
                ["p_employee_id"] = settings.EmployeeId.ToString(),
                ["p_company_id"] = settings.CompanyId.ToString(),
                ["p_briefing_enabled"] = settings.BriefingEnabled,
                ["p_focus_mode_enabled"] = settings.FocusModeEnabled,
                ["p_manager_digest_enabled"] = settings.ManagerDigestEnabled
            });
        }
        catch
        {
            settings.UpdatedAt = DateTime.UtcNow;
            var existing = await _supabase
                .From<EmployeePaSettings>()
                .Filter("employee_id", Supabase.Postgrest.Constants.Operator.Equals, settings.EmployeeId.ToString())
                .Get();
            if (existing.Models.Count > 0)
                await _supabase.From<EmployeePaSettings>().Update(settings);
            else
                await _supabase.From<EmployeePaSettings>().Insert(settings);
        }
    }

    public async Task<List<EmployeeCalendarConnection>> GetCalendarConnectionsAsync(Guid employeeId)
    {
        try
        {
            var result = await _supabase
                .From<EmployeeCalendarConnection>()
                .Filter("employee_id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.ToString())
                .Get();
            return result.Models;
        }
        catch
        {
            return [];
        }
    }

    public async Task<List<ExternalCalendarEvent>> GetExternalCalendarEventsAsync(Guid employeeId, DateTime from, DateTime to)
    {
        try
        {
            var result = await _supabase
                .From<ExternalCalendarEvent>()
                .Filter("employee_id", Supabase.Postgrest.Constants.Operator.Equals, employeeId.ToString())
                .Filter("start_time", Supabase.Postgrest.Constants.Operator.GreaterThanOrEqual, from.ToString("o"))
                .Filter("start_time", Supabase.Postgrest.Constants.Operator.LessThanOrEqual, to.ToString("o"))
                .Get();
            return result.Models;
        }
        catch
        {
            return [];
        }
    }

    public Task NotifyPaTaskDelegatedAsync(Guid companyId, Guid assigneeEmployeeId, string taskTitle, Guid delegatedByEmployeeId)
    {
        try
        {
            return _supabase.Rpc("enqueue_pa_task_notifications", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString()
            });
        }
        catch
        {
            return Task.CompletedTask;
        }
    }

    public async Task<PaTask> EmployeeCreatePaTaskAsync(PaTask draft, Guid employeeId)
    {
        try
        {
            var args = new Dictionary<string, object>
            {
                ["p_company_id"] = draft.CompanyId.ToString(),
                ["p_employee_id"] = employeeId.ToString(),
                ["p_title"] = draft.Title.Trim(),
                ["p_notes"] = draft.Notes ?? draft.Description ?? "",
                ["p_priority"] = draft.PriorityRaw,
                ["p_linked_type"] = draft.LinkedTypeRaw,
                ["p_linked_id"] = draft.LinkedId ?? "",
                ["p_linked_label"] = draft.LinkedLabel ?? "",
                ["p_recurrence_pattern"] = draft.RecurrencePattern,
                ["p_meeting_with"] = draft.MeetingWith ?? "",
                ["p_meeting_minutes"] = draft.MeetingMinutes ?? "",
                ["p_meeting_follow_up"] = draft.MeetingFollowUp ?? ""
            };
            if (draft.DueDate.HasValue)
                args["p_due_date"] = draft.DueDate.Value.ToString("yyyy-MM-dd");
            if (draft.DueAt.HasValue)
                args["p_due_at"] = draft.DueAt.Value.ToString("o");
            if (draft.RemindAt.HasValue)
                args["p_remind_at"] = draft.RemindAt.Value.ToString("o");
            if (draft.MeetingAt.HasValue)
                args["p_meeting_at"] = draft.MeetingAt.Value.ToString("o");

            var rpc = await _supabase.Rpc("employee_insert_pa_task", args);
            if (Guid.TryParse(rpc?.Content?.Trim('"'), out var id))
            {
                var created = (await GetPaTasksAsync(draft.CompanyId, employeeId)).FirstOrDefault(t => t.Id == id);
                if (created != null) return created;
            }
        }
        catch { /* fallback */ }

        draft.Id = Guid.NewGuid();
        draft.AssignedEmployeeId = employeeId;
        draft.OwnerEmployeeId = employeeId;
        draft.StatusRaw = "todo";
        return await CreatePaTaskAsync(draft);
    }

    public async Task UpdatePaTaskStatusAsync(PaTask task, string status, Guid? actingEmployeeId = null)
    {
        var employeeId = actingEmployeeId ?? task.OwnerEmployeeId ?? task.AssignedEmployeeId;
        if (employeeId.HasValue)
        {
            try
            {
                await _supabase.Rpc("employee_update_pa_task_status", new Dictionary<string, object>
                {
                    ["p_company_id"] = task.CompanyId.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_task_id"] = task.Id.ToString(),
                    ["p_status"] = status,
                    ["p_snoozed_until"] = task.SnoozedUntil.HasValue
                        ? task.SnoozedUntil.Value.ToString("o")
                        : (object)DBNull.Value
                });
                task.StatusRaw = status;
                if (status is "done" or "completed")
                    task.CompletedAt = DateTime.UtcNow;
                task.UpdatedAt = DateTime.UtcNow;
                return;
            }
            catch
            {
                /* Postgrest fallback */
            }
        }

        task.StatusRaw = status;
        if (status is "done" or "completed")
            task.CompletedAt = DateTime.UtcNow;
        task.UpdatedAt = DateTime.UtcNow;
        await UpdatePaTaskAsync(task, actingEmployeeId);
    }

    public async Task DeletePaTaskAsync(Guid companyId, Guid taskId, Guid? actingEmployeeId = null)
    {
        if (actingEmployeeId.HasValue)
        {
            try
            {
                await _supabase.Rpc("employee_delete_pa_task", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = actingEmployeeId.Value.ToString(),
                    ["p_task_id"] = taskId.ToString()
                });
                return;
            }
            catch
            {
                /* Postgrest fallback */
            }
        }

        await _supabase
            .From<PaTask>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, taskId.ToString())
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Delete();
    }

    public async Task<PaTask> CreatePaTaskAsync(PaTask task)
    {
        if (task.Id == Guid.Empty)
            task.Id = Guid.NewGuid();
        if (task.OwnerEmployeeId == null && task.AssignedEmployeeId.HasValue)
            task.OwnerEmployeeId = task.AssignedEmployeeId;
        if (task.AssignedEmployeeId == null && task.OwnerEmployeeId.HasValue)
            task.AssignedEmployeeId = task.OwnerEmployeeId;
        var result = await _supabase.From<PaTask>().Insert(task);
        return result.Models.First();
    }

    public async Task<PaTask> UpdatePaTaskAsync(PaTask task, Guid? actingEmployeeId = null)
    {
        var employeeId = actingEmployeeId ?? task.OwnerEmployeeId ?? task.AssignedEmployeeId;
        if (employeeId.HasValue)
        {
            try
            {
                var patch = System.Text.Json.JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["title"] = task.Title,
                    ["notes"] = task.Notes,
                    ["description"] = task.Description,
                    ["priority"] = task.PriorityRaw,
                    ["status"] = task.StatusRaw,
                    ["due_date"] = task.DueDate?.ToString("yyyy-MM-dd"),
                    ["due_at"] = task.DueAt?.ToString("o"),
                    ["remind_at"] = task.RemindAt?.ToString("o"),
                    ["snoozed_until"] = task.SnoozedUntil?.ToString("o"),
                    ["linked_type"] = task.LinkedTypeRaw,
                    ["linked_id"] = task.LinkedId,
                    ["linked_label"] = task.LinkedLabel,
                    ["recurrence_pattern"] = task.RecurrencePattern,
                    ["meeting_with"] = task.MeetingWith,
                    ["meeting_at"] = task.MeetingAt?.ToString("o"),
                    ["meeting_minutes"] = task.MeetingMinutes,
                    ["meeting_follow_up"] = task.MeetingFollowUp,
                    ["completed_at"] = task.CompletedAt?.ToString("o")
                });

                await _supabase.Rpc("employee_update_pa_task", new Dictionary<string, object>
                {
                    ["p_company_id"] = task.CompanyId.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_task_id"] = task.Id.ToString(),
                    ["p_patch"] = patch
                });
                task.UpdatedAt = DateTime.UtcNow;
                return task;
            }
            catch
            {
                /* Postgrest fallback */
            }
        }

        var result = await _supabase.From<PaTask>().Update(task);
        return result.Models.First();
    }

    public async Task EnqueuePaTaskNotificationsAsync(Guid companyId)
    {
        try
        {
            await _supabase.Rpc("enqueue_pa_task_notifications", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString()
            });
        }
        catch
        {
            /* optional */
        }
    }

    public async Task NotifyManagerJobCreatedAsync(
        Guid companyId, Guid managerUserId, Guid jobId, Guid employeeId, string jobTitle)
    {
        try
        {
            await _supabase.Rpc("employee_notify_manager_job_created", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_manager_user_id"] = managerUserId.ToString(),
                ["p_job_id"] = jobId.ToString(),
                ["p_employee_id"] = employeeId.ToString(),
                ["p_job_title"] = jobTitle
            });
        }
        catch
        {
            /* non-blocking */
        }
    }

    private static List<PaTask> ParsePaTasksFromRpc(string? content)
    {
        if (string.IsNullOrWhiteSpace(content)) return [];
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array) return [];
            var tasks = new List<PaTask>();
            foreach (var row in doc.RootElement.EnumerateArray())
            {
                tasks.Add(new PaTask
                {
                    Id = row.TryGetProperty("id", out var id) ? Guid.Parse(id.GetString()!) : Guid.Empty,
                    CompanyId = row.TryGetProperty("company_id", out var cid) ? Guid.Parse(cid.GetString()!) : Guid.Empty,
                    Title = row.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "",
                    Description = row.TryGetProperty("description", out var d) ? d.GetString() : null,
                    Notes = row.TryGetProperty("notes", out var n) ? n.GetString() : null,
                    StatusRaw = row.TryGetProperty("status", out var st) ? st.GetString() ?? "todo" : "todo",
                    PriorityRaw = row.TryGetProperty("priority", out var pr) ? pr.GetString() ?? "medium" : "medium",
                    AssignedEmployeeId = OptGuid(row, "assigned_employee_id"),
                    OwnerEmployeeId = OptGuid(row, "owner_employee_id"),
                    DueDate = row.TryGetProperty("due_date", out var dd) && dd.ValueKind == System.Text.Json.JsonValueKind.String
                        && DateOnly.TryParse(dd.GetString(), out var due) ? due : null,
                    DueAt = OptDateTime(row, "due_at"),
                    RemindAt = OptDateTime(row, "remind_at"),
                    SnoozedUntil = OptDateTime(row, "snoozed_until"),
                    LinkedTypeRaw = row.TryGetProperty("linked_type", out var lt) ? lt.GetString() ?? "none" : "none",
                    LinkedId = row.TryGetProperty("linked_id", out var lid) ? lid.GetString() : null,
                    LinkedLabel = row.TryGetProperty("linked_label", out var ll) ? ll.GetString() : null,
                    RecurrencePattern = row.TryGetProperty("recurrence_pattern", out var rp) ? rp.GetString() ?? "none" : "none",
                    SourceType = row.TryGetProperty("source_type", out var stp) ? stp.GetString() : null,
                    SourceId = row.TryGetProperty("source_id", out var sid) ? sid.GetString() : null,
                    MeetingWith = row.TryGetProperty("meeting_with", out var mw) ? mw.GetString() : null,
                    MeetingAt = OptDateTime(row, "meeting_at"),
                    MeetingMinutes = row.TryGetProperty("meeting_minutes", out var mm) ? mm.GetString() : null,
                    MeetingFollowUp = row.TryGetProperty("meeting_follow_up", out var mf) ? mf.GetString() : null,
                    CreatedAt = OptDateTime(row, "created_at") ?? DateTime.UtcNow,
                    UpdatedAt = OptDateTime(row, "updated_at") ?? DateTime.UtcNow,
                    CompletedAt = OptDateTime(row, "completed_at")
                });
            }
            return tasks.OrderBy(t => t.EffectiveDue ?? DateTime.MaxValue).ThenByDescending(t => t.CreatedAt).ToList();
        }
        catch { return []; }
    }

    // ─── Compliance ───────────────────────────────────────────────────────────

    public async Task<List<ComplianceEntry>> GetComplianceEntriesAsync(Guid companyId, Guid? siteId = null)
    {
        var query = _supabase
            .From<ComplianceEntry>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString());

        if (siteId.HasValue)
            query = query.Filter("site_id", Supabase.Postgrest.Constants.Operator.Equals, siteId.Value.ToString());

        var result = await query.Order("expiry_date", Supabase.Postgrest.Constants.Ordering.Ascending).Get();
        return result.Models;
    }

    public async Task<ComplianceEntry> CreateComplianceEntryAsync(ComplianceEntry entry)
    {
        var result = await _supabase.From<ComplianceEntry>().Insert(entry);
        return result.Models.First();
    }

    public async Task<ComplianceEntry> UpdateComplianceEntryAsync(ComplianceEntry entry)
    {
        var result = await _supabase.From<ComplianceEntry>().Update(entry);
        return result.Models.First();
    }

    // ─── Workflow Forms ───────────────────────────────────────────────────────

    public async Task<List<WorkflowFormTemplate>> GetFormTemplatesAsync(Guid companyId)
    {
        if (IsCodeLoginSession())
        {
            var employeeId = _state.CurrentEmployee?.Id;
            if (employeeId.HasValue)
            {
                try
                {
                    var rpc = await _supabase.Rpc("employee_get_workflow_form_templates", new Dictionary<string, object>
                    {
                        ["p_company_id"] = companyId.ToString(),
                        ["p_employee_id"] = employeeId.Value.ToString(),
                    });
                    var templates = DeserializeRpcList<WorkflowFormTemplate>(rpc?.Content);
                    if (templates.Count > 0 || !string.IsNullOrWhiteSpace(rpc?.Content))
                        return templates;
                }
                catch (Exception ex)
                {
                    _telemetry.LogError(ex, nameof(GetFormTemplatesAsync), new Dictionary<string, string>
                    {
                        ["company_id"] = companyId.ToString(),
                        ["path"] = "employee_get_workflow_form_templates",
                    });
                }
            }
        }

        var result = await _supabase
            .From<WorkflowFormTemplate>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Get();
        return result.Models;
    }

    public async Task<List<WorkflowFormSubmission>> GetFormSubmissionsAsync(Guid companyId, Guid? templateId = null)
    {
        if (IsCodeLoginSession())
        {
            var employeeId = _state.CurrentEmployee?.Id;
            if (employeeId.HasValue)
            {
                try
                {
                    var args = new Dictionary<string, object>
                    {
                        ["p_company_id"] = companyId.ToString(),
                        ["p_employee_id"] = employeeId.Value.ToString(),
                    };
                    if (templateId.HasValue)
                        args["p_template_id"] = templateId.Value.ToString();

                    var rpc = await _supabase.Rpc("employee_get_workflow_form_submissions", args);
                    var submissions = DeserializeRpcList<WorkflowFormSubmission>(rpc?.Content);
                    if (submissions.Count > 0 || !string.IsNullOrWhiteSpace(rpc?.Content))
                        return submissions;
                }
                catch (Exception ex)
                {
                    _telemetry.LogError(ex, nameof(GetFormSubmissionsAsync), new Dictionary<string, string>
                    {
                        ["company_id"] = companyId.ToString(),
                        ["path"] = "employee_get_workflow_form_submissions",
                    });
                }
            }
        }

        var query = _supabase
            .From<WorkflowFormSubmission>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString());

        if (templateId.HasValue)
            query = query.Filter("template_id", Supabase.Postgrest.Constants.Operator.Equals, templateId.Value.ToString());

        var result = await query.Order("submitted_at", Supabase.Postgrest.Constants.Ordering.Descending).Get();
        return result.Models;
    }

    public async Task<WorkflowFormSubmission> SubmitFormAsync(WorkflowFormSubmission submission)
    {
        if (IsCodeLoginSession())
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_submit_workflow_form", new Dictionary<string, object>
                {
                    ["p_company_id"] = submission.CompanyId.ToString(),
                    ["p_employee_id"] = submission.SubmittedBy.ToString(),
                    ["p_template_id"] = submission.TemplateId.ToString(),
                    ["p_data"] = Newtonsoft.Json.JsonConvert.SerializeObject(submission.Data),
                    ["p_job_id"] = submission.JobId?.ToString() ?? null!,
                    ["p_site_id"] = submission.SiteId?.ToString() ?? null!,
                });
                var content = rpc?.Content;
                if (!string.IsNullOrWhiteSpace(content) && content != "null")
                {
                    var saved = Newtonsoft.Json.JsonConvert.DeserializeObject<WorkflowFormSubmission>(content);
                    if (saved != null)
                    {
                        _telemetry.LogSuccess("form_submitted", nameof(SubmitFormAsync), new Dictionary<string, string>
                        {
                            ["template_id"] = submission.TemplateId.ToString(),
                        });
                        return saved;
                    }
                }
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(SubmitFormAsync), new Dictionary<string, string>
                {
                    ["template_id"] = submission.TemplateId.ToString(),
                    ["path"] = "employee_submit_workflow_form",
                });
                throw;
            }
        }

        var result = await _supabase.From<WorkflowFormSubmission>().Insert(submission);
        return result.Models.First();
    }

    // ─── Job Codes ────────────────────────────────────────────────────────────

    public async Task<List<JobCode>> GetJobCodesAsync(Guid companyId)
    {
        var result = await _supabase
            .From<JobCode>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("is_active", Supabase.Postgrest.Constants.Operator.Equals, "true")
            .Order("code", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    // ─── Calendar Events ──────────────────────────────────────────────────────

    public async Task<List<CalendarEvent>> GetCalendarEventsAsync(Guid companyId, DateOnly from, DateOnly to, Guid? employeeId = null)
    {
        if (IsCodeLoginSession() && employeeId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_calendar_events_for_worker", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                    ["p_from"] = from.ToString("yyyy-MM-dd"),
                    ["p_to"] = to.ToString("yyyy-MM-dd"),
                });
                var events = DeserializeRpcList<CalendarEvent>(rpc?.Content);
                if (events.Count > 0 || !string.IsNullOrWhiteSpace(rpc?.Content))
                    return events;
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetCalendarEventsAsync), new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["employee_id"] = employeeId.Value.ToString(),
                    ["path"] = "employee_get_calendar_events_for_worker",
                });
            }
        }

        var query = _supabase
            .From<CalendarEvent>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("start_time", Supabase.Postgrest.Constants.Operator.GreaterThanOrEqual, from.ToDateTime(TimeOnly.MinValue).ToString("o"))
            .Filter("start_time", Supabase.Postgrest.Constants.Operator.LessThanOrEqual, to.ToDateTime(TimeOnly.MaxValue).ToString("o"))
            .Order("start_time", Supabase.Postgrest.Constants.Ordering.Ascending);

        var result = await query.Get();

        if (employeeId.HasValue)
            return result.Models.Where(e => e.AttendeeIds.Contains(employeeId.Value)).ToList();

        return result.Models;
    }

    public async Task<CalendarEvent> CreateCalendarEventAsync(CalendarEvent calendarEvent)
    {
        var result = await _supabase.From<CalendarEvent>().Insert(calendarEvent);
        return result.Models.First();
    }

    public async Task<CalendarEvent> UpdateCalendarEventAsync(CalendarEvent calendarEvent)
    {
        var result = await _supabase.From<CalendarEvent>().Update(calendarEvent);
        return result.Models.First();
    }

    public async Task UpdateCalendarEventAttendanceAsync(Guid companyId, Guid employeeId, Guid eventId, string response)
    {
        if (IsCodeLoginSession())
        {
            await _supabase.Rpc("employee_update_calendar_event_attendance", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_employee_id"] = employeeId.ToString(),
                ["p_event_id"] = eventId.ToString(),
                ["p_response"] = response,
            });
            _telemetry.LogSuccess("shift_attendance_updated", nameof(UpdateCalendarEventAttendanceAsync), new Dictionary<string, string>
            {
                ["event_id"] = eventId.ToString(),
                ["response"] = response,
            });
            return;
        }

        var fetched = await _supabase
            .From<CalendarEvent>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, eventId.ToString())
            .Get();
        var ev = fetched.Models.First();
        ev.AttendanceResponses[employeeId.ToString()] = response;
        await UpdateCalendarEventAsync(ev);
    }

    // ─── Branches ────────────────────────────────────────────────────────────

    public async Task<List<Branch>> GetBranchesAsync(Guid companyId)
    {
        var result = await _supabase
            .From<Branch>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Order("name", Supabase.Postgrest.Constants.Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<Branch> CreateBranchAsync(Branch branch)
    {
        var result = await _supabase.From<Branch>().Insert(branch);
        return result.Models.First();
    }

    public async Task<Branch> UpdateBranchAsync(Branch branch)
    {
        var result = await _supabase.From<Branch>().Update(branch);
        return result.Models.First();
    }

    public async Task DeleteBranchAsync(Guid branchId)
    {
        await _supabase.From<Branch>()
            .Filter("id", Supabase.Postgrest.Constants.Operator.Equals, branchId.ToString())
            .Delete();
    }

    // ─── Company Feed ─────────────────────────────────────────────────────────

    public async Task<MessageThread> GetOrCreateCompanyFeedAsync(Guid companyId, Guid? employeeId = null)
    {
        if (IsCodeLoginSession() && employeeId.HasValue)
        {
            try
            {
                var rpc = await _supabase.Rpc("employee_get_company_feed_thread", new Dictionary<string, object>
                {
                    ["p_company_id"] = companyId.ToString(),
                    ["p_employee_id"] = employeeId.Value.ToString(),
                });
                var feed = DeserializeRpcList<MessageThread>(rpc?.Content).FirstOrDefault();
                if (feed != null)
                    return feed;
            }
            catch (Exception ex)
            {
                _telemetry.LogError(ex, nameof(GetOrCreateCompanyFeedAsync), new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["path"] = "employee_get_company_feed_thread",
                });
            }
        }

        var result = await _supabase
            .From<MessageThread>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Filter("type_raw", Supabase.Postgrest.Constants.Operator.Equals, "company_feed")
            .Get();

        if (result.Models.FirstOrDefault() is { } existing)
            return existing;

        var newFeed = new MessageThread
        {
            CompanyId = companyId,
            Subject = "Company Feed",
            TypeRaw = "company_feed",
            ParticipantIds = []
        };
        var created = await _supabase.From<MessageThread>().Insert(newFeed);
        return created.Models.First();
    }
}
