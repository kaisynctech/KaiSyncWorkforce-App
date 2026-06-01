using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Models.Platform;
using KaiFlow.Timesheets.Models.Production;

namespace KaiFlow.Timesheets.Services;

public interface IStorageService
{
    // Auth
    Task InitializeSessionAsync();
    Task<Employee?> SignInAsync(string email, string password);
    Task<Employee?> SignInWithOtpAsync(string email, string otp);
    Task SendOtpAsync(string email);
    Task SignOutAsync();
    Task<Employee?> GetCurrentEmployeeAsync();
    Task<Employee?> GetEmployeeByCodeAsync(string companyCode, string employeeCode);
    Task<CodeLoginResult?> SignInWithCodeAsync(string companyCode, string employeeCode);
    Task<CodeLoginResult?> RefreshCodeSessionAsync();
    Task<bool> ValidateCodeSessionAsync(Guid companyId, Guid employeeId, string sessionToken);
    Task<Company?> GetCurrentCompanyAsync(Guid companyId);
    Task SendPasswordResetEmailAsync(string email);
    Task ChangePasswordAsync(string newPassword);
    Task TransferOwnershipAsync(Guid companyId, Guid targetEmployeeId);
    // Returns true = OTP sent (new user), false = already authenticated (existing account, correct password)
    Task<bool> SendHrRegistrationOtpAsync(string email, string password);
    Task VerifyHrRegistrationOtpAsync(string email, string otp);
    Task SetPasswordAsync(string password);
    Task<bool> IsAuthenticatedAsync();
    Task<string?> GetCurrentUserEmailAsync();
    Task<bool> HasCompanyAsync();
    Task<(Guid companyId, string companyCode)> SelfRegisterCompanyAsync(string companyName, string ownerFirstName, string ownerLastName, string role = "owner");
    Task<List<Company>> GetUserCompaniesAsync();
    Task<List<EmployeeMembership>> GetMyMembershipsAsync();
    Task<List<AppNotification>> GetMyNotificationsAsync(Guid? employeeId = null);
    Task MarkNotificationReadAsync(long notificationId, Guid? employeeId = null);
    Task<Employee?> GetEmployeeForCompanyAsync(Guid companyId);
    Task EnsureOwnerAccessLevelAsync(Employee employee, Company company);
    Task<Dictionary<string, bool>> GetMyPermissionsAsync(Guid companyId);

    // Employees
    Task<List<Employee>> GetEmployeesAsync(Guid companyId, Guid? forEmployeeId = null);
    Task<Employee?> GetEmployeeAsync(Guid employeeId);
    Task<Employee> CreateEmployeeAsync(Employee employee);
    Task<Employee> UpdateEmployeeAsync(Employee employee);
    Task DeleteEmployeeAsync(Guid employeeId);
    Task<SelfRegisterResult> EmployeeSelfRegisterAsync(string email, string firstName, string lastName, string companyCode);
    Task<Employee?> UpdateMyProfileAsync(Guid employeeId, Guid companyId, string? firstName, string? lastName, string? phone, string? idNumber, string? bankAccount, string? bankName, string? bankBranchCode);
    Task<List<Employee>> GetPendingEmployeesAsync(Guid companyId);
    Task<Employee> ApproveEmployeeAsync(Guid employeeId);
    Task RejectEmployeeAsync(Guid employeeId);

    // Punches / Attendance
    Task<List<TimePunch>> GetPunchesAsync(Guid companyId, DateOnly from, DateOnly to, Guid? employeeId = null);
    Task<TimePunch?> GetLastPunchAsync(Guid employeeId);
    Task<TimePunch> InsertPunchAsync(TimePunch punch);
    Task<TimePunch?> GetMyLastPunchAsync(Guid employeeId);
    Task<List<TimePunch>> GetEmployeesLastPunchAsync(Guid companyId, List<Guid> employeeIds);
    Task<List<TimePunch>> InsertTeamPunchAsync(List<Guid> employeeIds, Guid companyId, bool clockIn, double? lat, double? lng, string? address, Guid? punchedByManagerId, Guid? managerEmployeeId = null);
    Task<List<TimePunch>> GetMyPunchesAsync(Guid companyId, Guid employeeId, DateOnly from, DateOnly to);
    Task UpdatePunchAddressAsync(Guid punchId, string address, Guid? companyId = null, Guid? employeeId = null);
    Task<bool> IsOnLeaveTodayAsync(Guid companyId, Guid employeeId);

