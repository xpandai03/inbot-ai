-- SMS consent: persisted and gated before any outbound SMS
-- true = explicit opt-in, false = opt-out or unclear, null = not asked / legacy

ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN interactions.sms_consent IS 'SMS consent: true=opt-in, false=opt-out/unclear, null=not asked/legacy. No SMS unless true.';
