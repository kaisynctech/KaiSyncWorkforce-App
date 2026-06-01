using CommunityToolkit.Maui;
using KaiFlow.Timesheets.Constants;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Reporting;
using KaiFlow.Timesheets.Services.Platform;
using KaiFlow.Timesheets.Services.Production;
using KaiFlow.Timesheets.ViewModels.Auth;
using KaiFlow.Timesheets.ViewModels.ClientPortal;
using KaiFlow.Timesheets.ViewModels.ContractorPortal;
using KaiFlow.Timesheets.ViewModels.Employees;
using KaiFlow.Timesheets.ViewModels.Hr;
using KaiFlow.Timesheets.Views.Auth;
using KaiFlow.Timesheets.Views.ClientPortal;
using KaiFlow.Timesheets.Views.ContractorPortal;
using KaiFlow.Timesheets.Views.Employee;
using KaiFlow.Timesheets.Views.Hr;
using Microsoft.Extensions.Logging;
using Supabase;

namespace KaiFlow.Timesheets;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();

        builder
            .UseMauiApp<App>()
            .UseMauiCommunityToolkit()
            .ConfigureFonts(fonts =>
            {
                fonts.AddFont("Poppins-Regular.ttf", "PoppinsRegular");
                fonts.AddFont("Poppins-Medium.ttf", "PoppinsMedium");
                fonts.AddFont("Poppins-SemiBold.ttf", "PoppinsSemiBold");
                fonts.AddFont("Poppins-Bold.ttf", "PoppinsBold");
                fonts.AddFont("MaterialIcons-Regular.ttf", "MaterialIcons");
            });

        // Supabase
        builder.Services.AddSingleton(provider =>
        {
            var options = new SupabaseOptions
            {
                AutoRefreshToken = true,
                AutoConnectRealtime = false,
                SessionHandler = new MauiSupabaseSessionHandler()
            };
            return new Client(SupabaseEnvironment.Url, SupabaseEnvironment.AnonKey, options);
        });

        // Core services
        builder.Services.AddSingleton<IStorageService, SupabaseStorageService>();
        builder.Services.AddSingleton<ILocationService, LocationService>();
        builder.Services.AddSingleton<IBranchGeofenceService, BranchGeofenceService>();
        builder.Services.AddSingleton<IOfflineQueueService, OfflineQueueService>();
        builder.Services.AddSingleton<IExportHistoryService, ExportHistoryService>();
        builder.Services.AddSingleton<IExportQueueService, ExportQueueService>();
        builder.Services.AddSingleton<IExportService, ExportService>();
        builder.Services.AddSingleton<IReportFilterService, ReportFilterService>();
        builder.Services.AddSingleton<IExecutiveAnalyticsService, ExecutiveAnalyticsService>();
        builder.Services.AddSingleton<IFinancialAnalyticsService, FinancialAnalyticsService>();
        builder.Services.AddSingleton<IWorkforceAnalyticsService, WorkforceAnalyticsService>();
        builder.Services.AddSingleton<IOperationalAnalyticsService, OperationalAnalyticsService>();
        builder.Services.AddSingleton<ITelemetryAnalyticsService, TelemetryAnalyticsService>();
        builder.Services.AddSingleton<IDomainAnalyticsService, DomainAnalyticsService>();

        // Accounting integration foundation (provider-agnostic)
        builder.Services.AddSingleton<KaiFlow.Accounting.AccountingSyncQueue>();
        builder.Services.AddSingleton<KaiFlow.Accounting.AccountingSyncAudit>();
        builder.Services.AddSingleton<KaiFlow.Accounting.IAccountingExportMapper, KaiFlow.Accounting.AccountingExportMapper>();
        builder.Services.AddSingleton<KaiFlow.Accounting.IAccountingProvider, KaiFlow.Accounting.Providers.ManualAccountingProvider>();
        builder.Services.AddSingleton<KaiFlow.Accounting.AccountingSyncService>();
        builder.Services.AddSingleton<IPermissionsService, PermissionsService>();
        builder.Services.AddSingleton<IFeatureAccessService, FeatureAccessService>();
        builder.Services.AddSingleton<IUsageMeteringService, UsageMeteringService>();
        builder.Services.AddSingleton<IOnboardingService, OnboardingService>();
        builder.Services.AddSingleton<IPlatformSupportService, PlatformSupportService>();
        builder.Services.AddSingleton<IReleaseManagementService, ReleaseManagementService>();
        builder.Services.AddSingleton<IPlatformObservabilityService, PlatformObservabilityService>();
        builder.Services.AddSingleton<IVersionService, VersionService>();
        builder.Services.AddSingleton<IFeatureFlagService, FeatureFlagService>();
        builder.Services.AddSingleton<IBillingCalculationService, BillingCalculationService>();
        builder.Services.AddSingleton<IFeedbackService, FeedbackService>();
        builder.Services.AddSingleton<IPlatformReportingService, PlatformReportingService>();
        builder.Services.AddSingleton<ICompanySettingsService, CompanySettingsService>();
        builder.Services.AddSingleton<IBackupService, BackupService>();
        builder.Services.AddSingleton<EmployeeScopeService>();
        builder.Services.AddSingleton<AppTelemetry>();
        builder.Services.AddSingleton<KaiFlow.Finance.TaxCalculationService>();
        builder.Services.AddSingleton<AppUpdateService>();
        builder.Services.AddSingleton<RealtimeService>();
        builder.Services.AddSingleton<AccountNotificationAlertService>();

        // Auth ViewModels + Pages
        // Finance module ViewModels
        builder.Services.AddTransient<KaiFlow.Timesheets.ViewModels.Finance.FinanceDashboardViewModel>();
        builder.Services.AddTransient<KaiFlow.Timesheets.ViewModels.Finance.FinanceInvoicesViewModel>();
        builder.Services.AddTransient<KaiFlow.Timesheets.ViewModels.Finance.FinanceInvoiceDetailViewModel>();
        builder.Services.AddTransient<KaiFlow.Timesheets.ViewModels.Finance.SupplierInvoicesViewModel>();
        builder.Services.AddTransient<KaiFlow.Timesheets.ViewModels.Finance.ContractorPayoutsViewModel>();
        builder.Services.AddTransient<KaiFlow.Timesheets.ViewModels.Finance.FinanceVatViewModel>();
        builder.Services.AddTransient<KaiFlow.Timesheets.ViewModels.Finance.FinanceCashflowViewModel>();
        builder.Services.AddTransient<KaiFlow.Timesheets.ViewModels.Finance.FinanceReportsViewModel>();
        builder.Services.AddTransient<KaiFlow.Timesheets.ViewModels.Finance.FinanceApprovalsViewModel>();

        // Finance module pages
        builder.Services.AddTransient<KaiFlow.Timesheets.Views.Finance.FinanceDashboardPage>();
        builder.Services.AddTransient<KaiFlow.Timesheets.Views.Finance.FinanceInvoicesPage>();
        builder.Services.AddTransient<KaiFlow.Timesheets.Views.Finance.FinanceInvoiceDetailPage>();
        builder.Services.AddTransient<KaiFlow.Timesheets.Views.Finance.SupplierInvoicesPage>();
        builder.Services.AddTransient<KaiFlow.Timesheets.Views.Finance.ContractorPayoutsPage>();
        builder.Services.AddTransient<KaiFlow.Timesheets.Views.Finance.FinanceVatPage>();
        builder.Services.AddTransient<KaiFlow.Timesheets.Views.Finance.FinanceCashflowPage>();
        builder.Services.AddTransient<KaiFlow.Timesheets.Views.Finance.FinanceReportsPage>();
        builder.Services.AddTransient<KaiFlow.Timesheets.Views.Finance.FinanceApprovalsPage>();

        builder.Services.AddTransient<IdEntryViewModel>();
        builder.Services.AddTransient<IdEntryPage>();
        builder.Services.AddTransient<KaiFlow.Timesheets.ViewModels.Production.UpdateViewModel>();
        builder.Services.AddTransient<KaiFlow.Timesheets.Views.Production.UpdatePage>();
        builder.Services.AddTransient<EmployeeLoginViewModel>();
        builder.Services.AddTransient<EmployeeLoginPage>();
        builder.Services.AddTransient<EmployeeEmailOtpViewModel>();
        builder.Services.AddTransient<EmployeeEmailOtpPage>();
        builder.Services.AddTransient<HrSignInViewModel>();
        builder.Services.AddTransient<HrSignInPage>();
        builder.Services.AddTransient<HrRegisterViewModel>();
        builder.Services.AddTransient<HrRegisterPage>();
        builder.Services.AddTransient<HrRegisterVerifyCodeViewModel>();
        builder.Services.AddTransient<HrRegisterVerifyCodePage>();
        builder.Services.AddTransient<HrRegisterCompanyDetailsViewModel>();
        builder.Services.AddTransient<HrRegisterCompanyDetailsPage>();
        builder.Services.AddTransient<RoleSelectionViewModel>();
        builder.Services.AddTransient<RoleSelectionPage>();
        builder.Services.AddTransient<EmployeeCompanySelectorViewModel>();
        builder.Services.AddTransient<EmployeeCompanySelectorPage>();
        builder.Services.AddTransient<EmployeeMandatoryPasswordViewModel>();
        builder.Services.AddTransient<EmployeeMandatoryPasswordPage>();
        builder.Services.AddTransient<HrRegistrationSuccessViewModel>();
        builder.Services.AddTransient<HrRegistrationSuccessPage>();
        builder.Services.AddTransient<HrEmailVerifiedPage>();
        builder.Services.AddTransient<EmployeeSelfRegisterViewModel>();
        builder.Services.AddTransient<EmployeeSelfRegisterPage>();
        builder.Services.AddTransient<EmployeeRegisterVerifyViewModel>();
        builder.Services.AddTransient<EmployeeRegisterVerifyPage>();
        builder.Services.AddTransient<EmployeeLinkCompanyViewModel>();
        builder.Services.AddTransient<EmployeeLinkCompanyPage>();
        builder.Services.AddTransient<EmployeeRegistrationStatusViewModel>();
        builder.Services.AddTransient<EmployeeRegistrationStatusPage>();

        // Employee ViewModels + Pages
        builder.Services.AddSingleton<TimesheetStateService>();
        builder.Services.AddTransient<EmployeeDashboardViewModel>();
        builder.Services.AddTransient<EmployeeDashboardPage>();
        builder.Services.AddTransient<PunchViewModel>();
        builder.Services.AddTransient<PunchPage>();
        builder.Services.AddTransient<MyJobsViewModel>();
        builder.Services.AddTransient<MyJobsPage>();
        builder.Services.AddTransient<JobCardViewModel>();
        builder.Services.AddTransient<JobCardPage>();
        builder.Services.AddTransient<MyShiftsViewModel>();
        builder.Services.AddTransient<MyShiftsPage>();
        builder.Services.AddTransient<IncidentReportViewModel>();
        builder.Services.AddTransient<IncidentReportPage>();
        builder.Services.AddTransient<MyIncidentsViewModel>();
        builder.Services.AddTransient<MyIncidentsPage>();
        builder.Services.AddTransient<EmployeeThreadChatViewModel>();
        builder.Services.AddTransient<EmployeeThreadChatPage>();
        builder.Services.AddTransient<MyLeaveViewModel>();
        builder.Services.AddTransient<MyLeavePage>();
        builder.Services.AddSingleton<IMyPaCalendarConnectService, MyPaCalendarConnectService>();
        builder.Services.AddTransient<MyPaSectionViewModel>();
        builder.Services.AddTransient<MyPaSectionPage>();
        builder.Services.AddTransient<MyPaTaskEditorViewModel>();
        builder.Services.AddTransient<MyPaTaskEditorPage>();
        builder.Services.AddTransient<EmployeeNotificationsViewModel>();
        builder.Services.AddTransient<EmployeeNotificationsPage>();
        builder.Services.AddTransient<PaperlessViewModel>();
        builder.Services.AddTransient<PaperlessPage>();
        builder.Services.AddTransient<FormFillViewModel>();
        builder.Services.AddTransient<FormFillPage>();
        builder.Services.AddTransient<EmployeeJobRequestViewModel>();
        builder.Services.AddTransient<EmployeeJobRequestPage>();
        builder.Services.AddTransient<EmployeeContractorAdminViewModel>();
        builder.Services.AddTransient<EmployeeContractorAdminPage>();
        builder.Services.AddTransient<MyPayslipsViewModel>();
        builder.Services.AddTransient<MyPayslipsPage>();
        builder.Services.AddTransient<MyDocumentsViewModel>();
        builder.Services.AddTransient<MyDocumentsPage>();
        builder.Services.AddTransient<MyProfileViewModel>();
        builder.Services.AddTransient<MyProfilePage>();

        // HR ViewModels + Pages
        builder.Services.AddTransient<HrDashboardViewModel>();
        builder.Services.AddTransient<HrDashboardPage>();
        builder.Services.AddTransient<HrEmployeesViewModel>();
        builder.Services.AddTransient<HrEmployeesPage>();
        builder.Services.AddTransient<HrCreateEmployeeViewModel>();
        builder.Services.AddTransient<HrCreateEmployeePage>();
        builder.Services.AddTransient<HrEditEmployeeViewModel>();
        builder.Services.AddTransient<HrEditEmployeePage>();
        builder.Services.AddTransient<HrEmployeeDashboardViewModel>();
        builder.Services.AddTransient<HrEmployeeDashboardPage>();
        builder.Services.AddTransient<HrAttendanceViewModel>();
        builder.Services.AddTransient<HrAttendancePage>();
        builder.Services.AddTransient<HrApplyLeaveViewModel>();
        builder.Services.AddTransient<HrApplyLeavePage>();
        builder.Services.AddTransient<HrJobsViewModel>();
        builder.Services.AddTransient<HrJobsPage>();
        builder.Services.AddTransient<HrProjectsPage>();
        builder.Services.AddTransient<HrProjectDetailViewModel>();
        builder.Services.AddTransient<HrProjectDetailPage>();
        builder.Services.AddTransient<HrJobDetailsViewModel>();
        builder.Services.AddTransient<HrJobDetailsPage>();
        builder.Services.AddTransient<HrCreateJobViewModel>();
        builder.Services.AddTransient<HrCreateJobPage>();
        builder.Services.AddTransient<HrPaymentsViewModel>();
        builder.Services.AddTransient<HrPaymentsPage>();
        builder.Services.AddTransient<HrPayrollSettingsViewModel>();
        builder.Services.AddTransient<HrPayrollSettingsPage>();
        builder.Services.AddTransient<HrContractorsViewModel>();
        builder.Services.AddTransient<HrContractorsPage>();
        builder.Services.AddTransient<HrSuppliersViewModel>();
        builder.Services.AddTransient<HrSuppliersPage>();
        builder.Services.AddTransient<HrContractorDetailsViewModel>();
        builder.Services.AddTransient<HrContractorDetailsPage>();
        builder.Services.AddTransient<HrSchedulingViewModel>();
        builder.Services.AddTransient<HrSchedulingPage>();
        builder.Services.AddTransient<HrInventoryViewModel>();
        builder.Services.AddTransient<HrInventoryPage>();
        builder.Services.AddTransient<HrInventoryDetailViewModel>();
        builder.Services.AddTransient<HrInventoryDetailPage>();
        builder.Services.AddTransient<HrAssetsViewModel>();
        builder.Services.AddTransient<HrAssetsPage>();
        builder.Services.AddTransient<HrClientsViewModel>();
        builder.Services.AddTransient<HrClientsPage>();
        builder.Services.AddTransient<ClientDetailViewModel>();
        builder.Services.AddTransient<ClientDetailPage>();
        builder.Services.AddTransient<ClientPortalViewModel>();
        builder.Services.AddTransient<ClientPortalPage>();
        builder.Services.AddTransient<ClientPortalProjectDetailViewModel>();
        builder.Services.AddTransient<ClientPortalProjectDetailPage>();
        builder.Services.AddTransient<ContractorPortalViewModel>();
        builder.Services.AddTransient<ContractorPortalPage>();
        builder.Services.AddTransient<ContractorPortalJobDetailViewModel>();
        builder.Services.AddTransient<ContractorPortalJobDetailPage>();
        builder.Services.AddTransient<HrPropertiesViewModel>();
        builder.Services.AddTransient<HrPropertiesPage>();
        builder.Services.AddTransient<HrResidentsViewModel>();
        builder.Services.AddTransient<HrResidentsPage>();
        builder.Services.AddTransient<HrIncidentsViewModel>();
        builder.Services.AddTransient<HrIncidentsPage>();
        builder.Services.AddTransient<HrIncidentDetailsViewModel>();
        builder.Services.AddTransient<HrIncidentDetailsPage>();
        builder.Services.AddTransient<HrReportsViewModel>();
        builder.Services.AddTransient<HrReportsPage>();

        // Platform Admin (KaiFlow staff — not tenant HR)
        builder.Services.AddTransient<ViewModels.Platform.PlatformDashboardViewModel>();
        builder.Services.AddTransient<Views.Platform.PlatformDashboardPage>();
        builder.Services.AddTransient<ViewModels.Platform.SendFeedbackViewModel>();
        builder.Services.AddTransient<Views.Platform.SendFeedbackPage>();
        builder.Services.AddTransient<ViewModels.Platform.TenantOnboardingViewModel>();
        builder.Services.AddTransient<Views.Platform.TenantOnboardingPage>();

        builder.Services.AddTransient<HrWorkTeamsViewModel>();
        builder.Services.AddTransient<HrWorkTeamsPage>();
        builder.Services.AddTransient<HrWorkTeamDetailsViewModel>();
        builder.Services.AddTransient<HrWorkTeamDetailsPage>();
        builder.Services.AddTransient<HrSettingsViewModel>();
        builder.Services.AddTransient<HrSettingsPage>();
        builder.Services.AddTransient<HrShiftTemplatesViewModel>();
        builder.Services.AddTransient<HrShiftTemplatesPage>();
        builder.Services.AddTransient<HrCreateTimeTemplateViewModel>();
        builder.Services.AddTransient<HrCreateTimeTemplatePage>();
        builder.Services.AddTransient<HrActivityLogViewModel>();
        builder.Services.AddTransient<HrActivityLogPage>();
        builder.Services.AddTransient<HrNotificationsViewModel>();
        builder.Services.AddTransient<HrNotificationsPage>();
        builder.Services.AddTransient<HrSimpleThreadChatViewModel>();
        builder.Services.AddTransient<HrSimpleThreadChatPage>();
        builder.Services.AddTransient<HrPayslipDetailViewModel>();
        builder.Services.AddTransient<HrPayslipDetailPage>();
        builder.Services.AddTransient<HrImportEmployeesViewModel>();
        builder.Services.AddTransient<HrImportEmployeesPage>();
        builder.Services.AddTransient<HrTeamPunchViewModel>();
        builder.Services.AddTransient<HrTeamPunchPage>();

#if DEBUG
        builder.Logging.AddDebug();
#endif

        var app = builder.Build();

        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            if (e.ExceptionObject is Exception ex)
                WriteCrashLog(ex);
        };

        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            WriteCrashLog(e.Exception);
            e.SetObserved();
        };

        return app;
    }

    private static void WriteCrashLog(Exception ex)
    {
        try
        {
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "KaiFlow",
                "crash.log");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.AppendAllText(path, $"{DateTime.Now:u}{Environment.NewLine}{ex}{Environment.NewLine}{Environment.NewLine}");
        }
        catch { /* ignore */ }
    }
}
