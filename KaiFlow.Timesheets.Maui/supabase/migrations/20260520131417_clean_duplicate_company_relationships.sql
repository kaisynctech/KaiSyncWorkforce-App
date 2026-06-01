
-- Remove duplicate company_relationships rows, keeping the oldest per (user_id, company_id)
DELETE FROM company_relationships
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY user_id, company_id ORDER BY created_at) AS rn
        FROM company_relationships
    ) ranked
    WHERE rn > 1
);

-- Add unique constraint to prevent future duplicates
ALTER TABLE company_relationships
    DROP CONSTRAINT IF EXISTS company_relationships_user_company_unique;

ALTER TABLE company_relationships
    ADD CONSTRAINT company_relationships_user_company_unique
    UNIQUE (user_id, company_id);
;
