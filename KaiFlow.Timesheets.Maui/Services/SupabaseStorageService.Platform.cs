using System.Text.Json;
using KaiFlow.Timesheets.Controls;
using KaiFlow.Timesheets.Models.Platform;
using Op = Supabase.Postgrest.Constants.Operator;
using Ord = Supabase.Postgrest.Constants.Ordering;

namespace KaiFlow.Timesheets.Services;

public partial class SupabaseStorageService
{
    public async Task<bool> IsPlatformAdminAsync()
    {
        try
        {
            var result = await _supabase.Rpc("platform_is_admin", new Dictionary<string, object>());
            if (string.IsNullOrWhiteSpace(result.Content)) return false;
            return result.Content.Trim().Equals("true", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    public async Task<SaasSubscriptionSummary?> GetSaasSubscriptionAsync(Guid companyId)
    {
        try
        {
            var result = await _supabase.Rpc("saas_get_company_subscription", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
            });
            if (string.IsNullOrWhiteSpace(result.Content) || result.Content == "{}" || result.Content == "null")
                return null;

            var json = JsonSerializer.Deserialize<JsonElement>(result.Content);
            return ParseSubscriptionSummary(json);
        }
        catch
        {
            return null;
        }
    }

    public async Task<List<SaasCompanyFeature>> GetSaasCompanyFeaturesAsync(Guid companyId)
    {
        var result = await _supabase
            .From<SaasCompanyFeature>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Get();
        return result.Models ?? [];
    }

    public async Task<List<SaasPlan>> GetSaasPlansAsync()
    {
        var result = await _supabase
            .From<SaasPlan>()
            .Filter("is_active", Op.Equals, "true")
            .Order("monthly_price", Ord.Ascending)
            .Get();
        return result.Models ?? [];
    }

    public async Task<List<PlatformCompanySummary>> PlatformListCompaniesAsync(int limit = 100, int offset = 0)
    {
        var result = await _supabase.Rpc("platform_list_companies", new Dictionary<string, object>
        {
            ["p_limit"] = limit,
            ["p_offset"] = offset,
        });

        if (string.IsNullOrWhiteSpace(result.Content) || result.Content == "null")
            return [];

        var arr = JsonSerializer.Deserialize<JsonElement[]>(result.Content) ?? [];
        return arr.Select(ParseCompanySummary).Where(c => c is not null).Cast<PlatformCompanySummary>().ToList();
    }

    public async Task PlatformSetSubscriptionStatusAsync(Guid companyId, string status, string? note = null)
    {
        await _supabase.Rpc("platform_set_subscription_status", new Dictionary<string, object>
        {
            ["p_company_id"] = companyId.ToString(),
            ["p_status"] = status,
            ["p_note"] = note ?? "",
        });
    }

    public async Task PlatformSetCompanyFeatureAsync(Guid companyId, string featureCode, bool enabled, DateTime? expiresAt = null, string? reason = null)
    {
        var args = new Dictionary<string, object>
        {
            ["p_company_id"] = companyId.ToString(),
            ["p_feature_code"] = featureCode,
            ["p_enabled"] = enabled,
            ["p_reason"] = reason ?? "",
        };
        if (expiresAt.HasValue)
            args["p_expires_at"] = expiresAt.Value.ToUniversalTime().ToString("o");
        await _supabase.Rpc("platform_set_company_feature", args);
    }

    public async Task UpsertSaasUsageSnapshotAsync(Guid companyId, DateOnly periodMonth, Dictionary<string, double> metrics)
    {
        var metricsJson = metrics.ToDictionary(kv => kv.Key, kv => (object)kv.Value);
        await _supabase.Rpc("saas_upsert_usage_snapshot", new Dictionary<string, object>
        {
            ["p_company_id"] = companyId.ToString(),
            ["p_period_month"] = periodMonth.ToString("yyyy-MM-dd"),
            ["p_metrics"] = JsonSerializer.Serialize(metricsJson),
        });
    }

    public async Task<SaasUsageSnapshot?> GetSaasUsageSnapshotAsync(Guid companyId, DateOnly periodMonth)
    {
        var result = await _supabase
            .From<SaasUsageSnapshot>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Filter("period_month", Op.Equals, periodMonth.ToString("yyyy-MM-dd"))
            .Get();
        return result.Models?.FirstOrDefault();
    }

    public async Task<List<SaasOnboardingProgress>> GetSaasOnboardingProgressAsync(Guid companyId)
    {
        var result = await _supabase
            .From<SaasOnboardingProgress>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Get();
        return result.Models ?? [];
    }

    public async Task UpsertSaasOnboardingStepAsync(Guid companyId, string stepKey, bool completed)
    {
        var existing = await _supabase
            .From<SaasOnboardingProgress>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Filter("step_key", Op.Equals, stepKey)
            .Get();

        var row = existing.Models?.FirstOrDefault() ?? new SaasOnboardingProgress
        {
            CompanyId = companyId,
            StepKey = stepKey,
        };
        row.IsCompleted = completed;
        row.CompletedAt = completed ? DateTime.UtcNow : null;
        row.UpdatedAt = DateTime.UtcNow;

        if (row.Id == Guid.Empty)
            await _supabase.From<SaasOnboardingProgress>().Insert(row);
        else
            await _supabase.From<SaasOnboardingProgress>().Update(row);
    }

    public async Task<List<SaasPlatformAuditEntry>> GetPlatformAuditLogAsync(int limit = 50)
    {
        var result = await _supabase
            .From<SaasPlatformAuditEntry>()
            .Order("created_at", Ord.Descending)
            .Limit(limit)
            .Get();
        return result.Models ?? [];
    }

    public async Task<List<SaasSupportNote>> GetSaasSupportNotesAsync(Guid companyId)
    {
        var result = await _supabase
            .From<SaasSupportNote>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Order("created_at", Ord.Descending)
            .Get();
        return result.Models ?? [];
    }

    public async Task AddSaasSupportNoteAsync(Guid companyId, string note, string severity)
    {
        await _supabase.From<SaasSupportNote>().Insert(new SaasSupportNote
        {
            CompanyId = companyId,
            Note = note,
            Severity = severity,
            CreatedAt = DateTime.UtcNow,
        });
    }

    public async Task<List<SaasReleaseRollout>> GetSaasReleaseRolloutsAsync()
    {
        var result = await _supabase
            .From<SaasReleaseRollout>()
            .Filter("is_active", Op.Equals, "true")
            .Get();
        return result.Models ?? [];
    }

    public async Task UpsertCompanyAppVersionAsync(Guid companyId, string appVersion, string? platform)
    {
        var plat = platform ?? DeviceInfo.Current.Platform.ToString();
        var existing = await _supabase
            .From<SaasCompanyAppVersion>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Filter("app_version", Op.Equals, appVersion)
            .Filter("platform", Op.Equals, plat)
            .Get();

        var row = existing.Models?.FirstOrDefault();
        if (row is null)
        {
            await _supabase.From<SaasCompanyAppVersion>().Insert(new SaasCompanyAppVersion
            {
                CompanyId = companyId,
                AppVersion = appVersion,
                Platform = plat,
                LastSeenAt = DateTime.UtcNow,
            });
        }
        else
        {
            row.LastSeenAt = DateTime.UtcNow;
            await _supabase.From<SaasCompanyAppVersion>().Update(row);
        }
    }

    public async Task<PlatformKpiSnapshot> GetPlatformKpiSnapshotAsync()
    {
        var companies = await PlatformListCompaniesAsync(500, 0);
        var plans = await GetSaasPlansAsync();
        var planPrice = plans.ToDictionary(p => p.Code, p => p.MonthlyPrice);

        return new PlatformKpiSnapshot
        {
            TotalCompanies = companies.Count,
            ActiveSubscriptions = companies.Count(c => c.SubscriptionStatus == "active"),
            TrialingCompanies = companies.Count(c => c.SubscriptionStatus == "trialing"),
            PastDueCompanies = companies.Count(c => c.SubscriptionStatus == "past_due"),
            TotalEmployees = companies.Sum(c => c.EmployeeCount),
            MrrEstimate = companies
                .Where(c => c.SubscriptionStatus is "active" or "trialing")
                .Sum(c => c.MonthlyCharge > 0 ? c.MonthlyCharge : planPrice.GetValueOrDefault(c.PlanCode, 0)),
        };
    }

    public async Task<PlatformAdminDashboard> GetPlatformAdminDashboardAsync(CancellationToken ct = default)
    {
        try
        {
            var result = await _supabase.Rpc("platform_admin_dashboard", new Dictionary<string, object>());
            if (string.IsNullOrWhiteSpace(result.Content)) return new PlatformAdminDashboard();
            return ParsePlatformAdminDashboard(JsonSerializer.Deserialize<JsonElement>(result.Content));
        }
        catch
        {
            return new PlatformAdminDashboard();
        }
    }

    public async Task<List<PlatformCompanySummary>> PlatformSearchCompaniesAsync(string query, int limit = 100, int offset = 0, CancellationToken ct = default)
    {
        var result = await _supabase.Rpc("platform_search_companies", new Dictionary<string, object>
        {
            ["p_query"] = query ?? "",
            ["p_limit"] = limit,
            ["p_offset"] = offset,
        });
        if (string.IsNullOrWhiteSpace(result.Content) || result.Content == "null") return [];
        var arr = JsonSerializer.Deserialize<JsonElement[]>(result.Content) ?? [];
        return arr.Select(ParseCompanySummary).Where(c => c is not null).Cast<PlatformCompanySummary>().ToList();
    }

    public async Task<TenantHealthScore?> GetPlatformCustomerHealthAsync(Guid companyId, CancellationToken ct = default)
    {
        try
        {
            var result = await _supabase.Rpc("platform_customer_health", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
            });
            if (string.IsNullOrWhiteSpace(result.Content)) return null;
            return ParseCustomerHealth(JsonSerializer.Deserialize<JsonElement>(result.Content));
        }
        catch { return null; }
    }

    public async Task<CompanySubscriptionBilling?> GetCompanySubscriptionBillingAsync(Guid companyId, CancellationToken ct = default)
    {
        var result = await _supabase
            .From<CompanySubscriptionBilling>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Limit(1)
            .Get();
        return result.Models?.FirstOrDefault();
    }

    public async Task<CompanySubscriptionBilling?> PlatformRefreshCompanySubscriptionAsync(Guid companyId, CancellationToken ct = default)
    {
        try
        {
            var result = await _supabase.Rpc("platform_refresh_company_subscription", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
            });
            if (string.IsNullOrWhiteSpace(result.Content)) return null;
            return ParseCompanySubscription(JsonSerializer.Deserialize<JsonElement>(result.Content));
        }
        catch { return null; }
    }

