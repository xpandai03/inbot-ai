-- Enable Row Level Security for data isolation
-- Super admins can see all data, client admins only see their client's data
-- Service role (used by webhook) bypasses RLS automatically

-- ============================================
-- INTERACTIONS TABLE
-- ============================================

ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;

-- Policy: Super admins can SELECT all records
CREATE POLICY "super_admin_select_all" ON interactions
    FOR SELECT
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'super_admin'
    );

-- Policy: Client admins can SELECT only their client's records
CREATE POLICY "client_admin_select_own" ON interactions
    FOR SELECT
    USING (
        client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id')
    );

-- Policy: Service role can INSERT (for webhook ingestion)
-- Note: Service role bypasses RLS by default, but this makes it explicit
CREATE POLICY "service_role_insert" ON interactions
    FOR INSERT
    WITH CHECK (true);

-- ============================================
-- DEPARTMENT_EMAILS TABLE
-- ============================================

ALTER TABLE department_emails ENABLE ROW LEVEL SECURITY;

-- Policy: Super admins can SELECT all department emails
CREATE POLICY "super_admin_select_all_emails" ON department_emails
    FOR SELECT
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'super_admin'
    );

-- Policy: Client admins can SELECT/UPDATE their own department emails
CREATE POLICY "client_admin_manage_own_emails" ON department_emails
    FOR ALL
    USING (
        client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id')
    )
    WITH CHECK (
        client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id')
    );

-- ============================================
-- EMAIL_LOGS TABLE
-- ============================================

ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Super admins can SELECT all email logs
CREATE POLICY "super_admin_select_all_logs" ON email_logs
    FOR SELECT
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'super_admin'
    );

-- Policy: Client admins can SELECT logs for their interactions
CREATE POLICY "client_admin_select_own_logs" ON email_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM interactions i
            WHERE i.id = email_logs.interaction_id
            AND i.client_id = (auth.jwt() -> 'user_metadata' ->> 'client_id')
        )
    );

-- Policy: Service role can INSERT email logs
CREATE POLICY "service_role_insert_logs" ON email_logs
    FOR INSERT
    WITH CHECK (true);
