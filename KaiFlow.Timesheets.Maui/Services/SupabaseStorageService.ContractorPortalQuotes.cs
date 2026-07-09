using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.ViewModels.ContractorPortal;
using System.Text.Json;
using static Supabase.Postgrest.Constants;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Contractor Portal quote operations (Phase 2D.2).
/// Portal calls use SECURITY DEFINER RPCs (anon-accessible, UUID-auth).
/// HR reads use direct PostgREST (authenticated JWT, permissive RLS).
/// </summary>
public partial class SupabaseStorageService
{
    // ─── Portal: list quotes ──────────────────────────────────────────────────

    public async Task<List<ContractorQuote>> ContractorPortalListQuotesAsync(
        Guid contractorId, Guid companyId)
    {
        var result = await _supabase.Rpc("contractor_portal_list_quotes",
            new Dictionary<string, object>
            {
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_company_id"]    = companyId.ToString(),
            });
        return ParseQuoteList(result?.Content);
    }

    // ─── Portal: get single quote (with items + attachments) ──────────────────

    public async Task<ContractorQuote?> ContractorPortalGetQuoteAsync(
        Guid contractorId, Guid companyId, Guid quoteId)
    {
        var result = await _supabase.Rpc("contractor_portal_get_quote",
            new Dictionary<string, object>
            {
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_company_id"]    = companyId.ToString(),
                ["p_quote_id"]      = quoteId.ToString(),
            });
        var content = result?.Content;
        if (string.IsNullOrWhiteSpace(content) || content is "null" or "[]") return null;
        try
        {
            using var doc = JsonDocument.Parse(content);
            return ParseQuoteDetail(doc.RootElement, contractorId, companyId);
        }
        catch { return null; }
    }

    // ─── Portal: save draft (create or update) ────────────────────────────────
    //
    // BUG FIX: never use DBNull.Value — simply omit p_quote_id when creating new.
    // The PostgreSQL function has DEFAULT NULL for that parameter.

    public async Task<Guid> ContractorPortalSaveQuoteDraftAsync(
        Guid contractorId, Guid companyId,
        Guid? quoteId,
        string title, string description, string quoteNumber,
        DateOnly? validUntil,
        string vatMode, decimal vatRate,
        decimal discount, decimal freight, decimal duty,
        decimal levies, decimal otherCharges,
        string terms, string contractorNotes,
        List<QuoteLineItemRow> items)
    {
        // ROOT-CAUSE FIX for "cannot extract elements from a scalar":
        //
        // OLD (broken): Newtonsoft.JsonConvert.SerializeObject(items) produces a C# string.
        // The SDK then JSON-encodes that string again → p_items arrives as a JSON *string*
        // scalar in PostgreSQL, not a JSONB array. jsonb_array_elements(scalar) throws.
        //
        // NEW (correct): pass the raw .NET list directly. The SDK serialises the entire
        // params dictionary in one pass → p_items becomes a proper JSON *array* of objects.
        //
        // p_items JSON format expected by PostgreSQL:
        //   [{"description":"...","quantity":2,"unit_price":500,"discount_amount":0}]

        var rpcParams = new Dictionary<string, object>
        {
            ["p_contractor_id"]    = contractorId.ToString(),
            ["p_company_id"]       = companyId.ToString(),
            ["p_quote_id"]         = quoteId.HasValue ? quoteId.Value.ToString() : null!,
            ["p_title"]            = title.Trim(),
            ["p_description"]      = description.Trim(),
            ["p_quote_number"]     = quoteNumber.Trim(),
            ["p_valid_until"]      = validUntil.HasValue ? validUntil.Value.ToString("yyyy-MM-dd") : null!,
            ["p_vat_mode"]         = vatMode,
            ["p_vat_rate"]         = vatRate,
            ["p_discount"]         = discount,
            ["p_freight"]          = freight,
            ["p_duty"]             = duty,
            ["p_levies"]           = levies,
            ["p_other_charges"]    = otherCharges,
            ["p_terms"]            = terms.Trim(),
            ["p_contractor_notes"] = contractorNotes.Trim(),
            // Pass as a .NET list — SDK serialises to JSON array, not a JSON-encoded string
            ["p_items"]            = items.Select(i => i.ToJsonDict()).ToList(),
        };

        var result  = await _supabase.Rpc("contractor_portal_save_quote_draft", rpcParams);
        var content = result?.Content?.Trim('"');
        return Guid.TryParse(content, out var id) ? id : Guid.Empty;
    }

