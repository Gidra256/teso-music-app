-- One-shot atomic migration. A duplicate run fails at CREATE TABLE and rolls back;
-- do not use IF NOT EXISTS to silently accept a partial or incompatible schema.
begin;

-- Run as the backend's trusted database owner, never a Supabase API role.
do $$ begin
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'Migration 006 requires a trusted database owner, not an API role';
  end if;
  -- Identity creation otherwise silently chooses a suffixed sequence name.
  if to_regclass('tesohub_music.admin_accounts') is null
    and to_regclass('tesohub_music.admin_accounts_id_seq') is not null then
    raise exception 'Migration 006: Admin identity sequence name already exists; inspect schema drift';
  end if;
end $$;

create table tesohub_music.admin_accounts (
  id bigint generated always as identity primary key,
  display_name text not null check (length(btrim(display_name)) between 2 and 100),
  login_identifier text not null unique check (login_identifier = lower(btrim(login_identifier)) and login_identifier ~ '^[a-z0-9][a-z0-9._@+-]{2,119}$'),
  password_hash text not null check (password_hash like 'scrypt$%'),
  role text not null check (role in ('super_admin','content_admin','moderator','support_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create index admin_accounts_active_role on tesohub_music.admin_accounts(role) where active;

create table tesohub_music.admin_sessions (
  token_hash text primary key check (length(token_hash) = 64),
  admin_id bigint references tesohub_music.admin_accounts(id) on delete restrict,
  break_glass boolean not null default false,
  recovery_key_hash text,
  preview_hash text unique,
  preview_expires_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check ((admin_id is not null and not break_glass and recovery_key_hash is null) or
         (admin_id is null and break_glass and recovery_key_hash is not null)),
  check (expires_at > created_at)
);
create index admin_sessions_account on tesohub_music.admin_sessions(admin_id);
create index admin_sessions_expiry on tesohub_music.admin_sessions(expires_at);

-- Bounded, shared login throttling; hashed identifiers only, never passwords.
create table tesohub_music.admin_login_limits (
  key_hash text primary key,
  attempts integer not null,
  window_start timestamptz not null default now()
);
create index admin_login_limits_age on tesohub_music.admin_login_limits(window_start);

alter table tesohub_music.admin_accounts enable row level security;
alter table tesohub_music.admin_sessions enable row level security;
alter table tesohub_music.admin_login_limits enable row level security;
-- Restrictive deny also survives an accidental later permissive policy/grant.
-- Owners retain direct SQL access; do not FORCE RLS on the backend owner.
create policy admin_accounts_client_deny on tesohub_music.admin_accounts
  as restrictive for all to public using (false) with check (false);
create policy admin_sessions_client_deny on tesohub_music.admin_sessions
  as restrictive for all to public using (false) with check (false);
create policy admin_login_limits_client_deny on tesohub_music.admin_login_limits
  as restrictive for all to public using (false) with check (false);
revoke all on tesohub_music.admin_accounts, tesohub_music.admin_sessions, tesohub_music.admin_login_limits from public;
revoke all on sequence tesohub_music.admin_accounts_id_seq from public;
-- No client allow policies. Access is exclusively through the backend SQL owner.
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on tesohub_music.admin_accounts, tesohub_music.admin_sessions, tesohub_music.admin_login_limits from anon;
    revoke all on sequence tesohub_music.admin_accounts_id_seq from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on tesohub_music.admin_accounts, tesohub_music.admin_sessions, tesohub_music.admin_login_limits from authenticated;
    revoke all on sequence tesohub_music.admin_accounts_id_seq from authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname='service_role') then
    revoke all on tesohub_music.admin_accounts, tesohub_music.admin_sessions, tesohub_music.admin_login_limits from service_role;
    revoke all on sequence tesohub_music.admin_accounts_id_seq from service_role;
  end if;
end $$;

-- Fail the whole transaction if custom memberships/defaults still confer access.
-- Do not revoke unrelated roles or change database-wide default privileges.
do $$ begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join pg_roles r
    where n.nspname='tesohub_music'
      and r.rolname in ('anon','authenticated','service_role')
      and case
        when c.relname in ('admin_accounts','admin_sessions','admin_login_limits') and c.relkind='r'
          then has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        when c.relname='admin_accounts_id_seq' and c.relkind='S'
          then has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')
        else false
      end
  ) then
    raise exception 'Migration 006: API role retains Admin object privileges; inspect role memberships';
  end if;
end $$;
commit;
