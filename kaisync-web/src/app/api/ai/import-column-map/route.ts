import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { fieldsForKind, type ImportKind } from '@/lib/import-column-map'

const MODEL = 'claude-sonnet-5'
const bodySchema = z.object({
  kind: z.enum(['clients', 'employees']),
  columns: z.array(z.object({
    header: z.string().min(1).max(120),
    samples: z.array(z.string().max(200)).max(3),
  })).min(1).max(40),
})

const mapSchema = z.object({
  columns: z.array(z.object({
    header: z.string(),
    field: z.string(),
    confident: z.boolean(),
  })),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: employee } = await supabase
    .from('employees')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (!employee?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'The column list could not be read.' }, { status: 400 })

  const kind = parsed.data.kind as ImportKind
  const fields = fieldsForKind(kind)
  const allowed = fields.map(field => `${field.id} = ${field.header}`).join('\n')
  const source = parsed.data.columns
    .map(column => `${column.header}: ${column.samples.join(' | ') || '(no sample)'}`)
    .join('\n')

  try {
    const result = await generateObject({
      model: anthropic(MODEL),
      schema: mapSchema,
      system: `You match spreadsheet columns to KaiSync ${kind} fields.
Return every source header once.
field must be one of the ids below, or "ignore".
Set confident to true only when the heading and the sample values clearly belong to that field.
A phone number is not a bank account. An ID or passport number is not a phone number.
Do not rewrite, correct, or invent any sample value.

Fields:
${allowed}`,
      prompt: source,
    })

    await supabase.from('ai_usage_log').insert({
      company_id: employee.company_id,
      feature: 'import_column_map',
      model: MODEL,
      input_tokens: result.usage?.inputTokens ?? 0,
      output_tokens: result.usage?.outputTokens ?? 0,
      entity_type: kind,
      success: true,
    })

    return NextResponse.json({ columns: result.object.columns })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Column matching failed.'
    await supabase.from('ai_usage_log').insert({
      company_id: employee.company_id,
      feature: 'import_column_map',
      model: MODEL,
      input_tokens: 0,
      output_tokens: 0,
      entity_type: kind,
      success: false,
      error_message: message,
    }).then(() => undefined, () => undefined)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
