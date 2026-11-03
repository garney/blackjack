-- Create auth.uid() / auth.role() as supabase_auth_admin, not postgres.
-- GoTrue's first migration does CREATE OR REPLACE on these functions.
-- If postgres owns them, Auth crash-loops:
--   ERROR: must be owner of function uid (SQLSTATE 42501)
-- App migrations also reference auth.uid() in RLS, so stubs must exist
-- before GoTrue has finished its own schema.

SET ROLE supabase_auth_admin;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

RESET ROLE;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
