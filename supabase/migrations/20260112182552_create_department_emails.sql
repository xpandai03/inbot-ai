-- Department email routing configuration table
-- Maps departments to recipient emails for each client

CREATE TABLE IF NOT EXISTS department_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    department TEXT NOT NULL,
    email TEXT NOT NULL,
    cc_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, department)
);

-- Index for fast lookups by client and department
CREATE INDEX idx_department_emails_lookup
    ON department_emails(client_id, department);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_department_emails_updated_at
    BEFORE UPDATE ON department_emails
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