    // ─── Portal: submit a draft ───────────────────────────────────────────────

    public async Task ContractorPortalSubmitQuoteAsync(
        Guid contractorId, Guid companyId, Guid quoteId)
    {
        await _supabase.Rpc("contractor_portal_submit_quote",
            new Dictionary<string, object>
            {
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_company_id"]    = companyId.ToString(),
                ["p_quote_id"]      = quoteId.ToString(),
            });
    }

    // ─── Portal: upload quote (external document) ─────────────────────────────

    public async Task<Guid> ContractorPortalUploadQuoteAsync(
        Guid contractorId, Guid companyId,
        FileResult file,
        string title, string description, string quoteNumber,
        string vatMode, decimal vatRate,
        decimal amount,
        decimal discount, decimal freight, decimal duty,
        decimal levies, decimal otherCharges,
        DateOnly? validUntil, string contractorNotes)
    {
        var (bytes, ext) = await ReadPickerFileAsync(file);
        var storagePath  = $"contractor_quotes/{companyId}/{contractorId}/{Guid.NewGuid()}{ext}";

        await _supabase.Storage.From("workforce-media").Upload(bytes, storagePath);
        var fileUrl = await ResolveWorkforceMediaUrlAsync(storagePath);

        // PGRST202 fix: always include p_valid_until (null when absent)
        var rpcParams = new Dictionary<string, object>
        {
            ["p_contractor_id"]    = contractorId.ToString(),
            ["p_company_id"]       = companyId.ToString(),
            ["p_title"]            = title.Trim(),
            ["p_description"]      = description.Trim(),
            ["p_quote_number"]     = quoteNumber.Trim(),
            ["p_amount"]           = amount,
            ["p_vat_mode"]         = vatMode,
            ["p_vat_rate"]         = vatRate,
            ["p_discount"]         = discount,
            ["p_freight"]          = freight,
            ["p_duty"]             = duty,
            ["p_levies"]           = levies,
            ["p_other_charges"]    = otherCharges,
            ["p_valid_until"]      = validUntil.HasValue ? validUntil.Value.ToString("yyyy-MM-dd") : null!,
            ["p_contractor_notes"] = contractorNotes.Trim(),
            ["p_file_url"]         = fileUrl,
            ["p_file_name"]        = file.FileName,
            ["p_storage_path"]     = storagePath,
        };

        var result  = await _supabase.Rpc("contractor_portal_upload_quote", rpcParams);
        var content = result?.Content?.Trim('"');
        return Guid.TryParse(content, out var id) ? id : Guid.Empty;
    }

    // ─── Portal: delete a draft ───────────────────────────────────────────────

    public async Task ContractorPortalDeleteDraftAsync(
        Guid contractorId, Guid companyId, Guid quoteId)
    {
        await _supabase.Rpc("contractor_portal_delete_draft",
            new Dictionary<string, object>
            {
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_company_id"]    = companyId.ToString(),
                ["p_quote_id"]      = quoteId.ToString(),
            });
    }

    // ─── Portal: resubmit a revision_requested quote ──────────────────────────

    public async Task ContractorPortalResubmitQuoteAsync(
        Guid contractorId, Guid companyId, Guid quoteId)
    {
        await _supabase.Rpc("contractor_portal_resubmit_quote",
            new Dictionary<string, object>
            {
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_company_id"]    = companyId.ToString(),
                ["p_quote_id"]      = quoteId.ToString(),
            });
    }

    // ─── HR: read quotes for a contractor (authenticated PostgREST) ───────────

    public async Task<List<ContractorQuote>> GetContractorQuotesAsync(
        Guid companyId, Guid contractorId)
    {
        var result = await _supabase
            .From<ContractorQuote>()
            .Filter("company_id",    Operator.Equals, companyId.ToString())
            .Filter("contractor_id", Operator.Equals, contractorId.ToString())
            .Order("created_at", Ordering.Descending)
            .Get();
        return result.Models;
    }