    // Jobs
    Task<List<Job>> GetJobsAsync(Guid companyId, Guid? employeeId = null);
    Task EnsureEmployeeCompanyRelationshipAsync(Employee employee);
    Task<Job?> GetJobAsync(Guid jobId, Guid? companyId = null, Guid? employeeId = null);
    Task<Job> CreateJobAsync(Job job);
    Task<Job> EmployeeCreateJobAsync(EmployeeCreateJobRequest request);
    Task<Job> UpdateJobAsync(Job job);
    Task DeleteJobAsync(Guid jobId);

    // Job Cards
    Task<JobCard?> GetJobCardAsync(Guid jobId, Guid? employeeId = null, Guid? companyId = null);
    Task<JobCard> SaveJobCardAsync(JobCard card, Guid? actingEmployeeId = null);

    // Checklist
    Task<List<JobChecklistItem>> GetChecklistItemsAsync(Guid jobId, Guid? employeeId = null, Guid? companyId = null);
    Task SaveChecklistItemsAsync(List<JobChecklistItem> items, Guid? employeeId = null);

    // Shift Templates
    Task<List<EmployeeShiftTemplate>> GetShiftTemplatesAsync(Guid companyId);
    Task<EmployeeShiftTemplate> CreateShiftTemplateAsync(EmployeeShiftTemplate template);
    Task<EmployeeShiftTemplate> UpdateShiftTemplateAsync(EmployeeShiftTemplate template);
    Task DeleteShiftTemplateAsync(Guid templateId, Guid companyId);
    Task<EmployeeShiftTemplate> SetDefaultShiftTemplateAsync(Guid companyId, Guid templateId);

    // Companies
    Task<Company> CreateCompanyAsync(Company company);
    Task<Company> UpdateCompanyAsync(Company company);

    // Clients
    Task<List<Client>> GetClientsAsync(Guid companyId);
    Task<Client?> GetClientAsync(Guid clientId);
    Task<Client> CreateClientAsync(Client client);
    Task<string> GenerateNextClientCodeAsync(Guid companyId);
    Task<string> GenerateNextProjectCodeAsync(Guid companyId);
    Task<string> GenerateNextJobCodeAsync(Guid companyId);
    Task<ClientPortalLogin?> ResolveClientByCodeAsync(string companyCode, string clientCode);
    Task<List<ClientDeal>> GetClientPortalProjectsAsync(string companyCode, string clientCode);
    Task<List<ClientPortalMessageInboxItem>> GetClientPortalMessageInboxAsync(string companyCode, string clientCode);
    Task<ClientDeal?> GetClientPortalProjectAsync(string companyCode, string clientCode, Guid dealId);
    Task<Guid> ClientPortalAddDocumentLinkAsync(string companyCode, string clientCode, Guid dealId, string documentName, string fileUrl);
    Task<Guid> ClientPortalRegisterDocumentAsync(string companyCode, string clientCode, Guid dealId, string documentName, string fileUrl);
    Task<ProjectDocument> ClientPortalUploadDocumentAsync(string companyCode, string clientCode, Guid dealId, Guid companyId, FileResult file, string documentName);
    Task<AppMessage> ClientPortalSendMessageAsync(string companyCode, string clientCode, Guid dealId, string body);
    Task<MessageThread> GetOrCreateClientDealThreadAsync(Guid companyId, Guid dealId);
    Task<Client> UpdateClientAsync(Client client);
    Task DeleteClientAsync(Guid clientId);

