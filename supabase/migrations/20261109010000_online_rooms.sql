-- Local migration only. Do not apply this to a remote database without approval.
-- The browser can read public rows for rooms it belongs to.
-- Bag order and racks live in the arena schema, which is not granted to the browser roles.

do $guard$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
end
$guard$;

create schema if not exists arena;
revoke all on schema arena from public;
revoke all on schema arena from anon;
revoke all on schema arena from authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 24),
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key,
  code text not null unique check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'),
  host_id uuid not null references auth.users (id),
  status text not null check (status in ('waiting', 'ready', 'playing', 'cancelled', 'finished')),
  match_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seat smallint not null check (seat in (0, 1)),
  ready boolean not null default false,
  connected boolean not null default true,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 24),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);

create table public.matches (
  id uuid primary key,
  room_id uuid not null unique references public.rooms (id),
  board jsonb not null,
  score_0 integer not null,
  score_1 integer not null,
  name_0 text not null,
  name_1 text not null,
  rack_count_0 integer not null,
  rack_count_1 integer not null,
  turn smallint not null check (turn in (0, 1)),
  status text not null check (status in ('playing', 'finished')),
  consecutive_passes integer not null,
  version integer not null,
  end_kind text,
  dictionary_available boolean not null default false,
  exchange_allowed boolean not null,
  board_size integer not null,
  updated_at timestamptz not null default now()
);

create index room_members_user_idx on public.room_members (user_id);
create index rooms_host_idx on public.rooms (host_id);
create index matches_room_idx on public.matches (room_id);

create table arena.secrets (
  match_id uuid primary key references public.matches (id) on delete cascade,
  bag jsonb not null,
  rack_0 jsonb not null,
  rack_1 jsonb not null,
  user_0 uuid not null references auth.users (id),
  user_1 uuid not null references auth.users (id),
  rules jsonb not null,
  state_version integer not null
);

create table arena.receipts (
  match_id uuid not null references public.matches (id) on delete cascade,
  idempotency_key text not null,
  user_id uuid not null references auth.users (id),
  command jsonb not null,
  outcome jsonb not null,
  primary key (match_id, idempotency_key)
);

create function arena.is_room_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members
    where room_id = target
      and user_id = auth.uid()
  );
$$;

revoke all on function arena.is_room_member(uuid) from public, anon;
grant usage on schema arena to authenticated;
grant execute on function arena.is_room_member(uuid) to authenticated;
revoke all on all tables in schema arena from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.matches enable row level security;
alter table public.profiles force row level security;
alter table public.rooms force row level security;
alter table public.room_members force row level security;
alter table public.matches force row level security;

revoke all on public.profiles, public.rooms, public.room_members, public.matches from public, anon, authenticated;
grant select on public.profiles, public.rooms, public.room_members, public.matches to authenticated;
grant insert, update on public.profiles to authenticated;

create policy profiles_select_self_or_roommate on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.room_members theirs
    where theirs.user_id = profiles.id
      and arena.is_room_member(theirs.room_id)
  )
);

create policy profiles_insert_self on public.profiles
for insert to authenticated
with check (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy rooms_select_member on public.rooms
for select to authenticated
using (arena.is_room_member(id));

create policy members_select_roommate on public.room_members
for select to authenticated
using (arena.is_room_member(room_id));

create policy matches_select_member on public.matches
for select to authenticated
using (arena.is_room_member(room_id));

-- No insert, update, or delete policies exist for rooms, members, or matches.
-- The match action runs as the database owner and writes both the public row and arena.secrets in one transaction.
-- Authenticated clients are not granted those tables, and the arena schema is not listed in the exposed Data API schemas.

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rooms;
    alter publication supabase_realtime add table public.room_members;
    alter publication supabase_realtime add table public.matches;
  end if;
end
$publication$;
