using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;
using KaiFlow.Timesheets.Views.Employee;
using KaiFlow.Timesheets.Views.Hr;
using KaiFlow.Timesheets.Views.Shared;

namespace KaiFlow.Timesheets.Services;

/// <summary>Adds Back and Dashboard controls to drill-down pages.</summary>
public static class NavigationChrome
{
    private static readonly HashSet<string> SkipPageNames = new(StringComparer.Ordinal)
    {
        nameof(EmployeeDashboardPage),
        nameof(HrDashboardPage),
        nameof(IdEntryPage),
        nameof(EmployeeLoginPage),
        nameof(EmployeeEmailOtpPage),
        nameof(HrSignInPage),
        nameof(HrRegisterPage),
        nameof(HrRegisterVerifyCodePage),
        nameof(HrRegisterCompanyDetailsPage),
        nameof(RoleSelectionPage),
        nameof(EmployeeCompanySelectorPage),
        nameof(EmployeeMandatoryPasswordPage),
        nameof(HrRegistrationSuccessPage),
        nameof(HrEmailVerifiedPage),
        nameof(EmployeeSelfRegisterPage),
        nameof(EmployeeRegisterVerifyPage),
        nameof(EmployeeLinkCompanyPage),
        nameof(EmployeeRegistrationStatusPage),
    };

    private static readonly BindableProperty AttachedProperty =
        BindableProperty.CreateAttached(
            "NavigationChromeAttached",
            typeof(bool),
            typeof(NavigationChrome),
            false);

    public static void Attach(ContentPage page, BaseViewModel vm)
    {
        if (SkipPageNames.Contains(page.GetType().Name))
            return;

        if (page.GetValue(AttachedProperty) is true)
            return;

        page.SetValue(AttachedProperty, true);

        if (!page.ToolbarItems.Any(t => t.Text == "← Back"))
        {
            page.ToolbarItems.Insert(0, new ToolbarItem
            {
                Text = "← Back",
                Order = ToolbarItemOrder.Primary,
                Command = vm.NavigateBackCommand
            });
        }

        if (!page.ToolbarItems.Any(t => t.Text == "Dashboard"))
        {
            page.ToolbarItems.Add(new ToolbarItem
            {
                Text = "Dashboard",
                Order = ToolbarItemOrder.Secondary,
                Command = vm.NavigateToDashboardCommand
            });
        }

        if (page.Content is Grid { Children.Count: >= 2 } grid
            && grid.Children[0] is NavigationBackBar)
            return;

        var bar = new NavigationBackBar { BindingContext = vm };
        var original = page.Content;
        page.Content = new Grid
        {
            RowDefinitions =
            [
                new RowDefinition(GridLength.Auto),
                new RowDefinition(GridLength.Star)
            ],
            Children = { bar, original }
        };
        Grid.SetRow(bar, 0);
        Grid.SetRow(original, 1);
    }
}