    // Client projects (client_deals)
    Task<List<ClientDeal>> GetClientDealsAsync(Guid companyId, Guid? clientId = null);
    Task<ClientDeal?> GetClientDealAsync(Guid dealId);
    Task<ClientDeal> CreateClientDealAsync(ClientDeal deal);
    Task<ClientDeal> UpdateClientDealAsync(ClientDeal deal);
    Task DeleteClientDealAsync(Guid dealId);
    Task LinkClientDealToJobAsync(Guid dealId, Guid jobId);
    Task<List<Job>> GetJobsByDealIdAsync(Guid dealId);
    Task<List<ClientDealUpdate>> GetClientDealUpdatesAsync(Guid dealId);
    Task<ClientDealUpdate> AddClientDealUpdateAsync(ClientDealUpdate update);
    Task<List<ProjectDocument>> GetProjectDocumentsAsync(Guid dealId);
    Task<ProjectDocument> UploadProjectDocumentAsync(Guid companyId, Guid dealId, FileResult file, string documentType, string documentName);
    Task DeleteProjectDocumentAsync(ProjectDocument document);
    Task<List<ProjectQuotationLine>> GetProjectQuotationLinesAsync(Guid dealId);
    Task<ProjectQuotationLine> AddProjectQuotationLineAsync(ProjectQuotationLine line);
    Task DeleteProjectQuotationLineAsync(Guid lineId);
    Task<List<ProjectClientPayment>> GetProjectClientPaymentsAsync(Guid dealId);
    Task<ProjectClientPayment> AddProjectClientPaymentAsync(ProjectClientPayment payment);
    Task<ProjectClientPayment> UpdateProjectClientPaymentAsync(ProjectClientPayment payment);
    Task<ProjectClientPayment> AttachPaymentReceiptAsync(Guid companyId, ProjectClientPayment payment, FileResult file);
    Task<List<ClientDealMessage>> GetClientDealMessagesAsync(Guid dealId);
    Task<ClientDealMessage> AddClientDealMessageAsync(ClientDealMessage message);
    Task<ClientDeal> SyncClientDealFinancialsAsync(Guid dealId);

    // ─── Finance module (Phase 4): client invoices ──────────────────────────
    Task<List<FinanceInvoice>> GetFinanceInvoicesAsync(Guid companyId, string? status = null, Guid? clientId = null);
        Task<FinanceReport> BuildFinanceReportAsync(Guid companyId, string reportKey, DateOnly start, DateOnly end);

        // ─── Finance module (Phase 8): approvals & audit ────────────────────────
        Task<List<FinanceAuditEntry>> GetFinanceAuditAsync(Guid companyId, int limit = 100);
        Task<SupplierInvoice> ApproveSupplierInvoiceAsync(Guid invoiceId, Guid? actorId, string? actorName);
        Task<SupplierInvoice> RejectSupplierInvoiceAsync(Guid invoiceId, Guid? actorId, string? actorName, string? note);
        Task<SupplierInvoice> MarkSupplierInvoicePaidAsync(Guid invoiceId, decimal amount, string? method, Guid? actorId, string? actorName);
        Task<ContractorPayout> ApproveContractorPayoutAsync(Guid payoutId, Guid? actorId, string? actorName);
        Task<ContractorPayout> RejectContractorPayoutAsync(Guid payoutId, Guid? actorId, string? actorName, string? note);
        Task<ContractorPayout> MarkContractorPayoutPaidAsync(Guid payoutId, string? method, Guid? actorId, string? actorName);
        Task IssueRefundAsync(Guid companyId, Guid? sourceInvoiceId, decimal amount, string? reference, string? note, Guid? actorId, string? actorName);

        // ─── Finance module (Phase 3): portal read RPCs ─────────────────────────
        Task<List<FinanceInvoice>> GetClientPortalInvoicesAsync(string companyCode, string clientCode);
        Task<List<ContractorPayout>> GetContractorPortalPayoutsAsync(string companyCode, string contractorCode);
        Task<FinanceInvoice?> GetFinanceInvoiceAsync(Guid invoiceId);
    Task<FinanceInvoice> CreateFinanceInvoiceAsync(FinanceInvoice invoice);
    Task<FinanceInvoice> UpdateFinanceInvoiceAsync(FinanceInvoice invoice);
    Task DeleteFinanceInvoiceAsync(Guid invoiceId);
    Task<List<FinanceInvoiceLine>> GetFinanceInvoiceLinesAsync(Guid invoiceId);
    Task<FinanceInvoiceLine> AddFinanceInvoiceLineAsync(FinanceInvoiceLine line);
    Task DeleteFinanceInvoiceLineAsync(Guid lineId);
    /// <summary>Recompute and persist an invoice's totals/balance/status from its lines and payments.</summary>
    Task<FinanceInvoice> SyncFinanceInvoiceTotalsAsync(Guid invoiceId);
    Task<FinanceInvoice> RecordInvoicePaymentAsync(Guid invoiceId, decimal amount, string? method = null, string? reference = null);
    Task<string> GenerateNextInvoiceNumberAsync(Guid companyId);

