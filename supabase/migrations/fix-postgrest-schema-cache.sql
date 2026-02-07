-- ============================================================
-- PHASE 1: VERIFY sms_consent column exists in actual database
-- ============================================================
-- Run this FIRST. Expect 1 row returned.
SELECT
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'interactions'
  AND column_name = 'sms_consent';

-- ============================================================
-- PHASE 2: Force PostgREST schema cache invalidation
-- ============================================================
-- Option B: No-op ALTER that forces schema recompilation.
-- This is safer than drop+re-add because it preserves data.
-- The COMMENT forces PostgREST to treat the schema as changed
-- even though the actual column definition is unchanged.

-- Step 1: No-op ALTER to touch column metadata
ALTER TABLE public.interactions
  ALTER COLUMN sms_consent SET DEFAULT NULL;

-- Step 2: Add a comment (forces pg_catalog change PostgREST watches)
COMMENT ON COLUMN public.interactions.sms_consent
  IS 'SMS consent: true=opt-in, false=opt-out, null=not-asked';

-- Step 3: Notify PostgREST to reload
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- PHASE 2b: VERIFY PostgREST can now see the column
-- ============================================================
-- This query goes through PostgREST. If it works, the cache is fixed.
SELECT id, sms_consent
FROM public.interactions
ORDER BY created_at DESC
LIMIT 3;