    public async Task SubmitPlatformFeedbackAsync(Guid companyId, string category, string message, string priority, CancellationToken ct = default)
    {
        var session = _supabase.Auth.CurrentSession?.User;
        await _supabase.From<PlatformFeedback>().Insert(new PlatformFeedback
        {
            CompanyId = companyId,
            UserId = session?.Id is string uid && Guid.TryParse(uid, out var g) ? g : null,
            EmployeeId = _state.CurrentEmployee?.CompanyId == companyId ? _state.CurrentEmployee.Id : null,
            Category = category,
            Priority = priority,
            Message = message.Trim(),
            Status = "New",
        });
    }

    public async Task<List<PlatformFeedback>> GetCompanyPlatformFeedbackAsync(Guid companyId, CancellationToken ct = default)
    {
        var result = await _supabase
            .From<PlatformFeedback>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Order("created_at", Ord.Descending)
            .Limit(50)
            .Get();
        return result.Models ?? [];
    }

    public async Task<List<PlatformFeedback>> GetPlatformFeedbackAsync(string? status = null, CancellationToken ct = default)
    {
        var q = _supabase.From<PlatformFeedback>().Order("created_at", Ord.Descending).Limit(200);
        if (!string.IsNullOrWhiteSpace(status))
            q = q.Filter("status", Op.Equals, status);
        var result = await q.Get();
        return result.Models ?? [];
    }