    public async Task<List<ContractorQuoteItem>> GetContractorQuoteItemsAsync(Guid quoteId)
    {
        var result = await _supabase
            .From<ContractorQuoteItem>()
            .Filter("quote_id", Operator.Equals, quoteId.ToString())
            .Order("sort_order", Ordering.Ascending)
            .Get();
        return result.Models;
    }

    public async Task<List<ContractorQuoteAttachment>> GetContractorQuoteAttachmentsAsync(Guid quoteId)
    {
        var result = await _supabase
            .From<ContractorQuoteAttachment>()
            .Filter("quote_id", Operator.Equals, quoteId.ToString())
            .Order("is_primary", Ordering.Descending)
            .Get();
        return result.Models;
    }

    // ─── HR: Contractor Action Centre ────────────────────────────────────────

    public async Task<List<ContractorActionItem>> GetContractorActionItemsAsync(Guid companyId)
    {
        // Use direct PostgREST reads (ORM) rather than an RPC so there are
        // no EXECUTE-permission concerns and no silent catch-all failure paths.
        // Each source is queried independently; failures are logged, not swallowed.

        var items = new List<ContractorActionItem>();

        try
        {
            // ── 1. Pending quotes ──────────────────────────────────────────────
            var qResult = await _supabase
                .From<ContractorQuote>()
                .Filter("company_id", Operator.Equals, companyId.ToString())
                .Filter("status", Operator.In, new List<object> { "submitted", "under_review" })
                .Order("submitted_at", Ordering.Descending)
                .Get();

            foreach (var q in qResult.Models)
            {
                items.Add(new ContractorActionItem
                {
                    RefId          = q.Id,
                    ContractorId   = q.ContractorId,
                    ContractorName = "",           // filled by contractor lookup below
                    ContractorCode = "",
                    ActionType     = "quote_pending",
                    Summary        = $"Quote {q.QuoteNumberDisplay} awaiting review — {q.TotalDisplay}",
                    Amount         = q.TotalAmount,
                    Status         = q.Status,
                    CreatedAt      = q.SubmittedAt ?? q.CreatedAt,
                });
            }
        }
        catch { /* non-critical — skip quotes */ }

        try
        {
            // ── 2. Pending banking updates ─────────────────────────────────────
            var bResult = await _supabase
                .From<ContractorBankingUpdate>()
                .Filter("company_id", Operator.Equals, companyId.ToString())
                .Filter("status",     Operator.Equals, "pending")
                .Order("submitted_at", Ordering.Descending)
                .Get();

            foreach (var b in bResult.Models)
            {
                items.Add(new ContractorActionItem
                {
                    RefId          = b.Id,
                    ContractorId   = b.ContractorId,
                    ContractorName = "",
                    ContractorCode = "",
                    ActionType     = "banking_pending",
                    Summary        = "Banking details update awaiting approval",
                    Amount         = null,
                    Status         = b.Status,
                    CreatedAt      = b.SubmittedAt,
                });
            }
        }
        catch { /* non-critical — skip banking */ }

        // Enrich items with contractor names (one extra read, cached per call)
        if (items.Count > 0)
        {
            try
            {
                var cResult = await _supabase
                    .From<Contractor>()
                    .Filter("company_id", Operator.Equals, companyId.ToString())
                    .Get();

                var nameMap = cResult.Models.ToDictionary(c => c.Id, c => (c.Name, Code: c.ContractorCode ?? ""));
                for (int i = 0; i < items.Count; i++)
                {
                    if (nameMap.TryGetValue(items[i].ContractorId, out var info))
                    {
                        items[i].ContractorName = info.Name;
                        items[i].ContractorCode = info.Code;
                    }
                }
            }
            catch { /* names stay blank — tolerable */ }
        }

        return items.OrderBy(i => i.ActionType == "banking_pending" ? 1 : 0)
                    .ThenByDescending(i => i.CreatedAt)
                    .ToList();
    }

