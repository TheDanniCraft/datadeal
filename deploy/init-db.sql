\getenv app_password DATADEAL_DB_PASSWORD
CREATE ROLE datadeal_app LOGIN PASSWORD :'app_password';
REVOKE ALL ON DATABASE datadeal FROM PUBLIC;
GRANT CONNECT ON DATABASE datadeal TO datadeal_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO datadeal_app;
