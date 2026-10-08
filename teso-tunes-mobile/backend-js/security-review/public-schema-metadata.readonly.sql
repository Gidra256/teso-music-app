-- Operator-run READ-ONLY metadata only; no row data, function bodies or credentials.
begin read only;
set local statement_timeout = '15s';

select current_user as inspecting_role, current_setting('server_version') as postgres_version,
       current_setting('search_path') as search_path;

-- ALL public relations plus authoritative application relations for ACL comparison.
select n.nspname as schema_name,c.relname,c.relkind,pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,r.rolname,
       has_schema_privilege(r.oid,n.oid,'USAGE') as schema_usage,
       has_table_privilege(r.oid,c.oid,'SELECT') as can_select,
       has_table_privilege(r.oid,c.oid,'INSERT') as can_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') as can_update,
       has_table_privilege(r.oid,c.oid,'DELETE') as can_delete,
       has_table_privilege(r.oid,c.oid,'TRUNCATE') as can_truncate,
       has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') as any_column_access
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join pg_roles r
where n.nspname in ('public','tesohub_music') and c.relkind in ('r','p','v','m','f')
  and r.rolname in ('anon','authenticated','service_role')
order by n.nspname,c.relname,r.rolname;

-- Column names/types only: never SELECT table contents or column default values.
select n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod) as type,
       a.attnotnull,a.attidentity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
where n.nspname='public' and c.relkind in ('r','p','v','m','f')
order by c.relname,a.attnum;

select schemaname,tablename,policyname,permissive,roles,cmd
from pg_policies where schemaname in ('public','tesohub_music') order by schemaname,tablename,policyname;

-- Inspect locally for the separate public.songs review; do not share private constants.
select policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename='songs' order by policyname;

-- ACL entries including PUBLIC and column-specific grants.
select n.nspname,c.relname,case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
       x.privilege_type,x.is_grantable
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) x
where n.nspname='public' and c.relkind in ('r','p','v','m','f','S') order by c.relname,grantee,x.privilege_type;
select c.relname,a.attname,case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,x.privilege_type
from pg_class c join pg_namespace n on n.oid=c.relnamespace
join pg_attribute a on a.attrelid=c.oid and a.attnum>0
cross join lateral aclexplode(a.attacl) x where n.nspname='public';

select rolname,rolsuper,rolbypassrls,rolinherit from pg_roles
where rolname in ('anon','authenticated','service_role',current_user);
select pg_get_userbyid(member) as member,pg_get_userbyid(roleid) as granted_role,admin_option,inherit_option,set_option
from pg_auth_members order by member,granted_role;

-- Function metadata only. These SELECTs never invoke either function.
select p.oid::regprocedure::text as function_signature,pg_get_userbyid(p.proowner) as owner,
       l.lanname,p.prosecdef as security_definer,
       array(select v from unnest(p.proconfig) v where v like 'search_path=%') as configured_search_path,
       r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE') as executable,
       p.prosrc ~* '\m(profiles|likes|follows|song_plays)\M' as mentions_target_name
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
cross join pg_roles r
where n.nspname='public' and r.rolname in ('anon','authenticated','service_role')
  and (p.proname in ('handle_new_user','increment_song_plays') or p.prosrc ~* '\m(profiles|likes|follows|song_plays)\M')
order by function_signature,r.rolname;

select t.tgname,t.tgenabled,t.tgrelid::regclass::text as on_relation,t.tgfoid::regprocedure::text as invokes
from pg_trigger t join pg_proc p on p.oid=t.tgfoid
where not t.tgisinternal and (p.proname in ('handle_new_user','increment_song_plays')
  or t.tgrelid in (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='public' and c.relname in ('profiles','likes','follows','song_plays','songs')));

-- Catalog dependencies do NOT detect all PL/pgSQL/dynamic SQL or external clients.
select distinct pg_describe_object(d.classid,d.objid,d.objsubid) as dependent,
       pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) as referenced,d.deptype
from pg_depend d where d.refclassid='pg_class'::regclass and d.refobjid in
  (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('profiles','likes','follows','song_plays','songs'));

select pg_get_userbyid(d.defaclrole) as creator_role,
       case when d.defaclnamespace=0 then 'GLOBAL' else n.nspname end as scope,
       d.defaclobjtype,case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
       x.privilege_type,x.is_grantable
from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) x
where d.defaclnamespace=0 or n.nspname in ('public','tesohub_music');
rollback;
