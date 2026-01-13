-- Phase 1 Seed Data
-- Sample interaction records for testing

INSERT INTO interactions (
    client_id,
    channel,
    name,
    phone,
    address,
    raw_issue_text,
    issue_summary,
    department,
    language,
    duration_seconds,
    cost_estimate,
    created_at
) VALUES
(
    'client_demo',
    'voice',
    'Margaret Chen',
    '(555) 123-4567',
    '1247 Oak Street, Springfield, IL 62701',
    'Pothole Report',
    'Caller reported a large pothole on Oak Street near the intersection with Main. Requested repair within the week.',
    'Public Works',
    'English',
    187,
    0.42,
    NOW() - INTERVAL '2 hours'
),
(
    'client_demo',
    'sms',
    'Robert Williams',
    '(555) 234-5678',
    '892 Maple Avenue, Springfield, IL 62702',
    'Trash Pickup',
    'Resident inquired about missed trash collection on Monday. Scheduled for next-day pickup.',
    'Sanitation',
    'English',
    45,
    0.08,
    NOW() - INTERVAL '1 hour'
),
(
    'client_demo',
    'voice',
    'Elena Rodriguez',
    '(555) 345-6789',
    '456 Pine Road, Springfield, IL 62703',
    'Water Bill Inquiry',
    'Caller had questions about recent water bill increase. Explained seasonal rate adjustment and payment options.',
    'Utilities',
    'Spanish',
    234,
    0.53,
    NOW() - INTERVAL '30 minutes'
);
