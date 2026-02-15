-- Add Planning and Zoning department email mapping
-- Phase 2A: Construction/permit/zoning routing

INSERT INTO department_emails (client_id, department, email, cc_email) VALUES
    ('client_demo', 'Planning and Zoning', 'raunek@xpandai.com', 'raunek@xpandai.com')
ON CONFLICT (client_id, department) DO UPDATE SET
    email = EXCLUDED.email,
    cc_email = EXCLUDED.cc_email,
    updated_at = NOW();
