begin;

create table if not exists public.fox_leaderboard_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fox_leaderboard_nickname_valid check (
    nickname = btrim(nickname)
    and char_length(nickname) between 2 and 24
    and nickname !~ '[[:cntrl:]]'
    and nickname !~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]'
  )
);

alter table public.fox_leaderboard_profiles enable row level security;
revoke all on table public.fox_leaderboard_profiles from public, anon, authenticated;

create or replace function public.fox_leaderboard_nickname()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select profiles.nickname
  from public.fox_leaderboard_profiles as profiles
  where profiles.user_id = auth.uid();
$function$;

create or replace function public.fox_set_leaderboard_nickname(p_nickname text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  player_id uuid := auth.uid();
  clean_nickname text := btrim(p_nickname);
begin
  if player_id is null then
    raise exception 'Sign in anonymously before joining the leaderboard' using errcode = '28000';
  end if;

  if clean_nickname is null or char_length(clean_nickname) not between 2 and 24
    or clean_nickname ~ '[[:cntrl:]]'
    or clean_nickname ~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]' then
    raise exception 'Invalid nickname' using errcode = '22023';
  end if;

  insert into public.fox_leaderboard_profiles as profile (user_id, nickname)
  values (player_id, clean_nickname)
  on conflict (user_id) do update
    set nickname = excluded.nickname, updated_at = now();

  return clean_nickname;
end;
$function$;

create or replace function public.fox_remove_leaderboard_nickname()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  player_id uuid := auth.uid();
begin
  if player_id is null then
    raise exception 'Sign in anonymously before leaving the leaderboard' using errcode = '28000';
  end if;

  delete from public.fox_leaderboard_profiles where user_id = player_id;
end;
$function$;

create or replace function public.fox_leaderboard(p_limit integer default 25)
returns table (place bigint, nickname text, completed_levels bigint, total_moves bigint, is_current boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  with scores as (
    select profiles.user_id, profiles.nickname, profiles.created_at,
      count(results.level_index) as completed_levels,
      coalesce(sum(results.best_moves), 0)::bigint as total_moves
    from public.fox_leaderboard_profiles as profiles
    left join public.fox_level_results as results on results.user_id = profiles.user_id
    group by profiles.user_id, profiles.nickname, profiles.created_at
  ), ranked as (
    select row_number() over (
      order by scores.completed_levels desc, scores.total_moves asc, scores.created_at asc, scores.user_id asc
    ) as place, scores.*
    from scores
  )
  select ranked.place, ranked.nickname, ranked.completed_levels, ranked.total_moves,
    coalesce(ranked.user_id = auth.uid(), false) as is_current
  from ranked
  where ranked.place <= least(greatest(coalesce(p_limit, 25), 1), 50)
    or ranked.user_id = auth.uid()
  order by ranked.place;
$function$;

revoke all on function public.fox_leaderboard_nickname() from public, anon, authenticated;
revoke all on function public.fox_set_leaderboard_nickname(text) from public, anon, authenticated;
revoke all on function public.fox_remove_leaderboard_nickname() from public, anon, authenticated;
revoke all on function public.fox_leaderboard(integer) from public, anon, authenticated;
grant execute on function public.fox_leaderboard_nickname() to authenticated;
grant execute on function public.fox_set_leaderboard_nickname(text) to authenticated;
grant execute on function public.fox_remove_leaderboard_nickname() to authenticated;
grant execute on function public.fox_leaderboard(integer) to anon, authenticated;

commit;