    private static ContractorActionItem ParseActionItem(JsonElement el)
    {
        Guid.TryParse(QStr(el, "ref_id"),        out var refId);
        Guid.TryParse(QStr(el, "contractor_id"), out var cid);
        DateTime.TryParse(QStr(el, "created_at"), out var created);
        var amount = el.TryGetProperty("amount", out var av) && av.ValueKind == JsonValueKind.Number
            && av.TryGetDecimal(out var d) ? (decimal?)d : null;

        return new ContractorActionItem
        {
            RefId          = refId,
            ContractorId   = cid,
            ContractorName = QStr(el, "contractor_name") ?? "",
            ContractorCode = QStr(el, "contractor_code") ?? "",
            ActionType     = QStr(el, "action_type") ?? "",
            Summary        = QStr(el, "summary") ?? "",
            Amount         = amount,
            Status         = QStr(el, "status") ?? "",
            CreatedAt      = created,
        };
    }

    // ─── HR: recent activity feed ────────────────────────────────────────────

    public async Task<List<ContractorActivityEvent>> GetContractorActivityAsync(
        Guid companyId, int limit = 50)
    {
        var result = await _supabase.Rpc("hr_get_contractor_activity",
            new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_limit"]      = limit,
            });

        var content = result?.Content;
        if (string.IsNullOrWhiteSpace(content) || content is "null" or "[]") return [];
        try
        {
            using var doc = JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
            return doc.RootElement.EnumerateArray().Select(ParseActivityEvent).ToList();
        }
        catch { return []; }
    }

    private static ContractorActivityEvent ParseActivityEvent(JsonElement el)
    {
        Guid.TryParse(QStr(el, "contractor_id"), out var cid);
        DateTime.TryParse(QStr(el, "created_at"), out var created);

        return new ContractorActivityEvent
        {
            Id             = QStr(el, "id")             ?? "",
            ContractorId   = cid,
            ContractorName = QStr(el, "contractor_name") ?? "",
            ContractorCode = QStr(el, "contractor_code") ?? "",
            Screen         = QStr(el, "screen")          ?? "",
            Action         = QStr(el, "action")          ?? "",
            EventType      = QStr(el, "event_type")      ?? "",
            EventLabel     = QStr(el, "event_label")     ?? "",
            Summary        = QStr(el, "summary")         ?? "",
            Source         = QStr(el, "source")          ?? "",
            CreatedAt      = created,
        };
    }

    // ─── HR: Quote → Job conversion (Phase 2D.4) ─────────────────────────────

    public async Task<(Guid JobId, string JobCode)> HrConvertQuoteToJobAsync(
        Guid companyId, Guid hrUserId, Guid quoteId,
        string jobTitle, string? description, string priority,
        DateTime? scheduledStart, DateTime? scheduledEnd,
        Guid? dealId = null)
    {
        var rpcParams = new Dictionary<string, object>
        {
            ["p_company_id"]      = companyId.ToString(),
            ["p_hr_user_id"]      = hrUserId.ToString(),
            ["p_quote_id"]        = quoteId.ToString(),
            ["p_job_title"]       = jobTitle.Trim(),
            ["p_description"]     = description?.Trim() ?? (object)null!,
            ["p_priority"]        = priority,
            ["p_scheduled_start"] = scheduledStart.HasValue
                                    ? scheduledStart.Value.ToString("o") : (object)null!,
            ["p_scheduled_end"]   = scheduledEnd.HasValue
                                    ? scheduledEnd.Value.ToString("o")   : (object)null!,
            ["p_deal_id"]         = dealId.HasValue ? dealId.Value.ToString() : (object)null!,
        };

        var result  = await _supabase.Rpc("hr_convert_quote_to_job", rpcParams);
        var content = result?.Content;

        if (string.IsNullOrWhiteSpace(content) || content is "null")
            throw new Exception("Conversion RPC returned no result.");

        using var doc = JsonDocument.Parse(content);
        var jobIdStr  = doc.RootElement.GetProperty("job_id").GetString()
                        ?? throw new Exception("job_id missing from conversion response.");
        var jobCode   = doc.RootElement.GetProperty("job_code").GetString() ?? "";

        return (Guid.Parse(jobIdStr), jobCode);
    }

    public async Task HrUpsertJobContractorAsync(
        Guid companyId, Guid jobId, Guid contractorId,
        Guid? quoteId = null, decimal agreedAmount = 0, Guid? dealId = null)
    {
        await _supabase.Rpc("hr_upsert_job_contractor",
            new Dictionary<string, object>
            {
                ["p_company_id"]    = companyId.ToString(),
                ["p_job_id"]        = jobId.ToString(),
                ["p_contractor_id"] = contractorId.ToString(),
                ["p_quote_id"]      = quoteId.HasValue ? quoteId.Value.ToString() : (object)null!,
                ["p_agreed_amount"] = agreedAmount,
                ["p_deal_id"]       = dealId.HasValue ? dealId.Value.ToString() : (object)null!,
            });
    }

    // ─── HR: assign quote to existing job (Phase 2D.5) ───────────────────────

    public async Task HrAssignQuoteToJobAsync(
        Guid companyId, Guid hrUserId, Guid quoteId, Guid jobId)
    {
        await _supabase.Rpc("hr_assign_quote_to_job",
            new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
                ["p_hr_user_id"] = hrUserId.ToString(),
                ["p_quote_id"]   = quoteId.ToString(),
                ["p_job_id"]     = jobId.ToString(),
            });
    }

    // ─── HR: review actions (Phase 2D.3) ─────────────────────────────────────

    public async Task HrStartQuoteReviewAsync(Guid companyId, Guid hrUserId, Guid quoteId)
    {
        await _supabase.Rpc("hr_start_quote_review",
            new Dictionary<string, object>
            {
                ["p_company_id"]  = companyId.ToString(),
                ["p_hr_user_id"]  = hrUserId.ToString(),
                ["p_quote_id"]    = quoteId.ToString(),
            });
    }

    public async Task HrApproveContractorQuoteAsync(
        Guid companyId, Guid hrUserId, Guid quoteId, string? hrNotes)
    {
        await _supabase.Rpc("hr_approve_contractor_quote",
            new Dictionary<string, object>
            {
                ["p_company_id"]  = companyId.ToString(),
                ["p_hr_user_id"]  = hrUserId.ToString(),
                ["p_quote_id"]    = quoteId.ToString(),
                ["p_hr_notes"]    = hrNotes ?? (object)null!,
            });
    }

    public async Task HrRejectContractorQuoteAsync(
        Guid companyId, Guid hrUserId, Guid quoteId, string rejectionReason)
    {
        await _supabase.Rpc("hr_reject_contractor_quote",
            new Dictionary<string, object>
            {
                ["p_company_id"]       = companyId.ToString(),
                ["p_hr_user_id"]       = hrUserId.ToString(),
                ["p_quote_id"]         = quoteId.ToString(),
                ["p_rejection_reason"] = rejectionReason,
            });
    }

    public async Task HrRequestQuoteRevisionAsync(
        Guid companyId, Guid hrUserId, Guid quoteId, string revisionComments)
    {
        await _supabase.Rpc("hr_request_quote_revision",
            new Dictionary<string, object>
            {
                ["p_company_id"]         = companyId.ToString(),
                ["p_hr_user_id"]         = hrUserId.ToString(),
                ["p_quote_id"]           = quoteId.ToString(),
                ["p_revision_comments"]  = revisionComments,
            });
    }

    // ─── JSON parsers ─────────────────────────────────────────────────────────

    private static List<ContractorQuote> ParseQuoteList(string? content)
    {
        if (string.IsNullOrWhiteSpace(content) || content is "null" or "[]") return [];
        try
        {
            using var doc = JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
            return doc.RootElement.EnumerateArray().Select(ParseQuoteSummary).ToList();
        }
        catch { return []; }
    }

    private static ContractorQuote ParseQuoteSummary(JsonElement el)
    {
        DateOnly.TryParse(QStr(el, "quote_date"),  out var qDate);
        DateOnly.TryParse(QStr(el, "valid_until"), out var vUntil);
        DateTime.TryParse(QStr(el, "submitted_at"), out var sub);
        DateTime.TryParse(QStr(el, "created_at"),   out var cre);
        DateTime.TryParse(QStr(el, "updated_at"),   out var upd);

        DateTime.TryParse(QStr(el, "reviewed_at"),   out var rev);
        DateTime.TryParse(QStr(el, "converted_at"),  out var conv);
        Guid.TryParse(QStr(el, "converted_to_job_id"), out var convJobId);

        return new ContractorQuote
        {
            Id                  = Guid.TryParse(QStr(el,"id"), out var g) ? g : Guid.Empty,
            QuoteNumber         = QStr(el, "quote_number"),
            Title               = QStr(el, "title") ?? "",
            Description         = QStr(el, "description"),
            SourceMode          = QStr(el, "source_mode") ?? "manual",
            VatMode             = QStr(el, "vat_mode") ?? "exclusive",
            VatRate             = QDec(el, "vat_rate", 0.15m),
            Subtotal            = QDec(el, "subtotal"),
            DiscountAmount      = QDec(el, "discount_amount"),
            FreightAmount       = QDec(el, "freight_amount"),
            DutyAmount          = QDec(el, "duty_amount"),
            LeviesAmount        = QDec(el, "levies_amount"),
            OtherChargesAmount  = QDec(el, "other_charges_amount"),
            TaxableAmount       = QDec(el, "taxable_amount"),
            VatAmount           = QDec(el, "vat_amount"),
            TotalAmount         = QDec(el, "total_amount"),
            QuoteDate           = qDate,
            ValidUntil          = QStr(el, "valid_until") != null ? vUntil : null,
            Status              = QStr(el, "status") ?? "draft",
            ContractorNotes     = QStr(el, "contractor_notes"),
            RevisionComments    = QStr(el, "revision_comments"),
            RejectionReason     = QStr(el, "rejection_reason"),
            SubmittedAt         = QStr(el, "submitted_at")        != null ? sub      : null,
            ReviewedAt          = QStr(el, "reviewed_at")         != null ? rev      : null,
            ConvertedAt         = QStr(el, "converted_at")        != null ? conv     : null,
            ConvertedToJobId    = QStr(el, "converted_to_job_id") != null ? convJobId : null,
            CreatedAt           = cre,
            UpdatedAt           = upd,
        };
    }

    private static ContractorQuote ParseQuoteDetail(
        JsonElement el, Guid contractorId, Guid companyId)
    {
        var quote = ParseQuoteSummary(el);
        quote.ContractorId    = contractorId;
        quote.CompanyId       = companyId;
        quote.Terms           = QStr(el, "terms");
        quote.SenderName      = QStr(el, "sender_name");
        quote.SenderRegNumber = QStr(el, "sender_reg_number");
        quote.SenderVatNumber = QStr(el, "sender_vat_number");

        if (el.TryGetProperty("items", out var itemsEl) && itemsEl.ValueKind == JsonValueKind.Array)
        {
            quote.Items = itemsEl.EnumerateArray().Select(i => new ContractorQuoteItem
            {
                Id             = Guid.TryParse(QStr(i,"id"), out var ig) ? ig : Guid.Empty,
                QuoteId        = quote.Id,
                Description    = QStr(i, "description") ?? "",
                Quantity       = QDec(i, "quantity",    1),
                UnitPrice      = QDec(i, "unit_price"),
                DiscountAmount = QDec(i, "discount_amount"),
                Subtotal       = QDec(i, "subtotal"),
                LineTotal      = QDec(i, "line_total"),
                LineNo         = i.TryGetProperty("line_no", out var ln) && ln.TryGetInt32(out var lv) ? lv : 0,
            }).ToList();
        }

        if (el.TryGetProperty("attachments", out var attsEl) && attsEl.ValueKind == JsonValueKind.Array)
        {
            quote.Attachments = attsEl.EnumerateArray().Select(a => new ContractorQuoteAttachment
            {
                Id          = Guid.TryParse(QStr(a,"id"), out var ag) ? ag : Guid.Empty,
                QuoteId     = quote.Id,
                FileName    = QStr(a, "file_name") ?? "",
                FileUrl     = QStr(a, "file_url")  ?? "",
                StoragePath = QStr(a, "storage_path"),
                IsPrimary   = a.TryGetProperty("is_primary", out var p) && p.ValueKind == JsonValueKind.True,
                UploadedBy  = QStr(a, "uploaded_by") ?? "contractor_portal",
            }).ToList();
        }

        return quote;
    }

    private static string? QStr(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static decimal QDec(JsonElement e, string name, decimal def = 0m)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
           && v.TryGetDecimal(out var d) ? d : def;
}
