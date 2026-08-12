-- ============================================================
-- KaiSync Commercial Engine — Phase 5: AI Features
-- 2026-08-11
--
-- Adds: AI usage logging, pg_trgm price similarity search,
--       ai_suggested flag on catalogue items
-- ============================================================


-- ============================================================
-- 1. ENABLE pg_trgm FOR SIMILARITY SEARCH
--    Used by smart pricing recommendations (no LLM needed)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ============================================================
-- 2. AI USAGE LOG
--    Track every AI API call for cost monitoring per company.
--    Append-only — no UPDATE/DELETE.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  feature         text        NOT NULL,
    -- 'boq_extraction' | 'quote_assistant' | 'price_suggest'
  model           text        NOT NULL,
  input_tokens    integer     NOT NULL DEFAULT 0,
  output_tokens   integer     NOT NULL DEFAULT 0,
  total_tokens    integer     GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  -- Rough cost in USD cents (for monitoring — not billing)
  estimated_cost_usd_cents numeric GENERATED ALWAYS AS (
    -- Claude Sonnet 5: $3/MTok in, $15/MTok out (approximate)
    ROUND((input_tokens::numeric / 1000000 * 300) + (output_tokens::numeric / 1000000 * 1500), 4)
  ) STORED,
  entity_type     text,       -- 'quote' | 'boq_session'
  entity_id       text,       -- uuid of the quote or session
  success         boolean     NOT NULL DEFAULT true,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_log_select" ON public.ai_usage_log FOR SELECT
  USING (company_id = ANY(public.user_company_ids())
    AND public.user_has_permission(company_id, 'projects.financials'));
CREATE POLICY "ai_log_insert" ON public.ai_usage_log FOR INSERT
  WITH CHECK (company_id = ANY(public.user_company_ids()));
CREATE POLICY "ai_log_no_update" ON public.ai_usage_log FOR UPDATE USING (false);
CREATE POLICY "ai_log_no_delete" ON public.ai_usage_log FOR DELETE USING (false);


-- ============================================================
-- 3. EXTEND quote_catalogue_items
--    Track which items were AI-suggested vs manually created
-- ============================================================
ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS ai_suggested   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usage_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at   timestamptz;

-- Index for similarity search on name + description
CREATE INDEX IF NOT EXISTS idx_catalogue_name_trgm
  ON public.quote_catalogue_items USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_catalogue_desc_trgm
  ON public.quote_catalogue_items USING gin(description gin_trgm_ops);


-- ============================================================
-- 4. SMART PRICING RPC
--    Returns similar catalogue items by description similarity.
--    Called from the quote builder price field — no LLM needed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_price_suggestions(
  p_company_id  uuid,
  p_description text,
  p_limit       int DEFAULT 5
)
RETURNS TABLE (
  catalogue_item_id uuid,
  name              text,
  unit              text,
  item_type         text,
  cost_price        numeric,
  sell_price        numeric,
  markup_percent    numeric,
  similarity_score  real,
  usage_count       integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id,
    name,
    unit,
    item_type,
    cost_price,
    sell_price,
    markup_percent,
    GREATEST(
      similarity(name, p_description),
      similarity(COALESCE(description, ''), p_description)
    ) AS similarity_score,
    usage_count
  FROM public.quote_catalogue_items
  WHERE company_id = p_company_id
    AND is_active = true
    AND (
      similarity(name, p_description) > 0.15
      OR similarity(COALESCE(description, ''), p_description) > 0.15
    )
  ORDER BY similarity_score DESC, usage_count DESC
  LIMIT p_limit;
$$;


-- ============================================================
-- 5. INCREMENT CATALOGUE USAGE RPC
--    Called when a catalogue item is added to a quote line.
--    Keeps usage_count accurate for ranking suggestions.
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_catalogue_usage(p_item_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.quote_catalogue_items
  SET usage_count  = usage_count + 1,
      last_used_at = now()
  WHERE id = p_item_id;
$$;


-- ============================================================
-- 6. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ai_usage_company  ON public.ai_usage_log(company_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature  ON public.ai_usage_log(company_id, feature);

-- ============================================================
-- END OF MIGRATION
-- ============================================================
