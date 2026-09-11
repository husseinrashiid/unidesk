-- UniDesk's optional synchronization layer. Run as the database administrator.
create table public.unidesk_entity_schema(entity text primary key, descriptor jsonb not null);
create table public.unidesk_devices (
 owner uuid not null references auth.users(id) on delete cascade,
 id text not null, name text not null, platform text not null, app_version text not null,
 registered_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), primary key(owner,id)
);
create table public.unidesk_revisions (
 version bigint generated always as identity primary key,
 owner uuid not null references auth.users(id) on delete cascade,
 entity text not null references public.unidesk_entity_schema(entity), record_key text not null,
 payload jsonb, device_id text not null, mutation text not null,
 created_at timestamptz not null default now(), unique(owner,device_id,mutation)
);
create table public.unidesk_records (
 owner uuid not null references auth.users(id) on delete cascade,
 entity text not null references public.unidesk_entity_schema(entity), record_key text not null,
 payload jsonb, version bigint not null, origin_device_id text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
 primary key(owner,entity,record_key)
);
create index unidesk_records_cursor on public.unidesk_records(owner,version);
alter table public.unidesk_entity_schema enable row level security;
alter table public.unidesk_devices enable row level security;
alter table public.unidesk_revisions enable row level security;
alter table public.unidesk_records enable row level security;
create policy own_devices on public.unidesk_devices for select to authenticated using(owner=auth.uid());
create policy own_records on public.unidesk_records for select to authenticated using(owner=auth.uid());
create policy own_revisions on public.unidesk_revisions for select to authenticated using(owner=auth.uid());
revoke all on public.unidesk_entity_schema,public.unidesk_devices,public.unidesk_records,public.unidesk_revisions from anon,authenticated;
grant select on public.unidesk_devices,public.unidesk_records,public.unidesk_revisions to authenticated;

