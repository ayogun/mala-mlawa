begin;

create table if not exists public.fox_rescue_settings (
  id boolean primary key default true check (id),
  goal integer not null check (goal > 0)
);

insert into public.fox_rescue_settings (id, goal)
values (true, 1000)
on conflict (id) do nothing;

create table if not exists public.fox_level_results (
  user_id uuid not null references auth.users (id) on delete cascade,
  level_index integer not null check (level_index between 0 and 999999),
  best_moves integer not null check (best_moves between 1 and 999999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, level_index)
);

alter table public.fox_rescue_settings enable row level security;
alter table public.fox_level_results enable row level security;

revoke all on table public.fox_rescue_settings from public, anon, authenticated;
revoke all on table public.fox_level_results from public, anon, authenticated;
grant select on table public.fox_level_results to authenticated;

drop policy if exists fox_read_own_results on public.fox_level_results;
create policy fox_read_own_results on public.fox_level_results
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.fox_rescue_progress()
returns table (total_completed bigint, goal integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select (select count(*) from public.fox_level_results), settings.goal
  from public.fox_rescue_settings as settings
  where settings.id = true;
$function$;

create or replace function public.fox_record_results(p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  player_id uuid := auth.uid();
begin
  if player_id is null then
    raise exception 'Sign in anonymously before recording results';
  end if;

  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'Results must be an array';
  end if;

  if jsonb_array_length(p_results) not between 1 and 100 then
    raise exception 'Send between 1 and 100 results at a time';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) as items(result)
    where jsonb_typeof(result) is distinct from 'object'
      or jsonb_typeof(result -> 'level_index') is distinct from 'number'
      or jsonb_typeof(result -> 'best_moves') is distinct from 'number'
      or (result ->> 'level_index') !~ '^(0|[1-9][0-9]{0,5})$'
      or (result ->> 'best_moves') !~ '^[1-9][0-9]{0,5}$'
  ) then
    raise exception 'Invalid level or move count';
  end if;

  if (
    select count(distinct (result ->> 'level_index')::integer) <> count(*)
    from jsonb_array_elements(p_results) as items(result)
  ) then
    raise exception 'A level may only appear once per batch';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) as items(result)
    where (result ->> 'level_index')::integer > 0
      and not exists (
        select 1
        from public.fox_level_results as previous
        where previous.user_id = player_id
          and previous.level_index = (result ->> 'level_index')::integer - 1
      )
      and not exists (
        select 1
        from jsonb_array_elements(p_results) as batch(previous)
        where (previous ->> 'level_index')::integer = (result ->> 'level_index')::integer - 1
      )
  ) then
    raise exception 'Complete earlier levels first';
  end if;

  insert into public.fox_level_results as current_result (user_id, level_index, best_moves)
  select player_id, (result ->> 'level_index')::integer, (result ->> 'best_moves')::integer
  from jsonb_array_elements(p_results) as items(result)
  on conflict (user_id, level_index) do update
    set best_moves = least(current_result.best_moves, excluded.best_moves), updated_at = now()
    where excluded.best_moves < current_result.best_moves;
end;
$function$;

revoke all on function public.fox_rescue_progress() from public, anon, authenticated;
revoke all on function public.fox_record_results(jsonb) from public, anon, authenticated;
grant execute on function public.fox_rescue_progress() to anon, authenticated;
grant execute on function public.fox_record_results(jsonb) to authenticated;

commit;
