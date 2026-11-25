import "./migrate.mjs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  // PostgreSQL executes the whole block as one statement and transaction.
  // Rerunning after a migration includes tables and sequences added since the last run.
  await sql`
    do $grants$
    declare
      app_table record;
    begin
      revoke all privileges on table public.datadeal_schema_migrations from datadeal_app;
      if has_table_privilege('datadeal_app', 'public.datadeal_schema_migrations',
                             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'Application role has inherited privileges on the migration ledger';
      end if;
      for app_table in
        select c.relname
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p')
          and c.relname <> 'datadeal_schema_migrations'
      loop
        execute format('grant select, insert, update, delete on table public.%I to datadeal_app',
                       app_table.relname);
      end loop;
      grant usage on all sequences in schema public to datadeal_app;
    end
    $grants$
  `;
  console.log("Application table and sequence grants applied");
} finally {
  await sql.end();
}
