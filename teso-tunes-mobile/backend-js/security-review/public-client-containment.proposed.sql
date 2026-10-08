-- PROPOSAL ONLY. Not a migration, not wired into deployment.
-- REVIEWED SCOPE: four exposed tables and two reported unused SECURITY INVOKER functions.
-- Operator approval and fresh preflight required. public.songs is deliberately untouched.
-- Direct SQL owner/BYPASSRLS access remains; unrelated non-owner application roles
-- require separate review. This does NOT close SECURITY DEFINER RPC/view bypasses.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare
  table_name text;
  target oid;
  client_role text;
  column_names text;
  seq record;
  signature text;
  routine oid;
begin
  -- Fail closed on signature/security/trigger drift rather than silently missing an RPC.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('handle_new_user','increment_song_plays')) <> 2 then
    raise exception 'Containment preflight: unexpected function overloads or missing functions';
  end if;
  foreach signature in array array['public.handle_new_user()','public.increment_song_plays(uuid)'] loop
    routine := to_regprocedure(signature);
    if routine is null or not exists(select 1 from pg_proc where oid=routine and prokind='f' and not prosecdef) then
      raise exception 'Containment preflight: expected SECURITY INVOKER function %', signature;
    end if;
    if exists(select 1 from pg_trigger where tgfoid=routine and not tgisinternal) then
      raise exception 'Containment preflight: function now has a trigger dependency: %', signature;
    end if;
    if exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
              where p.oid=routine and r.rolname in ('anon','authenticated')) then
      raise exception 'Containment preflight: client role owns function %', signature;
    end if;
  end loop;
  foreach table_name in array array['profiles','likes','follows','song_plays'] loop
    target := to_regclass(format('public.%I', table_name));
    if target is null or not exists(select 1 from pg_class where oid=target and relkind='r') then
      raise exception 'Containment preflight: expected ordinary public table %', table_name;
    end if;
    if exists(select 1 from pg_inherits where inhrelid=target or inhparent=target) then
      raise exception 'Containment preflight: inheritance/partition review required for %', table_name;
    end if;
    if exists(select 1 from pg_class c join pg_roles r on r.oid=c.relowner
              where c.oid=target and r.rolname in ('anon','authenticated')) then
      raise exception 'Containment preflight: client role owns %', table_name;
    end if;

    execute format('alter table public.%I enable row level security', table_name);
    -- Existing permissive policies cannot defeat this ordinary-client deny.
    execute format('create policy emergency_client_isolation on public.%I as restrictive for all to public using(false) with check(false)', table_name);
    execute format('revoke all privileges on table public.%I from public', table_name);
    select string_agg(format('%I',attname), ',') into column_names
      from pg_attribute where attrelid=target and attnum>0 and not attisdropped;
    execute format('revoke all privileges (%s) on table public.%I from public', column_names, table_name);
    for client_role in select rolname from pg_roles where rolname in ('anon','authenticated') loop
      execute format('revoke all privileges on table public.%I from %I', table_name, client_role);
      execute format('revoke all privileges (%s) on table public.%I from %I', column_names, table_name, client_role);
      if has_table_privilege(client_role,target,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        or has_any_column_privilege(client_role,target,'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'Containment preflight: inherited client privileges remain on %', table_name;
      end if;
    end loop;
    for seq in
      select s.oid,n.nspname,s.relname from pg_class s
      join pg_namespace n on n.oid=s.relnamespace
      join pg_depend d on d.classid='pg_class'::regclass and d.objid=s.oid
      where s.relkind='S' and d.refclassid='pg_class'::regclass and d.refobjid=target and d.deptype in ('a','i')
    loop
      -- Shared defaults could affect an unknown consumer: stop rather than guess.
      if exists(select 1 from pg_depend d join pg_attrdef a on d.classid='pg_attrdef'::regclass and d.objid=a.oid
                where d.refclassid='pg_class'::regclass and d.refobjid=seq.oid and a.adrelid<>target) then
        raise exception 'Containment preflight: shared sequence dependency requires review';
      end if;
      execute format('revoke all privileges on sequence %I.%I from public',seq.nspname,seq.relname);
      for client_role in select rolname from pg_roles where rolname in ('anon','authenticated') loop
        execute format('revoke all privileges on sequence %I.%I from %I',seq.nspname,seq.relname,client_role);
        if has_sequence_privilege(client_role,seq.oid,'USAGE,SELECT,UPDATE') then
          raise exception 'Containment preflight: inherited client sequence privileges remain';
        end if;
      end loop;
    end loop;
  end loop;
  foreach signature in array array['public.handle_new_user()','public.increment_song_plays(uuid)'] loop
    routine := to_regprocedure(signature);
    execute format('revoke all privileges on function %s from public',signature);
    for client_role in select rolname from pg_roles where rolname in ('anon','authenticated') loop
      execute format('revoke all privileges on function %s from %I',signature,client_role);
      if has_function_privilege(client_role,routine,'EXECUTE') then
        raise exception 'Containment preflight: inherited client EXECUTE remains on %',signature;
      end if;
    end loop;
  end loop;
end $$;
commit;
