-- Local development bootstrap. Idempotent. Run by `pnpm db:bootstrap` as the Docker superuser.
-- Creates the least-privilege roles described in docs/PHASE-2-PLAN.md section 4.4:
--   matilda_owner : owns the schema, runs migrations (DDL). Never used by the running API.
--   matilda_app   : runtime role used by the API. DML only, no DDL, NOBYPASSRLS.
-- Passwords are DEV-ONLY defaults supplied by the caller; production uses real secrets.
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE matilda_owner LOGIN CREATEDB NOSUPERUSER NOBYPASSRLS PASSWORD %L', :'owner_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matilda_owner') \gexec
SELECT format('ALTER ROLE matilda_owner PASSWORD %L', :'owner_pw') \gexec

SELECT format('CREATE ROLE matilda_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matilda_app') \gexec
SELECT format('ALTER ROLE matilda_app PASSWORD %L', :'app_pw') \gexec

SELECT 'CREATE DATABASE matilda_test OWNER matilda_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'matilda_test') \gexec
ALTER DATABASE matilda_dev OWNER TO matilda_owner;

-- ---- matilda_dev ----
\connect matilda_dev
REVOKE ALL ON DATABASE matilda_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE matilda_dev TO matilda_app, matilda_owner;
ALTER SCHEMA public OWNER TO matilda_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO matilda_app;
ALTER DEFAULT PRIVILEGES FOR ROLE matilda_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO matilda_app;
ALTER DEFAULT PRIVILEGES FOR ROLE matilda_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO matilda_app;

-- ---- matilda_test ----
\connect matilda_test
REVOKE ALL ON DATABASE matilda_test FROM PUBLIC;
GRANT CONNECT ON DATABASE matilda_test TO matilda_app, matilda_owner;
ALTER SCHEMA public OWNER TO matilda_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO matilda_app;
ALTER DEFAULT PRIVILEGES FOR ROLE matilda_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO matilda_app;
ALTER DEFAULT PRIVILEGES FOR ROLE matilda_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO matilda_app;