    // ─── Finance module: supplier invoices (payables) ───────────────────────
    Task<List<SupplierInvoice>> GetSupplierInvoicesAsync(Guid companyId, string? status = null, Guid? supplierId = null);
    Task<SupplierInvoice> CreateSupplierInvoiceAsync(SupplierInvoice invoice);
    Task<SupplierInvoice> UpdateSupplierInvoiceAsync(SupplierInvoice invoice);
    Task DeleteSupplierInvoiceAsync(Guid invoiceId);

    // ─── Finance module: contractor payouts ─────────────────────────────────
    Task<List<ContractorPayout>> GetContractorPayoutsAsync(Guid companyId, string? payoutStatus = null, Guid? contractorId = null);
    Task<ContractorPayout> CreateContractorPayoutAsync(ContractorPayout payout);
    Task<ContractorPayout> UpdateContractorPayoutAsync(ContractorPayout payout);
    Task DeleteContractorPayoutAsync(Guid payoutId);

    // ─── Finance module: universal ledger & VAT ─────────────────────────────
    Task<List<FinanceTransaction>> GetFinanceTransactionsAsync(Guid companyId, DateOnly? from = null, DateOnly? to = null, string? direction = null);
    Task<FinanceTransaction> AddFinanceTransactionAsync(FinanceTransaction transaction);
    Task<List<FinanceVatPeriod>> GetVatPeriodsAsync(Guid companyId);
    Task<FinanceVatPeriod> UpsertVatPeriodAsync(FinanceVatPeriod period);
    /// <summary>Aggregate finance KPIs for the dashboard within a date window.</summary>
    Task<FinanceDashboardSnapshot> GetFinanceDashboardSnapshotAsync(Guid companyId, DateOnly periodStart, DateOnly periodEnd);

    Task<List<JobDocument>> GetJobDocumentsAsync(Guid jobId, Guid? companyId = null, Guid? employeeId = null);
    Task<JobDocument> UploadJobDocumentAsync(Guid companyId, Guid jobId, FileResult file, string documentType, string documentName, Guid? employeeId = null);
    Task DeleteJobDocumentAsync(JobDocument document);
    Task<JobChecklistItem> CreateChecklistItemForJobAsync(Guid companyId, Guid employeeId, Guid jobId, string description);
    Task<string> UploadJobPhotoAsync(Guid companyId, Guid jobId, FileResult file, string phase);
    Task AppendJobPhotoAsync(Guid companyId, Guid jobId, string phase, string photoUrl, Guid? employeeId = null);
    Task<(List<string> Before, List<string> After)> GetJobPhotoUrlsAsync(Guid jobId, Guid? companyId = null, Guid? employeeId = null);
    Task<JobChecklistItem> SaveChecklistItemAsync(JobChecklistItem item, Guid? employeeId = null);

    // Sites
    Task<List<Site>> GetSitesAsync(Guid companyId, Guid? clientId = null);
    Task<Site> CreateSiteAsync(Site site);
    Task<Site> UpdateSiteAsync(Site site);

    // Units
    Task<List<Unit>> GetUnitsAsync(Guid siteId);
    Task<Unit> CreateUnitAsync(Unit unit);
    Task<Unit> UpdateUnitAsync(Unit unit);

    // Residents
    Task<List<Resident>> GetResidentsAsync(Guid siteId);
    Task<Resident> CreateResidentAsync(Resident resident);
    Task<Resident> UpdateResidentAsync(Resident resident);

    // Assets
    Task<List<Asset>> GetAssetsAsync(Guid companyId, Guid? siteId = null);
    Task<Asset> CreateAssetAsync(Asset asset);
    Task<Asset> UpdateAssetAsync(Asset asset);

    // Leave
    Task<List<LeaveRequest>> GetLeaveRequestsAsync(Guid companyId, Guid? employeeId = null);
    Task<List<LeaveRequest>> GetMyLeaveRequestsAsync(Guid companyId, Guid employeeId);
    Task<LeaveRequest> CreateLeaveRequestAsync(LeaveRequest request);
    Task<LeaveRequest> UpdateLeaveStatusAsync(Guid requestId, string status, string? decisionNote = null);
    Task<LeaveRequest> UpdatePendingLeaveAsync(LeaveRequest request);
    Task<string?> UploadLeaveAttachmentAsync(Guid employeeId, string localFilePath);

