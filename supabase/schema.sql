create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  theme_hue integer not null default 214,
  default_source_lang text not null default 'auto',
  default_target_lang text not null default 'auto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled document',
  file_name text not null default 'untitled.tex',
  format text not null default 'tex',
  source_text text not null default '',
  target_text text not null default '',
  comments jsonb not null default '[]'::jsonb,
  last_edited text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_collaborators (
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role = 'editor'),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

create index if not exists documents_owner_updated_idx
  on public.documents (owner_id, updated_at desc);

create index if not exists document_collaborators_user_idx
  on public.document_collaborators (user_id, document_id);

do $$
begin
  alter publication supabase_realtime add table public.documents;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

alter table public.documents replica identity full;

create or replace function public.invite_collaborator_by_email(
  target_document_id uuid,
  target_email text,
  target_role text default 'editor'
)
returns public.document_collaborators
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  inserted public.document_collaborators;
begin
  if not exists (
    select 1 from public.documents d
    where d.id = target_document_id
      and d.owner_id = auth.uid()
  ) then
    raise exception 'Only the owner can invite collaborators';
  end if;

  select p.id into target_user_id
  from public.profiles p
  where lower(p.email) = lower(target_email)
  limit 1;

  if target_user_id is null then
    raise exception 'No registered user found for that email';
  end if;

  insert into public.document_collaborators (document_id, user_id, role, invited_by)
  values (target_document_id, target_user_id, target_role, auth.uid())
  on conflict (document_id, user_id)
  do update set role = excluded.role
  returning * into inserted;

  return inserted;
end;
$$;

create or replace function public.is_document_owner(target_document_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = target_document_id
      and d.owner_id = auth.uid()
  );
$$;

create or replace function public.can_access_document(target_document_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = target_document_id
      and d.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.document_collaborators dc
    where dc.document_id = target_document_id
      and dc.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_document(target_document_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = target_document_id
      and d.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.document_collaborators dc
    where dc.document_id = target_document_id
      and dc.user_id = auth.uid()
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
before update on public.documents
for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_collaborators enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "documents_select_owned_or_shared" on public.documents;
create policy "documents_select_owned_or_shared"
on public.documents for select
using (public.can_access_document(id));

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
on public.documents for insert
with check (owner_id = auth.uid());

drop policy if exists "documents_update_owned_or_editor" on public.documents;
create policy "documents_update_owned_or_editor"
on public.documents for update
using (public.can_edit_document(id))
with check (public.can_edit_document(id));

drop policy if exists "documents_delete_owner" on public.documents;
create policy "documents_delete_owner"
on public.documents for delete
using (owner_id = auth.uid());

drop policy if exists "collaborators_select_member" on public.document_collaborators;
create policy "collaborators_select_member"
on public.document_collaborators for select
using (
  user_id = auth.uid()
  or public.is_document_owner(document_id)
);

drop policy if exists "collaborators_insert_owner" on public.document_collaborators;
create policy "collaborators_insert_owner"
on public.document_collaborators for insert
with check (public.is_document_owner(document_id));

drop policy if exists "collaborators_update_owner" on public.document_collaborators;
create policy "collaborators_update_owner"
on public.document_collaborators for update
using (public.is_document_owner(document_id))
with check (public.is_document_owner(document_id));

drop policy if exists "collaborators_delete_owner" on public.document_collaborators;
create policy "collaborators_delete_owner"
on public.document_collaborators for delete
using (public.is_document_owner(document_id));
