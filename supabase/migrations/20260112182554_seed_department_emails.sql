-- Seed department email mappings for Phase 1 testing
-- These are test emails that will be replaced with real client emails later

INSERT INTO department_emails (client_id, department, email, cc_email) VALUES
    ('client_demo', 'Public Works', 'raunek@xpandai.com', 'raunek@xpandai.com'),
    ('client_demo', 'Public Safety', 'raunek@xpandholdings.com', 'raunek@xpandai.com'),
    ('client_demo', 'Finance', 'developer@xpandai.com', 'raunek@xpandai.com'),
    ('client_demo', 'Parks & Public Property', 'raunekp@gmail.com', 'raunek@xpandai.com'),
    ('client_demo', 'Parks & Recreation', 'raunekp@gmail.com', 'raunek@xpandai.com'),
    ('client_demo', 'Sanitation', 'raunek@xpandai.com', 'raunek@xpandai.com'),
    ('client_demo', 'Utilities', 'developer@xpandai.com', 'raunek@xpandai.com'),
    ('client_demo', 'General', 'raunek@xpandai.com', 'raunek@xpandai.com')
ON CONFLICT (client_id, department) DO UPDATE SET
    email = EXCLUDED.email,
    cc_email = EXCLUDED.cc_email,
    updated_at = NOW();
