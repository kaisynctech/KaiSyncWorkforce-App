/**
 * Mirrors KaiFlow.Timesheets.Services.EmployeeAccountRouting
 * and Employee.UsesCompanyDashboard from MAUI.
 */

export const AUTH_ROUTES = {
  idEntry: '/auth/id-entry',
  companyPicker: '/auth/company-selector',
  mandatoryPassword: '/auth/mandatory-password',
  emailOtp: '/auth/email-otp',
  forgotPassword: '/auth/forgot-password',
  selfRegister: '/auth/employee-register',
  registerVerify: '/auth/employee-register-verify',
  linkCompany: '/auth/link-company',
  registrationStatus: '/auth/registration-status',
  employeeDashboard: '/dashboard/employee/overview',
  hrDashboard: '/dashboard/overview',
} as const

/** Owner, HR Admin, Admin, or Manager — company (HR) dashboard. */
export function usesCompanyDashboard(accessLevel: string | null | undefined): boolean {
  const level = (accessLevel ?? '').toLowerCase().replace(/-/g, '_')
  return level === 'owner'
    || level === 'hr_admin'
    || level === 'hradmin'
    || level === 'admin'
    || level === 'manager'
    || level === 'hr'
}

export function routeAfterCompanySelected(accessLevel: string | null | undefined): string {
  return usesCompanyDashboard(accessLevel)
    ? AUTH_ROUTES.hrDashboard
    : AUTH_ROUTES.employeeDashboard
}

/** After email/OTP sign-in: mandatory password or company picker (MAUI NavigateAfterAuthAsync). */
export function routeAfterEmailSignIn(loginPasswordReady: boolean): string {
  if (!loginPasswordReady) return AUTH_ROUTES.mandatoryPassword
  return AUTH_ROUTES.companyPicker
}
