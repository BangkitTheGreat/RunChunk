-- BYPASSRLS does not grant table privileges. Do not rely on project defaults.
grant select, insert, update on public.executions, public.execution_logs to service_role;
grant usage on sequence public.execution_logs_id_seq to service_role;