    // Employee Documents
    Task<List<EmployeeDocument>> GetEmployeeDocumentsAsync(Guid companyId, Guid employeeId);
    Task<List<EmployeeDocument>> GetMyDocumentsAsync(Guid companyId, Guid employeeId);
    Task<EmployeeDocument> UploadEmployeeDocumentAsync(Guid companyId, Guid employeeId, FileResult file, string documentType, string documentName, string uploadedByRole = "hr");
    Task<EmployeeDocument> ReplaceEmployeeDocumentAsync(EmployeeDocument existing, FileResult file, string documentType, string documentName, string uploadedByRole);
    Task DeleteEmployeeDocumentAsync(EmployeeDocument document);

    // Daily Absences
    Task<List<DailyAbsence>> GetDailyAbsencesAsync(Guid companyId, DateOnly date, Guid? employeeId = null);
    Task<List<DailyAbsence>> GetDailyAbsencesRangeAsync(Guid companyId, DateOnly from, DateOnly to, Guid? employeeId = null);
    Task<DailyAbsence> ReportAbsenceAsync(DailyAbsence absence);

    // Labor
    Task<List<LaborEntry>> GetLaborEntriesAsync(Guid companyId, DateOnly from, DateOnly to, Guid? employeeId = null, Guid? jobId = null);
    Task<LaborEntry> CreateLaborEntryAsync(LaborEntry entry);
    Task DeleteLaborEntryAsync(Guid entryId);

    // Incidents
    Task<List<IncidentReport>> GetIncidentsAsync(Guid companyId, Guid? employeeId = null, Guid? jobId = null, bool includeClosed = true);
    Task<IncidentReport?> GetIncidentAsync(Guid incidentId, Guid? companyId = null, Guid? employeeId = null);
    Task<IncidentReport> CreateIncidentAsync(IncidentReport incident, IReadOnlyList<string>? localPhotoPaths = null);
    Task<IncidentReport> UpdateIncidentAsync(IncidentReport incident, Guid? actingEmployeeId = null);
    Task<List<IncidentComment>> GetIncidentCommentsAsync(Guid companyId, Guid employeeId, Guid incidentId);
    Task<IncidentComment> AddIncidentCommentAsync(Guid companyId, Guid employeeId, Guid incidentId, string body);
    Task<List<IncidentStatusHistory>> GetIncidentStatusHistoryAsync(Guid companyId, Guid employeeId, Guid incidentId);
    Task<string?> UploadIncidentPhotoAsync(Guid companyId, Guid employeeId, string localFilePath);
    Task<JobFeedback> SubmitJobFeedbackAsync(Guid companyId, Guid employeeId, Guid jobId, int rating, string? comments = null);
    Task<List<JobFeedback>> GetJobFeedbackAsync(Guid companyId, Guid employeeId, Guid jobId);

    // Inventory
    Task<List<InventoryItem>> GetInventoryItemsAsync(Guid companyId);
    Task<InventoryItem?> GetInventoryItemAsync(Guid itemId);
    Task<InventoryItem> CreateInventoryItemAsync(InventoryItem item);
    Task<InventoryItem> UpdateInventoryItemAsync(InventoryItem item);
    Task<List<InventoryUsage>> GetInventoryUsageAsync(Guid companyId, Guid? jobId = null);
    Task<InventoryUsage> CreateInventoryUsageAsync(InventoryUsage usage);
    Task<InventoryItem?> AllocateInventoryToJobAsync(Guid companyId, Guid jobId, Guid employeeId, Guid inventoryItemId, double quantity, double unitCost);

    // Contractors
    Task<List<Contractor>> GetContractorsAsync(Guid companyId);
    Task<List<Contractor>> GetLinkedContractorsForEmployeeAsync(Guid companyId, Guid employeeId);
    Task<Contractor> CreateContractorAsync(Contractor contractor);
    Task<Contractor> UpdateContractorAsync(Contractor contractor);
    Task<List<ContractorMemberLink>> GetContractorMemberLinksAsync(Guid contractorId);
    Task<ContractorMemberLink> CreateContractorMemberLinkAsync(ContractorMemberLink link);
    Task<string> GenerateNextContractorCodeAsync(Guid companyId);
    Task<ContractorPortalLogin?> ResolveContractorByCodeAsync(string companyCode, string contractorCode);

