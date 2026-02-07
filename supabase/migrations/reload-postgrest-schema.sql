-- Run this in the Supabase SQL Editor after any DDL migration
-- (e.g. after adding sms_consent column) to refresh PostgREST's schema cache.
-- Without this, PostgREST returns PGRST204: "Could not find column in schema cache"

NOTIFY pgrst, 'reload schema';
