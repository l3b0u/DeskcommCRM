-- GRUA-611: conta Zernio deixa de significar apenas número WhatsApp.
alter table public.channel_sessions
  add column if not exists zernio_platform text;

update public.channel_sessions
   set zernio_platform = 'whatsapp'
 where provider = 'zernio' and zernio_platform is null;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_zernio_platform_check;
alter table public.channel_sessions
  add constraint channel_sessions_zernio_platform_check check (
    (provider <> 'zernio' and zernio_platform is null) or
    (provider = 'zernio' and zernio_platform in (
      'instagram','facebook','twitter','bluesky','reddit','telegram','whatsapp','slack',
      'threads','youtube','linkedin','googlebusiness','tiktok','pinterest','snapchat'
    ))
  );

drop index if exists public.channel_sessions_zernio_account_id_ativo_unique;
drop index if exists public.channel_sessions_zernio_conta_ativa_tenant_unique;
with repetidas as (
  select id, row_number() over (partition by zernio_platform, zernio_account_id order by created_at, id) as posicao
  from public.channel_sessions
  where archived_at is null and provider = 'zernio' and zernio_account_id is not null
)
update public.channel_sessions set archived_at = now(), status = 'ARCHIVED'
where id in (select id from repetidas where posicao > 1);
create unique index if not exists channel_sessions_zernio_conta_ativa_global_unique
  on public.channel_sessions (zernio_platform, zernio_account_id)
  where archived_at is null and provider = 'zernio';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_organization_id_id_unique') then
    alter table public.contacts add constraint contacts_organization_id_id_unique unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'channel_sessions_organization_id_id_unique') then
    alter table public.channel_sessions add constraint channel_sessions_organization_id_id_unique unique (organization_id, id);
  end if;
end $$;

create table if not exists public.contact_channel_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  channel_session_id uuid not null,
  provider text not null,
  platform text not null,
  external_user_id text not null,
  username text,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel_session_id, provider, platform, external_user_id)
);
alter table public.contact_channel_identities drop constraint if exists contact_channel_identities_contact_tenant_fkey;
alter table public.contact_channel_identities add constraint contact_channel_identities_contact_tenant_fkey
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade;
alter table public.contact_channel_identities drop constraint if exists contact_channel_identities_session_tenant_fkey;
alter table public.contact_channel_identities add constraint contact_channel_identities_session_tenant_fkey
  foreign key (organization_id, channel_session_id) references public.channel_sessions(organization_id, id) on delete cascade;
create index if not exists contact_channel_identities_contact_tenant_idx
  on public.contact_channel_identities (organization_id, contact_id);
alter table public.contact_channel_identities enable row level security;
drop policy if exists tenant_isolation_contact_channel_identities_all on public.contact_channel_identities;
drop policy if exists tenant_isolation_contact_channel_identities_select on public.contact_channel_identities;
create policy tenant_isolation_contact_channel_identities_select on public.contact_channel_identities
  for select using (organization_id in (select public.fn_user_org_ids()));

create table if not exists public.zernio_webhook_event_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null,
  event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (organization_id, channel_session_id, event_id)
);
alter table public.zernio_webhook_event_receipts drop constraint if exists zernio_webhook_event_receipts_session_tenant_fkey;
alter table public.zernio_webhook_event_receipts add constraint zernio_webhook_event_receipts_session_tenant_fkey
  foreign key (organization_id, channel_session_id) references public.channel_sessions(organization_id, id) on delete cascade;
create index if not exists zernio_webhook_event_receipts_tenant_received_idx
  on public.zernio_webhook_event_receipts (organization_id, received_at desc);
alter table public.zernio_webhook_event_receipts enable row level security;
drop policy if exists tenant_isolation_zernio_webhook_event_receipts_all on public.zernio_webhook_event_receipts;
drop policy if exists tenant_isolation_zernio_webhook_event_receipts_select on public.zernio_webhook_event_receipts;
create policy tenant_isolation_zernio_webhook_event_receipts_select on public.zernio_webhook_event_receipts
  for select using (organization_id in (select public.fn_user_org_ids()));

grant select on public.contact_channel_identities to authenticated;
grant all on public.contact_channel_identities to service_role;
grant select on public.zernio_webhook_event_receipts to authenticated;
grant all on public.zernio_webhook_event_receipts to service_role;

comment on table public.contact_channel_identities is
  'Identidades externas neutras e tenant-safe; IDs sociais nunca são armazenados em contacts.wa_identity.';
comment on table public.zernio_webhook_event_receipts is
  'Deduplicação durável dos eventos Zernio pelo X-Zernio-Event-Id/envelope id.';

create or replace function public.fn_redigir_identidades_de_canal_ao_anonimizar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_anonymized and not old.is_anonymized then
    update public.contact_channel_identities
       set username = null, display_name = null, metadata = '{}'::jsonb, updated_at = now()
     where organization_id = new.organization_id and contact_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_redigir_identidades_de_canal_ao_anonimizar() from public, anon, authenticated;
grant execute on function public.fn_redigir_identidades_de_canal_ao_anonimizar() to service_role;
drop trigger if exists trg_redigir_identidades_de_canal_ao_anonimizar on public.contacts;
create trigger trg_redigir_identidades_de_canal_ao_anonimizar
after update of is_anonymized on public.contacts for each row
execute function public.fn_redigir_identidades_de_canal_ao_anonimizar();
