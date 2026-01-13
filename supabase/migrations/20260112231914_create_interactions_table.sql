-- Phase 1: Create interactions table
-- This is the canonical schema for voice/SMS intake records

-- Create the interactions table
CREATE TABLE IF NOT EXISTS interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('voice', 'sms')),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT,
    raw_issue_text TEXT,
    issue_summary TEXT,
    department TEXT,
    language TEXT DEFAULT 'English',
    duration_seconds INTEGER DEFAULT 0,
    cost_estimate NUMERIC(10, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comment to table for documentation
COMMENT ON TABLE interactions IS 'Phase 1 canonical table for voice/SMS intake records';

-- Create indexes for dashboard performance
CREATE INDEX IF NOT EXISTS idx_interactions_client_id ON interactions(client_id);
CREATE INDEX IF NOT EXISTS idx_interactions_created_at ON interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_department ON interactions(department);

-- Composite index for common query patterns (client + time range)
CREATE INDEX IF NOT EXISTS idx_interactions_client_created ON interactions(client_id, created_at DESC);
