import Link from 'next/link'

export default function HrRegisterVerifyPage() {
  return (
    <div className="w-full max-w-sm">
      <div className="bg-surface rounded-lg p-8 shadow-sm border border-divider text-center">
        <div className="w-16 h-16 rounded-full bg-success-dark flex items-center justify-center mx-auto mb-5">
          <span className="material-icons text-success text-3xl">mark_email_unread</span>
        </div>
        <h1 className="text-[22px] font-semibold text-text-primary mb-2">Check your email</h1>
        <p className="text-[14px] text-text-secondary leading-relaxed">
          We sent a verification link to your email address. Click the link to confirm your account,
          then come back to set up your company.
        </p>
        <div className="mt-6 p-4 bg-background rounded-md text-[13px] text-text-secondary">
          Didn&apos;t receive it? Check your spam folder or{' '}
          <Link href="/auth/hr-register" className="text-primary hover:underline">
            try again
          </Link>
          .
        </div>
        <Link
          href="/auth/hr-register-company"
          className="mt-6 flex h-11 items-center justify-center rounded-md bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark transition-colors"
        >
          I&apos;ve verified — Continue
        </Link>
        <Link
          href="/auth/hr-sign-in"
          className="mt-3 block text-[12px] text-text-secondary hover:text-primary transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
