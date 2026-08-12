import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const boqLineSchema = z.object({
  lines: z.array(z.object({
    description: z.string().describe('Item description exactly as in the document'),
    quantity:    z.number().describe('Quantity. Use 1 if not specified.'),
    unit:        z.string().describe('Unit of measure (m2, m, each, hr, kg, etc). Use "item" if unclear.'),
    unit_price:  z.number().nullable().describe('Unit price if shown, null if not in document'),
    item_type:   z.enum(['material', 'labour', 'subcontract', 'equipment', 'other'])
                  .describe('Best guess at item type based on description'),
    section:     z.string().optional().describe('Section heading this item falls under'),
    notes:       z.string().optional().describe('Any spec notes or qualifications for this item'),
  }))
})

const SYSTEM_PROMPT = `You are a construction estimating assistant. Extract all line items from the Bill of Quantities provided.
Be precise about quantities and units. For item_type, classify as:
- material: physical goods, supplies, products
- labour: installation, labour hours, workforce
- subcontract: work done by subcontractors
- equipment: plant, machinery, tools hire
- other: anything else (preliminaries, contingencies, etc)`

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: emp } = await supabase
    .from('employees')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const companyId = emp?.company_id ?? null
  if (!companyId) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const formData = await request.formData()
  const file    = formData.get('file')    as File   | null
  const text    = formData.get('text')    as string | null
  const quoteId = formData.get('quote_id') as string | null

  if (!file && !text) {
    return NextResponse.json({ error: 'No file or text provided' }, { status: 400 })
  }

  try {
    let result: Awaited<ReturnType<typeof generateObject<typeof boqLineSchema>>>

    if (file) {
      const bytes  = await file.arrayBuffer()
      const base64 = Buffer.from(bytes).toString('base64')
      result = await generateObject({
        model:  anthropic('claude-sonnet-5'),
        schema: boqLineSchema,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all line items from this Bill of Quantities document.' },
            { type: 'file', data: base64, mediaType: file.type || 'application/pdf' },
          ],
        }],
      })
    } else {
      result = await generateObject({
        model:  anthropic('claude-sonnet-5'),
        schema: boqLineSchema,
        system: SYSTEM_PROMPT,
        prompt: `Extract all line items from this Bill of Quantities:\n\n${text}`,
      })
    }

    const usage = {
      input_tokens:  result.usage?.inputTokens  ?? 0,
      output_tokens: result.usage?.outputTokens ?? 0,
    }

    await supabase.from('ai_usage_log').insert({
      company_id:   companyId,
      feature:      'boq_extraction',
      model:        'claude-sonnet-5',
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      entity_type:  quoteId ? 'quote' : 'boq_session',
      entity_id:    quoteId ?? crypto.randomUUID(),
      success:      true,
    })

    return NextResponse.json({ lines: result.object.lines, usage })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await supabase.from('ai_usage_log').insert({
      company_id:   companyId,
      feature:      'boq_extraction',
      model:        'claude-sonnet-5',
      input_tokens:  0,
      output_tokens: 0,
      success:       false,
      error_message: errorMessage,
    })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
