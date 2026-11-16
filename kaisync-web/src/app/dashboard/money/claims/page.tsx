import { redirect } from 'next/navigation'

/** Moved to Workforce (staff pay sits with Payroll). Old links keep working. */
export default function Moved() {
  redirect('/dashboard/workforce/claims')
}
