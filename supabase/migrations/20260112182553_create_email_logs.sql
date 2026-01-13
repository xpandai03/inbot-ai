-- Email send audit log table
-- Tracks all email sending attempts for debugging and audit

CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interaction_id UUID REFERENCES interactions(id) ON DELETE CASCADE,
    department TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    cc_email TEXT,
    status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding logs by interaction
CREATE INDEX idx_email_logs_interaction
    ON email_logs(interaction_id);

-- Index for filtering by status
CREATE INDEX idx_email_logs_status
    ON email_logs(status, created_at DESC);