    // Job site visits
    Task<List<JobSiteVisit>> GetJobSiteVisitsAsync(Guid jobId);
    Task<JobSiteVisit?> EmployeeJobSiteOpenVisitAsync(Guid companyId, Guid employeeId);
    Task<JobSiteVisit> EmployeeJobSiteSignInAsync(Guid companyId, Guid employeeId, Guid jobId, double? lat, double? lng, string? address, string? reportedByName = null, string? notes = null);
    Task<JobSiteVisit> EmployeeJobSiteSignOutAsync(Guid companyId, Guid employeeId, Guid jobId, double? lat, double? lng, string? address, string? notes = null);
    Task<JobSiteVisit?> EmployeeJobSiteSignOutOpenVisitAsync(Guid companyId, Guid employeeId, string? notes = null);
    Task<JobSiteVisit> EmployeeJobSiteSwitchToJobAsync(Guid companyId, Guid employeeId, Guid jobId, double? lat, double? lng, string? address, string? reportedByName = null, string? notes = null);

    // Contractor portal
    Task<List<Job>> GetContractorPortalJobsAsync(string companyCode, string contractorCode);
    Task<JobSiteVisit?> ContractorPortalOpenVisitAsync(string companyCode, string contractorCode);
    Task<JobSiteVisit> ContractorPortalSignInAsync(string companyCode, string contractorCode, Guid jobId, double? lat, double? lng, string? address, string? reportedByName = null, string? notes = null);
    Task<JobSiteVisit> ContractorPortalSignOutAsync(string companyCode, string contractorCode, Guid jobId, double? lat, double? lng, string? address, string? notes = null);
    Task<List<JobSiteVisit>> ContractorPortalVisitHistoryAsync(string companyCode, string contractorCode, Guid? jobId = null);
    Task<IncidentReport> ContractorPortalCreateIncidentAsync(string companyCode, string contractorCode, Guid jobId, string description, string severity = "low", string? reportedByName = null);
    Task ContractorPortalAppendJobPhotoAsync(string companyCode, string contractorCode, Guid jobId, string phase, string photoUrl);
    Task<List<AppMessage>> ContractorPortalGetJobMessagesAsync(string companyCode, string contractorCode, Guid jobId);
    Task<AppMessage> ContractorPortalSendJobMessageAsync(string companyCode, string contractorCode, Guid jobId, string body, string? senderName = null);
    Task<string> UploadContractorPortalJobPhotoAsync(Guid companyId, Guid jobId, FileResult file, string phase);

    // Work Teams
    Task<List<WorkTeam>> GetWorkTeamsAsync(Guid companyId, Guid? forEmployeeId = null);
    Task<WorkTeam> CreateWorkTeamAsync(WorkTeam team);
    Task<WorkTeam> UpdateWorkTeamAsync(WorkTeam team);

    // Messages
    Task<List<MessageThread>> GetMessageThreadsAsync(Guid companyId, Guid userId);
    Task<List<AppMessage>> GetMessagesAsync(Guid threadId, Guid? companyId = null, Guid? employeeId = null, bool isCompanyFeed = false);
    Task<AppMessage> SendMessageAsync(AppMessage message, bool isCompanyFeed = false);
    Task<MessageThread> CreateThreadAsync(MessageThread thread);
    Task<MessageThread> GetOrCreateJobThreadAsync(Guid companyId, Guid jobId, Guid employeeId);

    // Payments
    Task<List<PaymentApproval>> GetPaymentsAsync(Guid companyId);
    Task<PaymentApproval> CreatePaymentApprovalAsync(PaymentApproval payment);
    Task<PaymentApproval> UpdatePaymentStatusAsync(Guid paymentId, string status);
    Task<PaymentApproval> UpdatePaymentAsync(PaymentApproval payment);
    Task SharePayslipWithEmployeeAsync(Guid paymentId);
    Task<List<PaymentApproval>> GetMyPayslipsAsync(Guid companyId, Guid employeeId);

    Task<List<PayrollPeriodLock>> GetPayrollPeriodLocksAsync(Guid companyId);
    Task LockPayrollPeriodAsync(PayrollPeriodLock periodLock);
    Task<List<EmployeeSalaryHistory>> GetEmployeeSalaryHistoryAsync(Guid companyId, Guid? employeeId = null);
    Task<EmployeeSalaryHistory> AddEmployeeSalaryHistoryAsync(EmployeeSalaryHistory entry);