    public async Task UpdatePlatformFeedbackStatusAsync(Guid feedbackId, string status, string? releaseVersion, string? adminNotes, CancellationToken ct = default)
    {
        var existing = await _supabase.From<PlatformFeedback>().Filter("id", Op.Equals, feedbackId.ToString()).Get();
        var row = existing.Models?.FirstOrDefault() ?? throw new InvalidOperationException("Feedback not found");
        row.Status = status;
        row.ReleaseVersion = releaseVersion;
        row.AdminNotes = adminNotes;
        row.UpdatedAt = DateTime.UtcNow;
        await _supabase.From<PlatformFeedback>().Update(row);
    }

    public async Task<PlatformFeedbackStats> GetPlatformFeedbackStatsAsync(CancellationToken ct = default)
    {
        try
        {
            var result = await _supabase.Rpc("platform_feedback_stats", new Dictionary<string, object>());
            if (string.IsNullOrWhiteSpace(result.Content)) return new PlatformFeedbackStats();
            return ParseFeedbackStats(JsonSerializer.Deserialize<JsonElement>(result.Content));
        }
        catch { return new PlatformFeedbackStats(); }
    }

    private static PlatformAdminDashboard ParsePlatformAdminDashboard(JsonElement root)
    {
        var dash = new PlatformAdminDashboard();
        if (root.TryGetProperty("kpis", out var kpis))
        {
            dash.Kpis = new PlatformAdminKpis
            {
                TotalCompanies = kpis.TryGetProperty("total_companies", out var v1) ? v1.GetInt32() : 0,
                TotalEmployees = kpis.TryGetProperty("total_employees", out var v2) ? v2.GetInt32() : 0,
                ActiveUsersToday = kpis.TryGetProperty("active_users_today", out var v3) ? v3.GetInt32() : 0,
                MonthlyActiveUsers = kpis.TryGetProperty("monthly_active_users", out var v4) ? v4.GetInt32() : 0,
                MonthlyRevenue = kpis.TryGetProperty("monthly_revenue", out var v5) ? v5.GetDecimal() : 0,
                NewCompaniesThisMonth = kpis.TryGetProperty("new_companies_this_month", out var v6) ? v6.GetInt32() : 0,
                TotalPayrollProcessed = kpis.TryGetProperty("total_payroll_processed", out var v7) ? v7.GetInt32() : 0,
                TotalInvoicesGenerated = kpis.TryGetProperty("total_invoices_generated", out var v8) ? v8.GetInt32() : 0,
                ErrorCount = kpis.TryGetProperty("error_count", out var v9) ? v9.GetInt32() : 0,
                PendingFeedback = kpis.TryGetProperty("pending_feedback", out var v10) ? v10.GetInt32() : 0,
            };
        }
        if (root.TryGetProperty("trends", out var trends))
        {
            dash.Trends.CompanyGrowth = ParseChartSeries(trends, "company_growth");
            dash.Trends.RevenueGrowth = ParseChartSeries(trends, "revenue_growth");
            dash.Trends.ActiveUsersTrend = ParseChartSeries(trends, "active_users_trend");
            dash.Trends.ErrorTrend = ParseChartSeries(trends, "error_trend");
        }
        return dash;
    }

