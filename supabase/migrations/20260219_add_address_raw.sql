-- Add address_raw column to store pre-normalization spoken address
-- Additive-only migration — no existing data changes

ALTER TABLE interactions ADD COLUMN IF NOT EXISTS address_raw TEXT;

-- ============================================
-- Update apply_evaluation RPC to also set address_raw from extraction_meta
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
    address_raw = COALESCE(eval_row.extraction_meta->>'candidateAddressRaw', address_raw),
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
