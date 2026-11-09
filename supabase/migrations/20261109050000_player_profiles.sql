-- Local migration only. Do not apply this to a remote database without approval.
-- Profiles gain a public handle. Match results are written by the database owner
-- when a match finishes. Authenticated clients can read their own rows and the
-- public leaderboard, and they cannot insert or edit a result.

alter table public.profiles
  add column username text,
  add column theme text,
  add column updated_at timestamptz not null default now();

update public.profiles
set display_name = 'Player'
where char_length(btrim(display_name)) < 2;

update public.profiles
set username = 'p' || substr(replace(id::text, '-', ''), 1, 15)
where username is null;

alter table public.profiles
  drop constraint if exists profiles_display_name_check;

alter table public.profiles
  add constraint profiles_display_name_length
  check (char_length(btrim(display_name)) between 2 and 24);

alter table public.profiles
  add constraint profiles_username_shape
  check (username ~ '^[a-z0-9_]{3,16}$');

alter table public.profiles
  add constraint profiles_theme_choice
  check (theme is null or theme in ('light', 'dark'));

create unique index profiles_username_key on public.profiles (username);

insert into public.profiles (id, display_name, username)
select
  users.id,
  'Player',
  'p' || substr(replace(users.id::text, '-', ''), 1, 15)
from auth.users as users
where not exists (
  select 1 from public.profiles as existing where existing.id = users.id
);

alter table public.profiles
  alter column username set not null;

create or replace function arena.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, username)
  values (new.id, 'Player', 'p' || substr(replace(new.id::text, '-', ''), 1, 15))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_profile_after_user on auth.users;
create trigger create_profile_after_user
after insert on auth.users
for each row execute function arena.create_profile_for_user();

create or replace function arena.touch_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_profile_before_update on public.profiles;
create trigger touch_profile_before_update
before update on public.profiles
for each row execute function arena.touch_profile();

revoke all on function arena.create_profile_for_user() from public, anon, authenticated;
revoke all on function arena.touch_profile() from public, anon, authenticated;

revoke insert, update on public.profiles from authenticated;
grant update (display_name, username, theme) on public.profiles to authenticated;

create table public.match_results (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  opponent_id uuid not null references public.profiles (id) on delete cascade,
  seat smallint not null check (seat in (0, 1)),
  score integer not null,
  opponent_score integer not null,
  result text not null check (result in ('win', 'loss', 'draw')),
  end_kind text not null check (end_kind in ('going-out', 'passes', 'resign')),
  finished_at timestamptz not null,
  primary key (match_id, user_id)
);

create index match_results_user_finished_idx
  on public.match_results (user_id, finished_at desc);

alter table public.match_results enable row level security;
alter table public.match_results force row level security;

revoke all on public.match_results from public, anon, authenticated;
grant select on public.match_results to authenticated;

create policy match_results_select_own on public.match_results
for select to authenticated
using (user_id = (select auth.uid()));

-- One row for the signed-in player. An empty history is zeros, not another player's totals.
create or replace function public.my_record()
returns table (
  games integer,
  wins integer,
  losses integer,
  draws integer,
  win_rate numeric,
  total_points integer,
  average_points numeric,
  highest_score integer,
  best_match_id uuid,
  best_score integer,
  best_opponent_score integer,
  best_finished_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::integer,
    count(*) filter (where result = 'win')::integer,
    count(*) filter (where result = 'loss')::integer,
    count(*) filter (where result = 'draw')::integer,
    case
      when count(*) = 0 then null
      else round(100.0 * count(*) filter (where result = 'win') / count(*), 1)
    end,
    coalesce(sum(score), 0)::integer,
    round(avg(score), 1),
    max(score)::integer,
    (array_agg(match_id order by score desc, finished_at desc))[1],
    (array_agg(score order by score desc, finished_at desc))[1],
    (array_agg(opponent_score order by score desc, finished_at desc))[1],
    (array_agg(finished_at order by score desc, finished_at desc))[1]
  from public.match_results
  where user_id = (select auth.uid());
$$;

-- Rating is 1000 + 25 per win + 10 per draw - 20 per loss.
-- The function reads every result as the owner and returns only public columns.
create or replace function public.leaderboard()
returns table (
  user_id uuid,
  username text,
  display_name text,
  wins integer,
  games integer,
  rating integer,
  board_rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    select
      match_results.user_id,
      count(*)::integer as games,
      count(*) filter (where match_results.result = 'win')::integer as wins,
      count(*) filter (where match_results.result = 'draw')::integer as draws,
      count(*) filter (where match_results.result = 'loss')::integer as losses
    from public.match_results
    group by match_results.user_id
  ),
  rated as (
    select
      totals.user_id,
      totals.games,
      totals.wins,
      (1000 + totals.wins * 25 + totals.draws * 10 - totals.losses * 20)::integer as rating
    from totals
  )
  select
    rated.user_id,
    profiles.username,
    profiles.display_name,
    rated.wins,
    rated.games,
    rated.rating,
    row_number() over (order by rated.wins desc, rated.rating desc, profiles.username asc)
  from rated
  join public.profiles on profiles.id = rated.user_id;
$$;

revoke all on function public.my_record() from public, anon, authenticated;
revoke all on function public.leaderboard() from public, anon, authenticated;
grant execute on function public.my_record() to authenticated;
grant execute on function public.leaderboard() to authenticated;
