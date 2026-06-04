-- 1) 把下面这一行里的邮箱改成你的 Supabase 管理员账号邮箱。
--    只有这个邮箱登录后才能新增、编辑、删除。
create extension if not exists pgcrypto;

create or replace function public.is_notes_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = lower('3532610085@qq.com');
$$;

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.folders(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  title text not null default '未命名笔记',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists folders_set_updated_at on public.folders;
create trigger folders_set_updated_at
before update on public.folders
for each row execute function public.set_updated_at();

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

alter table public.folders enable row level security;
alter table public.notes enable row level security;

drop policy if exists "folders are readable by everyone" on public.folders;
create policy "folders are readable by everyone"
on public.folders for select
to anon, authenticated
using (true);

drop policy if exists "notes are readable by everyone" on public.notes;
create policy "notes are readable by everyone"
on public.notes for select
to anon, authenticated
using (true);

drop policy if exists "admin can insert folders" on public.folders;
create policy "admin can insert folders"
on public.folders for insert
to authenticated
with check ((select public.is_notes_admin()));

drop policy if exists "admin can update folders" on public.folders;
create policy "admin can update folders"
on public.folders for update
to authenticated
using ((select public.is_notes_admin()))
with check ((select public.is_notes_admin()));

drop policy if exists "admin can delete folders" on public.folders;
create policy "admin can delete folders"
on public.folders for delete
to authenticated
using ((select public.is_notes_admin()));

drop policy if exists "admin can insert notes" on public.notes;
create policy "admin can insert notes"
on public.notes for insert
to authenticated
with check ((select public.is_notes_admin()));

drop policy if exists "admin can update notes" on public.notes;
create policy "admin can update notes"
on public.notes for update
to authenticated
using ((select public.is_notes_admin()))
with check ((select public.is_notes_admin()));

drop policy if exists "admin can delete notes" on public.notes;
create policy "admin can delete notes"
on public.notes for delete
to authenticated
using ((select public.is_notes_admin()));

grant usage on schema public to anon, authenticated;
grant select on public.folders, public.notes to anon, authenticated;
grant insert, update, delete on public.folders, public.notes to authenticated;
grant execute on function public.is_notes_admin() to anon, authenticated;