    private static List<ChartValue> ParseChartSeries(JsonElement trends, string key)
    {
        if (!trends.TryGetProperty(key, out var arr) || arr.ValueKind != JsonValueKind.Array) return [];
        return arr.EnumerateArray().Select(el => new ChartValue
        {
            Label = el.TryGetProperty("label", out var l) ? l.GetString() ?? "" : "",
            Value = el.TryGetProperty("value", out var v) && v.TryGetDouble(out var d) ? d : 0,
        }).ToList();
    }

    private static TenantHealthScore? ParseCustomerHealth(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object) return null;
        var issues = new List<string>();
        if (json.TryGetProperty("issues", out var iss) && iss.ValueKind == JsonValueKind.Array)
            foreach (var i in iss.EnumerateArray())
                if (i.GetString() is { } s) issues.Add(s);

        return new TenantHealthScore
        {
            CompanyId = json.TryGetProperty("company_id", out var cid) && Guid.TryParse(cid.GetString(), out var g) ? g : Guid.Empty,
            Score = json.TryGetProperty("score", out var sc) ? sc.GetInt32() : 0,
            Status = json.TryGetProperty("status", out var st) ? st.GetString() ?? "Healthy" : "Healthy",
            Grade = json.TryGetProperty("grade", out var gr) ? gr.GetString() ?? "B" : "B",
            LastLogin = json.TryGetProperty("last_login", out var ll) && DateTime.TryParse(ll.GetString(), out var dt) ? dt : null,
            ActiveUsers30d = json.TryGetProperty("active_users_30d", out var au) ? au.GetInt32() : 0,
            ErrorCount30d = json.TryGetProperty("error_count_30d", out var ec) ? ec.GetInt32() : 0,
            OpenFeedback = json.TryGetProperty("open_feedback", out var of) ? of.GetInt32() : 0,
            Issues = issues,
        };
    }

    private static CompanySubscriptionBilling? ParseCompanySubscription(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object) return null;
        return new CompanySubscriptionBilling
        {
            Id = json.TryGetProperty("id", out var id) && Guid.TryParse(id.GetString(), out var g) ? g : Guid.Empty,
            CompanyId = json.TryGetProperty("company_id", out var cid) && Guid.TryParse(cid.GetString(), out var g2) ? g2 : Guid.Empty,
            PlanName = json.TryGetProperty("plan_name", out var pn) ? pn.GetString() ?? "" : "",
            BasePrice = json.TryGetProperty("base_price", out var bp) ? bp.GetDecimal() : 2500,
            IncludedEmployees = json.TryGetProperty("included_employees", out var ie) ? ie.GetInt32() : 25,
            AdditionalEmployeePrice = json.TryGetProperty("additional_employee_price", out var ap) ? ap.GetDecimal() : 99,
            EmployeeCount = json.TryGetProperty("employee_count", out var ec) ? ec.GetInt32() : 0,
            MonthlyCharge = json.TryGetProperty("monthly_charge", out var mc) ? mc.GetDecimal() : 0,
            Status = json.TryGetProperty("status", out var st) ? st.GetString() ?? "" : "",
        };
    }

    private static PlatformFeedbackStats ParseFeedbackStats(JsonElement json)
    {
        var stats = new PlatformFeedbackStats
        {
            Total = json.TryGetProperty("total", out var t) ? t.GetInt32() : 0,
        };
        if (json.TryGetProperty("by_status", out var bs) && bs.ValueKind == JsonValueKind.Object)
            foreach (var prop in bs.EnumerateObject())
                stats.ByStatus[prop.Name] = prop.Value.GetInt32();
        if (json.TryGetProperty("top_feature_requests", out var top) && top.ValueKind == JsonValueKind.Array)
            stats.TopFeatureRequests = top.EnumerateArray().Select(el => new FeatureRequestSummary
            {
                Message = el.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "",
                Count = el.TryGetProperty("count", out var c) ? c.GetInt32() : 0,
            }).ToList();
        return stats;
    }

    private static SaasSubscriptionSummary? ParseSubscriptionSummary(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object) return null;
        return new SaasSubscriptionSummary
        {
            SubscriptionId = json.TryGetProperty("subscription_id", out var sid) && Guid.TryParse(sid.GetString(), out var g1) ? g1 : Guid.Empty,
            CompanyId = json.TryGetProperty("company_id", out var cid) && Guid.TryParse(cid.GetString(), out var g2) ? g2 : Guid.Empty,
            PlanCode = json.TryGetProperty("plan_code", out var pc) ? pc.GetString() ?? "" : "",
            PlanName = json.TryGetProperty("plan_name", out var pn) ? pn.GetString() ?? "" : "",
            SubscriptionStatus = json.TryGetProperty("subscription_status", out var ss) ? ss.GetString() ?? "" : "",
            BillingStatus = json.TryGetProperty("billing_status", out var bs) ? bs.GetString() ?? "" : "",
            EmployeeLimit = json.TryGetProperty("employee_limit", out var el) ? el.GetInt32() : 0,
            CurrentEmployeeCount = json.TryGetProperty("current_employee_count", out var ec) ? ec.GetInt32() : 0,
            TrialEndsAt = json.TryGetProperty("trial_ends_at", out var te) && te.ValueKind == JsonValueKind.String
                ? DateTime.TryParse(te.GetString(), out var dt) ? dt : null : null,
            AmountDue = json.TryGetProperty("amount_due", out var ad) ? ad.GetDecimal() : 0,
        };
    }

    private static PlatformCompanySummary? ParseCompanySummary(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object) return null;
        return new PlatformCompanySummary
        {
            Id = json.TryGetProperty("id", out var id) && Guid.TryParse(id.GetString(), out var g) ? g : Guid.Empty,
            Name = json.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "",
            Code = json.TryGetProperty("code", out var c) ? c.GetString() ?? "" : "",
            PlanCode = json.TryGetProperty("plan_code", out var p) ? p.GetString() ?? "" : "",
            SubscriptionStatus = json.TryGetProperty("subscription_status", out var s) ? s.GetString() ?? "" : "",
            EmployeeCount = json.TryGetProperty("employee_count", out var ec) ? ec.GetInt32() : 0,
            EmployeeLimit = json.TryGetProperty("employee_limit", out var el) ? el.GetInt32() : 0,
            MonthlyCharge = json.TryGetProperty("monthly_charge", out var mc) ? mc.GetDecimal() : 0,
            SubscriptionActive = json.TryGetProperty("subscription_active", out var sa) && sa.GetBoolean(),
            CreatedAt = json.TryGetProperty("created_at", out var ca) && DateTime.TryParse(ca.GetString(), out var dt) ? dt : default,
        };
    }
}