create function public.unidesk_sync(p_route text,p_body jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 owner_id uuid:=auth.uid(); device text:=p_body->>'device'; c jsonb; s jsonb; k jsonb; p jsonb;
 current_row public.unidesk_records; replay public.unidesk_revisions; v bigint; cursor_value bigint;
 accepted jsonb:='[]'; conflicts jsonb:='[]'; result jsonb; item jsonb; column_name text; relation jsonb; parent jsonb;
begin
 if owner_id is null then raise exception 'Authentication required'; end if;
 if p_body->>'protocol' is distinct from '1' or device is null or device !~ '^[a-zA-Z0-9-]{16,80}$' then raise exception 'Invalid sync protocol/device'; end if;
 -- Serialize one owner's writes without relying on device clocks.
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 insert into public.unidesk_devices(owner,id,name,platform,app_version)
 values(owner_id,device,left(coalesce(p_body->>'name','UniDesk'),100),left(coalesce(p_body->>'platform','unknown'),32),left(coalesce(p_body->>'appVersion',''),40))
 on conflict(owner,id) do update set name=excluded.name,platform=excluded.platform,app_version=excluded.app_version,last_seen_at=now();
 if p_route='info' then
  return jsonb_build_object('workspace',encode(sha256(convert_to(owner_id::text,'UTF8')),'hex'),'protocol',1,'devices',
   (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'platform',platform,'appVersion',app_version,'registeredAt',registered_at,'lastSeenAt',last_seen_at)),'[]') from public.unidesk_devices where owner=owner_id));
 elsif p_route='push' then
  if jsonb_typeof(p_body->'changes') is distinct from 'array' or jsonb_array_length(p_body->'changes')>10000 or octet_length(p_body::text)>32000000 then raise exception 'Invalid change batch'; end if;
  if (select count(*) from jsonb_array_elements(p_body->'changes'))<>(select count(distinct (x->>'table',x->>'key')) from jsonb_array_elements(p_body->'changes') x) then raise exception 'Duplicate record'; end if;
  for c in select * from jsonb_array_elements(p_body->'changes') loop
   select descriptor into s from public.unidesk_entity_schema where entity=c->>'table';
   if s is null then raise exception 'Unsupported entity'; end if;
   k:=(c->>'key')::jsonb;p:=nullif(c->'payload','null');
   if jsonb_typeof(k) is distinct from 'array' or jsonb_array_length(k)<>jsonb_array_length(s->'keys') or length(c->>'mutation')>1200 or c->>'mutation' is null or coalesce(c->>'mutation','')='' or c->>'base' is null or (c->>'base')::bigint<0 then raise exception 'Invalid identity/version'; end if;
   if exists(select 1 from jsonb_array_elements(k) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 300) then raise exception 'Invalid record key'; end if;
   if c->>'key' <> (select '['||string_agg(to_jsonb(x#>>'{}')::text,',' order by ord)||']' from jsonb_array_elements(k) with ordinality t(x,ord)) then raise exception 'Noncanonical key'; end if;
   if c->>'table'='synced_preferences' and k->>0 not in ('week_start','default_reminder_minutes') then raise exception 'Device-only setting'; end if;
   select * into replay from public.unidesk_revisions where owner=owner_id and device_id=device and mutation=c->>'mutation';
   select * into current_row from public.unidesk_records where owner=owner_id and entity=c->>'table' and record_key=c->>'key';
   if p is not null then
    if jsonb_typeof(p)<>'object' then raise exception 'Invalid record'; end if;
    for column_name in select jsonb_array_elements_text(s->'columns') loop
     if not p ? column_name then raise exception 'Incomplete record'; end if;
    end loop;
    for column_name in select jsonb_object_keys(p) loop
     if not (s->'columns') ? column_name and not(c->>'table'='files' and column_name='_blob') then raise exception 'Unsupported field'; end if;
     if jsonb_typeof(p->column_name) not in ('string','number','null') then raise exception 'Invalid scalar'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements_text(s->'keys') with ordinality t(key,ord) where p->key is distinct from k->(ord::int-1)) then raise exception 'Mismatched identity'; end if;
    if c->>'table'='files' and coalesce(p->>'_blob','') !~ '^[a-f0-9]{64}$' then raise exception 'Missing content hash'; end if;
    if c->>'table'='synced_preferences' and p->>'id' not in ('week_start','default_reminder_minutes') then raise exception 'Device-only setting'; end if;
    if replay.version is null and coalesce(current_row.version,0)=(c->>'base')::bigint then
    for relation in select * from jsonb_array_elements(s->'foreign') loop
     if nullif(p->(relation->>'column'),'null') is null then continue; end if;
     select nullif(x->'payload','null') into parent from jsonb_array_elements(p_body->'changes') x where x->>'table'=relation->>'table' and (x->>'key')::jsonb=jsonb_build_array(p->(relation->>'column'));
     if not found then select payload into parent from public.unidesk_records where owner=owner_id and entity=relation->>'table' and record_key::jsonb=jsonb_build_array(p->(relation->>'column'));end if;
     if parent is null then raise exception 'Related record missing or deleted; restore the parent or remove the pending child'; end if;
    end loop;
    end if;
   end if;
   select * into replay from public.unidesk_revisions where owner=owner_id and device_id=device and mutation=c->>'mutation';
   if found then
    if replay.entity<>c->>'table' or replay.record_key<>c->>'key' or replay.payload is distinct from p then raise exception 'Mutation reused'; end if;
   else
    select * into current_row from public.unidesk_records where owner=owner_id and entity=c->>'table' and record_key=c->>'key';
    if coalesce(current_row.version,0)<>(c->>'base')::bigint then
     if current_row.version is null then raise exception 'Invalid base version';end if;
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('table',current_row.entity,'key',current_row.record_key,'payload',current_row.payload,'version',current_row.version));
    end if;
   end if;
  end loop;
  if jsonb_array_length(conflicts)>0 then return jsonb_build_object('accepted','[]'::jsonb,'conflicts',conflicts);end if;
  for c in select * from jsonb_array_elements(p_body->'changes') loop
   p:=nullif(c->'payload','null');
   select * into replay from public.unidesk_revisions where owner=owner_id and device_id=device and mutation=c->>'mutation';
   if found then v:=replay.version;
   else
    insert into public.unidesk_revisions(owner,entity,record_key,payload,device_id,mutation) values(owner_id,c->>'table',c->>'key',p,device,c->>'mutation') returning version into v;
    insert into public.unidesk_records(owner,entity,record_key,payload,version,origin_device_id,deleted_at)
     values(owner_id,c->>'table',c->>'key',p,v,device,case when p is null then now() end)
     on conflict(owner,entity,record_key) do update set payload=excluded.payload,version=excluded.version,origin_device_id=excluded.origin_device_id,updated_at=now(),deleted_at=excluded.deleted_at;
   end if;
   accepted:=accepted||jsonb_build_array(jsonb_build_object('table',c->>'table','key',c->>'key','payload',p,'version',v));
  end loop;
  return jsonb_build_object('accepted',accepted,'conflicts','[]'::jsonb);
 elsif p_route='pull' then
  select coalesce(max(version),0) into cursor_value from public.unidesk_records where owner=owner_id;
  if p_body->>'cursor' is null or (p_body->>'cursor')::bigint<0 or (p_body->>'cursor')::bigint>cursor_value then raise exception 'Invalid or restored server cursor';end if;
  select coalesce(jsonb_agg(jsonb_build_object('table',entity,'key',record_key,'payload',payload,'version',version) order by version),'[]') into result
   from public.unidesk_records where owner=owner_id and version>(p_body->>'cursor')::bigint;
  if octet_length(result::text)>32000000 then raise exception 'Response limit exceeded';end if;
  return jsonb_build_object('records',result,'cursor',cursor_value);
 end if;
 raise exception 'Unknown sync route';
end $$;
revoke all on function public.unidesk_sync(text,jsonb) from public,anon;
grant execute on function public.unidesk_sync(text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit) values('unidesk-files','unidesk-files',false,100000000) on conflict(id) do nothing;
create policy unidesk_blob_read on storage.objects for select to authenticated using(bucket_id='unidesk-files' and (storage.foldername(name))[1]=auth.uid()::text);
create policy unidesk_blob_create on storage.objects for insert to authenticated with check(bucket_id='unidesk-files' and (storage.foldername(name))[1]=auth.uid()::text and name ~ '^[a-f0-9-]{36}/[a-f0-9]{64}$');
-- Blobs are immutable: no client update/delete policy. Revisions/tombstones retain
-- their referenced content until an administrator implements a safe retention policy.
