-- Phase 2A Final Polish: Address quality flags + needs_review indicator
-- Additive-only migration — no existing data changes beyond backfill

-- ============================================
-- Add address_quality and needs_review columns
-- ============================================

ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS address_quality TEXT DEFAULT 'missing'
    CHECK (address_quality IN ('complete', 'partial', 'intersection', 'approximate', 'missing')),
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false;

-- ============================================
-- Backfill existing records
-- ============================================
-- Derive address_quality from the address string
-- Derive needs_review from address_quality + name

UPDATE interactions SET
  address_quality = CASE
    WHEN address IS NULL OR address = '' OR address = 'Not provided' THEN 'missing'
    WHEN address LIKE '%&%' AND address LIKE '%(Approximate)%' THEN 'intersection'
    WHEN address LIKE '%(Approximate)%' THEN 'approximate'
    WHEN address ~ '^\d' AND array_length(string_to_array(trim(address), ' '), 1) >= 2 THEN 'complete'
    WHEN address IS NOT NULL AND address != '' AND address != 'Not provided' THEN 'partial'
    ELSE 'missing'
  END,
  needs_review = CASE
    WHEN address IS NULL OR address = '' OR address = 'Not provided' THEN true
    WHEN address LIKE '%(Approximate)%' AND address NOT LIKE '%&%' THEN true
    WHEN name IS NULL OR name = '' OR name = 'Not provided' OR name = 'Unknown Caller' THEN true
    ELSE false
  END;

-- ============================================
-- Update apply_evaluation to also set quality flags
-- ============================================
-- After applying an evaluation, re-derive address_quality and needs_review
-- from the updated record values. This keeps the flags consistent.

CREATE OR REPLACE FUNCTION apply_evaluation(
  eval_id UUID,
  applied_by_user TEXT
)
RETURNS JSONB AS $$
DECLARE
  eval_row evaluation_history%ROWTYPE;
  updated_interaction interactions%ROWTYPE;
  new_address TEXT;
  new_name TEXT;
  new_quality TEXT;
  new_review BOOLEAN;
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

  -- 3. Re-derive address_quality from the updated address
  new_address := updated_interaction.address;
  new_name := updated_interaction.name;

  new_quality := CASE
    WHEN new_address IS NULL OR new_address = '' OR new_address = 'Not provided' THEN 'missing'
    WHEN new_address LIKE '%&%' AND new_address LIKE '%(Approximate)%' THEN 'intersection'
    WHEN new_address LIKE '%(Approximate)%' THEN 'approximate'
    WHEN new_address ~ '^\d' AND array_length(string_to_array(trim(new_address), ' '), 1) >= 2 THEN 'complete'
    WHEN new_address IS NOT NULL AND new_address != '' AND new_address != 'Not provided' THEN 'partial'
    ELSE 'missing'
  END;

  -- 4. Re-derive needs_review
  new_review := CASE
    WHEN new_quality IN ('missing', 'approximate') THEN true
    WHEN new_name IS NULL OR new_name = '' OR new_name = 'Not provided' OR new_name = 'Unknown Caller' THEN true
    ELSE false
  END;

  -- 5. Update the quality flags
  UPDATE interactions SET
    address_quality = new_quality,
    needs_review = new_review
  WHERE id = eval_row.interaction_id;

  -- 6. Set the evaluation status to 'applied'
  UPDATE evaluation_history SET
    status = 'applied',
    applied_at = NOW(),
    applied_by = applied_by_user
  WHERE id = eval_id;

  -- 7. Mark all other 'candidate' evaluations for this interaction as 'superseded'
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
