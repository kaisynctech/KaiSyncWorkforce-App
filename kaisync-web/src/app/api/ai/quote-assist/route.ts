import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const suggestionSchema = z.object({
  suggestions: z.array(z.object({
    description:          z.string(),
    quantity:             z.number(),
    unit:                 z.string(),
    item_type:            z.enum(['material', 'labour', 'subcontract', 'equipment', 'other']),
    catalogue_item_id:    z.string().nullable()
                           .describe('UUID of matching catalogue item, or null if no match'),
    catalogue_match_name: z.string().nullable(),
    suggested_cost_price: z.number().describe('Estimated cost price in ZAR'),
    suggested_sell_price: z.number().describe('Recommended sell price in ZAR'),
    markup_percent:       z.number(),
    confidence:           z.enum(['high', 'medium', 'low']),
    reasoning:            z.string().describe('Brief explanation of this suggestion'),
  }))
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { description?: string; company_id?: string; quote_id?: string }
  const { description, company_id, quote_id } = body
  if (!description || !company_id) {
    return NextResponse.json({ error: 'Missing description or company_id' }, { status: 400 })
  }

  // Load company catalogue as pricing context
  const { data: catalogue } = await supabase
    .from('quote_catalogue_items')
    .select('id, name, description, unit, item_type, category, cost_price, sell_price, markup_percent')
    .eq('company_id', company_id)
    .eq('is_active', true)
    .order('usage_count', { ascending: false })
    .limit(200)

  const catalogueContext = catalogue && catalogue.length > 0
    ? `\n\nCOMPANY CATALOGUE (${catalogue.length} items — prefer these IDs and prices):\n` +
      catalogue.map(c =>
        `- ID:${c.id} | ${c.name} | ${c.unit} | type:${c.item_type} | cost:R${c.cost_price} | sell:R${c.sell_price}`
      ).join('\n')
    : '\n\nNo catalogue items available — suggest realistic ZAR prices for the South African construction market.'

  const systemPrompt = `You are a South African construction estimating assistant with deep knowledge of the local market.
Given a job description, generate a detailed list of quote line items.
${catalogueContext}

Rules:
- PREFER matching to catalogue items (use their exact UUID and prices)
- For items NOT in the catalogue, suggest realistic ZAR prices for South Africa
- Typical markup on materials: 20–35%. Labour: 0% markup (sell = cost). Subcontract: 10–15%.
- Be specific — "Tiles 600x600 ceramic" not just "tiles"
- Include all labour and materials needed
- If quantity is uncertain, use reasonable assumptions and note in reasoning
- Set catalogue_item_id to null for new items not in the catalogue`

  try {
    const result = await generateObject({
      model:  anthropic('claude-haiku-4-5-20251001'),
      schema: suggestionSchema,
      system: systemPrompt,
      prompt: `Generate quote line items for: ${description}`,
    })

    const usage = {
      input_tokens:  result.usage?.inputTokens  ?? 0,
      output_tokens: result.usage?.outputTokens ?? 0,
    }

    await supabase.from('ai_usage_log').insert({
      company_id:   company_id,
      feature:      'quote_assistant',
      model:        'claude-haiku-4-5-20251001',
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      entity_type:  'quote',
      entity_id:    quote_id ?? null,
      success:      true,
    })

    return NextResponse.json({ suggestions: result.object.suggestions, usage })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await supabase.from('ai_usage_log').insert({
      company_id:   company_id,
      feature:      'quote_assistant',
      model:        'claude-haiku-4-5-20251001',
      input_tokens:  0,
      output_tokens: 0,
      success:       false,
      error_message: errorMessage,
    })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
