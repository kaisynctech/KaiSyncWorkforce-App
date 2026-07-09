using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;
using KaiFlow.Timesheets.Views.ClientPortal;
using KaiFlow.Timesheets.Views.ContractorPortal;
using KaiFlow.Timesheets.Views.Employee;
using KaiFlow.Timesheets.Views.Finance;
using KaiFlow.Timesheets.Views.Hr;
using KaiFlow.Timesheets.Views.Platform;
using KaiFlow.Timesheets.Views.Production;

namespace KaiFlow.Timesheets;

public partial class AppShell : Shell
{
    public AppShell(IServiceProvider services)
    {
        InitializeComponent();

        Navigated += (_, _) =>
        {
            if (CurrentPage is ContentPage page && page.BindingContext is BaseViewModel vm)
                NavigationChrome.Attach(page, vm);
        };

        // Defer RealtimeService until after first paint — avoids blocking WinUI window creation.
        _ = Task.Run(() =>
        {
            try { _ = services.GetRequiredService<RealtimeService>(); }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"RealtimeService: {ex.Message}"); }
        });

        // Auth (short names in Shell; Page-suffix routes for push navigation)
        Routing.RegisterRoute(nameof(EmployeeLoginPage), typeof(EmployeeLoginPage));
        Routing.RegisterRoute(nameof(EmployeeEmailOtpPage), typeof(EmployeeEmailOtpPage));
        Routing.RegisterRoute(nameof(HrSignInPage), typeof(HrSignInPage));
        Routing.RegisterRoute(nameof(HrRegisterPage), typeof(HrRegisterPage));
        Routing.RegisterRoute(nameof(HrRegisterVerifyCodePage), typeof(HrRegisterVerifyCodePage));
        Routing.RegisterRoute(nameof(HrRegisterCompanyDetailsPage), typeof(HrRegisterCompanyDetailsPage));
        Routing.RegisterRoute(nameof(RoleSelectionPage), typeof(RoleSelectionPage));
        Routing.RegisterRoute(nameof(EmployeeCompanySelectorPage), typeof(EmployeeCompanySelectorPage));
        Routing.RegisterRoute(nameof(EmployeeMandatoryPasswordPage), typeof(EmployeeMandatoryPasswordPage));
        Routing.RegisterRoute(nameof(EmployeePinSetupPage), typeof(EmployeePinSetupPage));
        Routing.RegisterRoute(nameof(EmployeePinEntryPage), typeof(EmployeePinEntryPage));
        Routing.RegisterRoute(nameof(HrRegistrationSuccessPage), typeof(HrRegistrationSuccessPage));
        Routing.RegisterRoute(nameof(HrEmailVerifiedPage), typeof(HrEmailVerifiedPage));
        Routing.RegisterRoute(nameof(EmployeeSelfRegisterPage), typeof(EmployeeSelfRegisterPage));
        Routing.RegisterRoute(nameof(EmployeeRegisterVerifyPage), typeof(EmployeeRegisterVerifyPage));
        Routing.RegisterRoute(nameof(EmployeeLinkCompanyPage), typeof(EmployeeLinkCompanyPage));
        Routing.RegisterRoute(nameof(EmployeeRegistrationStatusPage), typeof(EmployeeRegistrationStatusPage));

        // Employee drill-down
        Routing.RegisterRoute(nameof(PunchPage), typeof(PunchPage));
        Routing.RegisterRoute(nameof(MyJobsPage), typeof(MyJobsPage));
        Routing.RegisterRoute(nameof(JobCardPage), typeof(JobCardPage));
        Routing.RegisterRoute(nameof(MyIncidentsPage), typeof(MyIncidentsPage));
        Routing.RegisterRoute(nameof(IncidentReportPage), typeof(IncidentReportPage));
        Routing.RegisterRoute(nameof(MyShiftsPage), typeof(MyShiftsPage));
        Routing.RegisterRoute(nameof(MyLeavePage), typeof(MyLeavePage));
        Routing.RegisterRoute(nameof(MyPayslipsPage), typeof(MyPayslipsPage));
        Routing.RegisterRoute(nameof(MyDocumentsPage), typeof(MyDocumentsPage));
        Routing.RegisterRoute(nameof(MyProfilePage), typeof(MyProfilePage));
        Routing.RegisterRoute(nameof(MyPaSectionPage), typeof(MyPaSectionPage));
        Routing.RegisterRoute(nameof(EmployeeThreadChatPage), typeof(EmployeeThreadChatPage));
        Routing.RegisterRoute(nameof(EmployeeNotificationsPage), typeof(EmployeeNotificationsPage));
        Routing.RegisterRoute(nameof(PaperlessPage), typeof(PaperlessPage));
        Routing.RegisterRoute(nameof(FormFillPage), typeof(FormFillPage));
        Routing.RegisterRoute(nameof(EmployeeJobRequestPage), typeof(EmployeeJobRequestPage));
        Routing.RegisterRoute(nameof(MyPaTaskEditorPage), typeof(MyPaTaskEditorPage));
        Routing.RegisterRoute(nameof(EmployeeContractorAdminPage), typeof(EmployeeContractorAdminPage));

        // HR drill-down
        Routing.RegisterRoute(nameof(HrEmployeesPage), typeof(HrEmployeesPage));
        Routing.RegisterRoute(nameof(HrCreateEmployeePage), typeof(HrCreateEmployeePage));
        Routing.RegisterRoute(nameof(HrEditEmployeePage), typeof(HrEditEmployeePage));
        Routing.RegisterRoute(nameof(HrEmployeeDashboardPage), typeof(HrEmployeeDashboardPage));
        Routing.RegisterRoute(nameof(HrJobsPage), typeof(HrJobsPage));
        Routing.RegisterRoute(nameof(HrProjectsPage), typeof(HrProjectsPage));
        Routing.RegisterRoute(nameof(HrProjectDetailPage), typeof(HrProjectDetailPage));
        Routing.RegisterRoute(nameof(HrCreateJobPage), typeof(HrCreateJobPage));
        Routing.RegisterRoute(nameof(HrJobDetailsPage), typeof(HrJobDetailsPage));
        Routing.RegisterRoute(nameof(HrPaymentsPage), typeof(HrPaymentsPage));
        Routing.RegisterRoute(nameof(HrContractorsPage), typeof(HrContractorsPage));
        Routing.RegisterRoute(nameof(HrSuppliersPage), typeof(HrSuppliersPage));
        Routing.RegisterRoute(nameof(HrContractorDetailsPage), typeof(HrContractorDetailsPage));
        Routing.RegisterRoute(nameof(HrJobContractorDocsPage), typeof(HrJobContractorDocsPage)); // Phase D
        Routing.RegisterRoute(nameof(HrCompliancePacksPage), typeof(HrCompliancePacksPage)); // Phase 2B.3a
        Routing.RegisterRoute(nameof(HrClientsPage), typeof(HrClientsPage));
        Routing.RegisterRoute(nameof(ClientDetailPage), typeof(ClientDetailPage));
        Routing.RegisterRoute(nameof(ClientPortalPage), typeof(ClientPortalPage));
        Routing.RegisterRoute(nameof(ClientPortalProjectDetailPage), typeof(ClientPortalProjectDetailPage));
        Routing.RegisterRoute(nameof(HrIncidentsPage), typeof(HrIncidentsPage));
        Routing.RegisterRoute(nameof(HrPropertiesPage), typeof(HrPropertiesPage));
        Routing.RegisterRoute(nameof(HrResidentsPage), typeof(HrResidentsPage));
        Routing.RegisterRoute(nameof(HrAssetsPage), typeof(HrAssetsPage));
        Routing.RegisterRoute(nameof(HrInventoryPage), typeof(HrInventoryPage));
        Routing.RegisterRoute(nameof(HrInventoryDetailPage), typeof(HrInventoryDetailPage));
        Routing.RegisterRoute(nameof(HrSchedulingPage), typeof(HrSchedulingPage));
        Routing.RegisterRoute(nameof(HrWorkTeamsPage), typeof(HrWorkTeamsPage));
        Routing.RegisterRoute(nameof(HrActivityLogPage), typeof(HrActivityLogPage));
        Routing.RegisterRoute(nameof(HrNotificationsPage), typeof(HrNotificationsPage));
        Routing.RegisterRoute(nameof(HrAttendancePage), typeof(HrAttendancePage));
        Routing.RegisterRoute(nameof(HrApplyLeavePage), typeof(HrApplyLeavePage));
        Routing.RegisterRoute(nameof(HrSettingsPage), typeof(HrSettingsPage));
        Routing.RegisterRoute(nameof(HrReportsPage), typeof(HrReportsPage));
        Routing.RegisterRoute(nameof(HrPayrollSettingsPage), typeof(HrPayrollSettingsPage));
        Routing.RegisterRoute(nameof(HrIncidentDetailsPage), typeof(HrIncidentDetailsPage));
        Routing.RegisterRoute(nameof(HrWorkTeamDetailsPage), typeof(HrWorkTeamDetailsPage));
        Routing.RegisterRoute(nameof(HrShiftTemplatesPage), typeof(HrShiftTemplatesPage));
        Routing.RegisterRoute(nameof(HrCreateTimeTemplatePage), typeof(HrCreateTimeTemplatePage));
        Routing.RegisterRoute(nameof(HrSimpleThreadChatPage), typeof(HrSimpleThreadChatPage));
        Routing.RegisterRoute(nameof(HrActiveSessionsPage), typeof(HrActiveSessionsPage));

        // Platform admin
        Routing.RegisterRoute(nameof(PlatformDashboardPage), typeof(PlatformDashboardPage));
        Routing.RegisterRoute(nameof(SendFeedbackPage), typeof(SendFeedbackPage));
        Routing.RegisterRoute(nameof(TenantOnboardingPage), typeof(TenantOnboardingPage));
        Routing.RegisterRoute(nameof(UpdatePage), typeof(UpdatePage));
        Routing.RegisterRoute(nameof(HrImportEmployeesPage), typeof(HrImportEmployeesPage));
        Routing.RegisterRoute(nameof(HrTeamPunchPage), typeof(HrTeamPunchPage));
        Routing.RegisterRoute(nameof(ContractorPortalPage), typeof(ContractorPortalPage));
        Routing.RegisterRoute(nameof(ContractorPortalJobDetailPage), typeof(ContractorPortalJobDetailPage));

        // Platform admin (KaiFlow staff)
        Routing.RegisterRoute(nameof(PlatformDashboardPage), typeof(PlatformDashboardPage));
        Routing.RegisterRoute(nameof(SendFeedbackPage), typeof(SendFeedbackPage));
        Routing.RegisterRoute(nameof(TenantOnboardingPage), typeof(TenantOnboardingPage));

        // Finance module
        Routing.RegisterRoute(nameof(FinanceDashboardPage), typeof(FinanceDashboardPage));
        Routing.RegisterRoute(nameof(FinanceInvoicesPage), typeof(FinanceInvoicesPage));
        Routing.RegisterRoute(nameof(FinanceInvoiceDetailPage), typeof(FinanceInvoiceDetailPage));
        Routing.RegisterRoute(nameof(SupplierInvoicesPage), typeof(SupplierInvoicesPage));
        Routing.RegisterRoute(nameof(ContractorPayoutsPage), typeof(ContractorPayoutsPage));
        Routing.RegisterRoute(nameof(FinanceVatPage), typeof(FinanceVatPage));
        Routing.RegisterRoute(nameof(FinanceCashflowPage), typeof(FinanceCashflowPage));
        Routing.RegisterRoute(nameof(FinanceReportsPage), typeof(FinanceReportsPage));
        Routing.RegisterRoute(nameof(FinanceApprovalsPage), typeof(FinanceApprovalsPage));
    }
}