    // PA Tasks
    Task<int> SyncOperationalPaTasksAsync(Guid companyId, Guid? scopeEmployeeId = null);
    Task<List<PaTask>> GetPaTasksAsync(Guid companyId, Guid? employeeId = null);
    Task<List<MyPaLinkOption>> GetPaLinkOptionsAsync(Guid companyId, string linkedType);
    Task<List<MyPaCalendarEntry>> GetMyPaCalendarEntriesAsync(Guid companyId, Guid? employeeId = null);
    Task<PaTask> CreatePaTaskAsync(PaTask task);
    Task<PaTask> EmployeeCreatePaTaskAsync(PaTask draft, Guid employeeId);
    Task<PaTask> UpdatePaTaskAsync(PaTask task, Guid? actingEmployeeId = null);
    Task UpdatePaTaskStatusAsync(PaTask task, string status, Guid? actingEmployeeId = null);
    Task DeletePaTaskAsync(Guid companyId, Guid taskId, Guid? actingEmployeeId = null);
    Task EnqueuePaTaskNotificationsAsync(Guid companyId);
    Task NotifyManagerJobCreatedAsync(Guid companyId, Guid managerUserId, Guid jobId, Guid employeeId, string jobTitle);
    Task<List<PaTaskTemplate>> GetPaTaskTemplatesAsync(Guid companyId);
    Task<EmployeePaSettings> GetEmployeePaSettingsAsync(Guid employeeId, Guid companyId);
    Task SaveEmployeePaSettingsAsync(EmployeePaSettings settings);
    Task<List<EmployeeCalendarConnection>> GetCalendarConnectionsAsync(Guid employeeId);
    Task<List<ExternalCalendarEvent>> GetExternalCalendarEventsAsync(Guid employeeId, DateTime from, DateTime to);
    Task<List<MyPaCalendarEntry>> GetMyPaCalendarEntriesMergedAsync(Guid companyId, Guid? employeeId = null);
    Task NotifyPaTaskDelegatedAsync(Guid companyId, Guid assigneeEmployeeId, string taskTitle, Guid delegatedByEmployeeId);

    // Compliance
    Task<List<ComplianceEntry>> GetComplianceEntriesAsync(Guid companyId, Guid? siteId = null);
    Task<ComplianceEntry> CreateComplianceEntryAsync(ComplianceEntry entry);
    Task<ComplianceEntry> UpdateComplianceEntryAsync(ComplianceEntry entry);

    // Workflow Forms
    Task<List<WorkflowFormTemplate>> GetFormTemplatesAsync(Guid companyId);
    Task<List<WorkflowFormSubmission>> GetFormSubmissionsAsync(Guid companyId, Guid? templateId = null);
    Task<WorkflowFormSubmission> SubmitFormAsync(WorkflowFormSubmission submission);

    // Job Codes
    Task<List<JobCode>> GetJobCodesAsync(Guid companyId);

    // Calendar Events
    Task<List<CalendarEvent>> GetCalendarEventsAsync(Guid companyId, DateOnly from, DateOnly to, Guid? employeeId = null);
    Task<CalendarEvent> CreateCalendarEventAsync(CalendarEvent calendarEvent);
    Task<CalendarEvent> UpdateCalendarEventAsync(CalendarEvent calendarEvent);
    Task UpdateCalendarEventAttendanceAsync(Guid companyId, Guid employeeId, Guid eventId, string response);

    // Branches
    Task<List<Branch>> GetBranchesAsync(Guid companyId);
    Task<Branch> CreateBranchAsync(Branch branch);
    Task<Branch> UpdateBranchAsync(Branch branch);
    Task DeleteBranchAsync(Guid branchId);

    // Company feed
    Task<MessageThread> GetOrCreateCompanyFeedAsync(Guid companyId, Guid? employeeId = null);

    // Telemetry / analytics
    Task<List<AppEvent>> GetAppEventsAsync(Guid companyId, DateTime from, DateTime to, int limit = 3000);

