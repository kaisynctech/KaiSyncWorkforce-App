using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;
using KaiFlow.Timesheets.Helpers;

namespace KaiFlow.Timesheets.Models;

[Table("client_deals")]
public class ClientDeal : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("client_id")]
    public Guid? ClientId { get; set; }

    [JsonIgnore] public bool HasClient => ClientId.HasValue && ClientId.Value != Guid.Empty;

    [Column("manager_employee_id")]
    public Guid? ManagerEmployeeId { get; set; }

    [Column("quotation_notes")]
    public string? QuotationNotes { get; set; }

    [Column("quotation_valid_until")]
    public DateOnly? QuotationValidUntil { get; set; }

    [Column("quotation_sent_at")]
    public DateTime? QuotationSentAt { get; set; }

    [Column("project_code")]
    public string? ProjectCode { get; set; }

    [Column("title")]
    public string Title { get; set; } = "";

    [Column("status")]
    public string StatusRaw { get; set; } = "draft";

    [Column("offer_amount")]
    public double OfferAmount { get; set; }

    [Column("deposit_required")]
    public double DepositRequired { get; set; }

    [Column("amount_paid")]
    public double AmountPaid { get; set; }

    [Column("expected_close_date")]
    public DateOnly? ExpectedCloseDate { get; set; }

    [Column("site_start_date")]
    public DateOnly? SiteStartDate { get; set; }

    [Column("expected_completion_date")]
    public DateOnly? ExpectedCompletionDate { get; set; }

    [Column("next_visit_date")]
    public DateOnly? NextVisitDate { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("agreement_notes")]
    public string? AgreementNotes { get; set; }

    [Column("progress_percent")]
    public int ProgressPercent { get; set; }

    [Column("last_update_note")]
    public string? LastUpdateNote { get; set; }

    [Column("last_update_at")]
    public DateTime? LastUpdateAt { get; set; }

    [Column("job_id")]
    public Guid? JobId { get; set; }

    [Column("visibility")]
    public string VisibilityRaw { get; set; } = "all";

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }

    [JsonIgnore] public bool HasLinkedJob => JobId.HasValue;
    /// <summary>Populated when loading deals with job counts (not a DB column).</summary>
    [JsonIgnore] public int JobCount { get; set; }
    [JsonIgnore] public string JobCountLabel => JobCount switch
    {
        0 => "No jobs",
        1 => "1 job",
        _ => $"{JobCount} jobs"
    };
    [JsonIgnore] public string ProjectCodeDisplay => string.IsNullOrWhiteSpace(ProjectCode) ? "—" : ProjectCode!;

    // Set by ViewModels after loading the client list — not a DB column.
    [JsonIgnore] public string ClientName { get; set; } = "";

    [JsonIgnore] public string PickerDisplay
    {
        get
        {
            var code  = string.IsNullOrWhiteSpace(ProjectCode) ? null : ProjectCode;
            var client = string.IsNullOrWhiteSpace(ClientName) ? null : ClientName;
            return (code, client) switch
            {
                (not null, not null) => $"{code} — {Title} — {client}",
                (not null, null)     => $"{code} — {Title}",
                (null, not null)     => $"{Title} — {client}",
                _                    => Title,
            };
        }
    }
    [JsonIgnore] public string OfferDisplay => $"R{OfferAmount:N2}";
    [JsonIgnore] public string DepositDisplay => $"R{DepositRequired:N2}";
    [JsonIgnore] public string PaidDisplay => $"R{AmountPaid:N2}";
    [JsonIgnore] public string BalanceDisplay => $"R{Math.Max(0, OfferAmount - AmountPaid):N2}";
    [JsonIgnore] public string DepositOutstandingDisplay => $"R{Math.Max(0, DepositRequired - AmountPaid):N2}";
    [JsonIgnore] public string ProgressDisplay => $"{ProgressPercent}%";
    [JsonIgnore] public double ProgressFraction => Math.Clamp(ProgressPercent, 0, 100) / 100.0;
    [JsonIgnore] public string ExpectedCloseDisplay => PortalDateHelper.Format(ExpectedCloseDate);
    [JsonIgnore] public string SiteStartDisplay => PortalDateHelper.Format(SiteStartDate);
    [JsonIgnore] public string ExpectedCompletionDisplay => PortalDateHelper.Format(ExpectedCompletionDate);
    [JsonIgnore] public string NextVisitDisplay => PortalDateHelper.Format(NextVisitDate);
    [JsonIgnore] public bool ShowSiteStartDate => PortalDateHelper.IsSet(SiteStartDate);
    [JsonIgnore] public bool ShowExpectedCompletionDate => PortalDateHelper.IsSet(ExpectedCompletionDate);
    [JsonIgnore] public bool ShowNextVisitDate => PortalDateHelper.IsSet(NextVisitDate);
    [JsonIgnore] public bool ShowExpectedCloseDate => PortalDateHelper.IsSet(ExpectedCloseDate);
    [JsonIgnore] public bool HasMilestones =>
        ShowSiteStartDate || ShowExpectedCompletionDate || ShowNextVisitDate || ShowExpectedCloseDate;
    [JsonIgnore] public string LinkLabel => HasLinkedJob ? "Linked" : "—";
    [JsonIgnore] public string LastUpdateDisplay => PortalDateHelper.FormatDateTime(LastUpdateAt);
    [JsonIgnore] public string StatusLabel => ProjectPipeline.LabelFor(StatusRaw);
    [JsonIgnore] public List<ProjectQuotationLine> QuotationLines { get; set; } = [];
    [JsonIgnore] public double QuotationTotal => QuotationLines.Sum(l => l.LineTotal);
    [JsonIgnore] public string QuotationTotalDisplay => $"R{QuotationTotal:N2}";
    [JsonIgnore]
    public IReadOnlyList<ProjectQuotationLine> ClientQuotationLineItems =>
        QuotationLines.Where(l => !ProjectQuotationDisplay.IsSummaryLine(l.Description)).OrderBy(l => l.LineNo).ToList();
    [JsonIgnore]
    public string ClientQuotationTotalDisplay =>
        ProjectQuotationDisplay.ClientTotalDisplay(
            OfferAmount,
            QuotationLines.Select(l => (l.Description, l.LineTotal, l.LineNo)));
    [JsonIgnore] public bool HasQuotation =>
        ClientQuotationLineItems.Count > 0 || OfferAmount > 0 || !string.IsNullOrWhiteSpace(QuotationNotes);
    [JsonIgnore] public List<ProjectDocument> PortalDocuments { get; set; } = [];
    [JsonIgnore] public List<ClientDealUpdate> PortalActivity { get; set; } = [];
    [JsonIgnore] public List<ClientPortalPhotoItem> PortalPhotos { get; set; } = [];
    [JsonIgnore] public List<ClientDealMessage> PortalMessages { get; set; } = [];
    [JsonIgnore] public List<ProjectClientPayment> PortalPayments { get; set; } = [];
    [JsonIgnore] public string QuotationSentDisplay =>
        PortalDateHelper.IsSet(QuotationSentAt) ? PortalDateHelper.Format(QuotationSentAt) : "Not sent yet";
    [JsonIgnore] public string QuotationValidUntilDisplay => PortalDateHelper.Format(QuotationValidUntil);
    [JsonIgnore] public bool ShowQuotationValidUntil => PortalDateHelper.IsSet(QuotationValidUntil);

    public static IReadOnlyList<string> StatusOptions { get; } =
        ProjectPipeline.Stages.Select(s => s.Value).ToList();
}
