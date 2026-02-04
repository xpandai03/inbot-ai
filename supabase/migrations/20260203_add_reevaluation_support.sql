-- Re-evaluation support: new columns on interactions + evaluation_history table
-- Additive-only migration - no existing data changes

-- ============================================
-- 1A. Add columns to interactions table
-- ============================================

ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS raw_transcript TEXT,
  ADD COLUMN IF NOT EXISTS recording_url TEXT,
  ADD COLUMN IF NOT EXISTS stereo_recording_url TEXT,
  ADD COLUMN IF NOT EXISTS call_metadata JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Auto-set updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_interactions_updated_at ON interactions;
CREATE TRIGGER trg_interactions_updated_at
  BEFORE UPDATE ON interactions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================
-- 1B. Create evaluation_history table
-- ============================================

CREATE TABLE IF NOT EXISTS evaluation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  evaluation_type TEXT NOT NULL CHECK (evaluation_type IN ('initial', 're-evaluation')),
  candidate_name TEXT,
  candidate_address TEXT,
  candidate_intent TEXT,
  candidate_department TEXT,
  candidate_summary TEXT,
  extraction_meta JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'applied', 'superseded')),
  applied_at TIMESTAMPTZ,
  applied_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_history_interaction_id
  ON evaluation_history(interaction_id);

CREATE INDEX IF NOT EXISTS idx_eval_history_interaction_status
  ON evaluation_history(interaction_id, status);

-- ============================================
-- 1C. RLS policies for evaluation_history
-- ============================================

ALTER TABLE evaluation_history ENABLE ROW LEVEL SECURITY;

-- Super admin: full access
CREATE POLICY "super_admin_all_eval_history" ON evaluation_history
  FOR ALL
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'super_admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'super_admin'
  );

-- Service role: INSERT (for initial evaluation logging from pipeline)
CREATE POLICY "service_role_insert_eval_history" ON evaluation_history
  FOR INSERT
  WITH CHECK (true);

-- ============================================
-- 1D. Postgres function: apply_evaluation
-- ============================================

CREATE OR REPLACE FUNCTION apply_evaluation(
  eval_id UUID,
  applied_by_user TEXT
)
RETURNS JSONB AS $$
DECLARE
  eval_row evaluation_history%ROWTYPE;
  updated_interaction interactions%ROWTYPE;
BEGIN
  -- 1. Read the candidate evaluation row
  SELECT * INTO eval_row
    FROM evaluation_history
    WHERE id = eval_id
      AND status = 'candidate';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation not found or not in candidate status';
  END IF;

  -- 2. Update the interactions row with candidate values
  UPDATE interactions SET
    name = COALESCE(eval_row.candidate_name, name),
    address = COALESCE(eval_row.candidate_address, address),
    raw_issue_text = COALESCE(eval_row.candidate_intent, raw_issue_text),
    department = COALESCE(eval_row.candidate_department, department),
    issue_summary = COALESCE(eval_row.candidate_summary, issue_summary)
  WHERE id = eval_row.interaction_id
  RETURNING * INTO updated_interaction;

  -- 3. Set the evaluation status to 'applied'
  UPDATE evaluation_history SET
    status = 'applied',
    applied_at = NOW(),
    applied_by = applied_by_user
  WHERE id = eval_id;

  -- 4. Mark all other 'candidate' evaluations for this interaction as 'superseded'
  UPDATE evaluation_history SET
    status = 'superseded'
  WHERE interaction_id = eval_row.interaction_id
    AND id != eval_id
    AND status = 'candidate';

  -- Return both the updated interaction and evaluation
  RETURN jsonb_build_object(
    'interaction_id', updated_interaction.id,
    'evaluation_id', eval_id,
    'applied_at', NOW(),
    'applied_by', applied_by_user
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