    // ─── SaaS platform ────────────────────────────────────────────────────────
    Task<bool> IsPlatformAdminAsync();
    Task<SaasSubscriptionSummary?> GetSaasSubscriptionAsync(Guid companyId);
    Task<List<SaasCompanyFeature>> GetSaasCompanyFeaturesAsync(Guid companyId);
    Task<List<SaasPlan>> GetSaasPlansAsync();
    Task<List<PlatformCompanySummary>> PlatformListCompaniesAsync(int limit = 100, int offset = 0);
    Task PlatformSetSubscriptionStatusAsync(Guid companyId, string status, string? note = null);
    Task PlatformSetCompanyFeatureAsync(Guid companyId, string featureCode, bool enabled, DateTime? expiresAt = null, string? reason = null);
    Task UpsertSaasUsageSnapshotAsync(Guid companyId, DateOnly periodMonth, Dictionary<string, double> metrics);
    Task<SaasUsageSnapshot?> GetSaasUsageSnapshotAsync(Guid companyId, DateOnly periodMonth);
    Task<List<SaasOnboardingProgress>> GetSaasOnboardingProgressAsync(Guid companyId);
    Task UpsertSaasOnboardingStepAsync(Guid companyId, string stepKey, bool completed);
    Task<List<SaasPlatformAuditEntry>> GetPlatformAuditLogAsync(int limit = 50);
    Task<List<SaasSupportNote>> GetSaasSupportNotesAsync(Guid companyId);
    Task AddSaasSupportNoteAsync(Guid companyId, string note, string severity);
    Task<List<SaasReleaseRollout>> GetSaasReleaseRolloutsAsync();
    Task UpsertCompanyAppVersionAsync(Guid companyId, string appVersion, string? platform);
    Task<PlatformKpiSnapshot> GetPlatformKpiSnapshotAsync();

    // ─── Platform SaaS admin ──────────────────────────────────────────────────
    Task<PlatformAdminDashboard> GetPlatformAdminDashboardAsync(CancellationToken ct = default);
    Task<List<PlatformCompanySummary>> PlatformSearchCompaniesAsync(string query, int limit = 100, int offset = 0, CancellationToken ct = default);
    Task<TenantHealthScore?> GetPlatformCustomerHealthAsync(Guid companyId, CancellationToken ct = default);
    Task<CompanySubscriptionBilling?> GetCompanySubscriptionBillingAsync(Guid companyId, CancellationToken ct = default);
    Task<CompanySubscriptionBilling?> PlatformRefreshCompanySubscriptionAsync(Guid companyId, CancellationToken ct = default);
    Task SubmitPlatformFeedbackAsync(Guid companyId, string category, string message, string priority, CancellationToken ct = default);
    Task<List<PlatformFeedback>> GetCompanyPlatformFeedbackAsync(Guid companyId, CancellationToken ct = default);
    Task<List<PlatformFeedback>> GetPlatformFeedbackAsync(string? status = null, CancellationToken ct = default);
    Task UpdatePlatformFeedbackStatusAsync(Guid feedbackId, string status, string? releaseVersion = null, string? adminNotes = null, CancellationToken ct = default);
    Task<PlatformFeedbackStats> GetPlatformFeedbackStatsAsync(CancellationToken ct = default);

    // ─── Production ops ───────────────────────────────────────────────────────
    Task<AppVersionInfo?> GetLatestAppVersionAsync(string platform, CancellationToken ct = default);
    Task<List<FeatureFlagRecord>> GetFeatureFlagsAsync(Guid companyId, CancellationToken ct = default);
    Task UpsertFeatureFlagAsync(Guid companyId, string featureName, bool enabled, CancellationToken ct = default);
    Task<CompanySettingsDto> GetCompanySettingsAsync(Guid companyId, CancellationToken ct = default);
    Task<CompanySettingsDto> UpsertCompanySettingsAsync(Guid companyId, CompanySettingsDto settings, CancellationToken ct = default);
    Task<CompanyBackupRecord> CreateCompanyBackupAsync(Guid companyId, string? label = null, CancellationToken ct = default);
    Task<List<CompanyBackupRecord>> GetCompanyBackupsAsync(Guid companyId, int limit = 20, CancellationToken ct = default);
    Task<List<BackupJobRecord>> GetBackupJobsAsync(Guid companyId, int limit = 20, CancellationToken ct = default);
    Task<BackupJobRecord> CreateScheduledBackupJobAsync(Guid companyId, string cronExpression, CancellationToken ct = default);
    Task LogApplicationErrorAsync(string? module, string? page, Exception ex, Guid? companyId = null, Guid? employeeId = null, Dictionary<string, string>? metadata = null, CancellationToken ct = default);
    Task<List<ApplicationErrorRecord>> GetApplicationErrorsAsync(Guid companyId, int limit = 50, CancellationToken ct = default);
}
