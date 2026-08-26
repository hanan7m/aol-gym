-- Persistent workflows: ratings, attendance, and track-change requests.
-- Apply after the security_hardening and atomic_private_slot_booking migrations.

create table if not exists public.session_ratings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  trainer_name text not null,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now()
);

create table if not exists public.track_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  track_name text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);

alter table public.attendance_log add column if not exists user_id uuid references public.profiles(id) on delete set null;

create index if not exists session_ratings_trainer_name_idx on public.session_ratings (trainer_name);
create index if not exists track_change_requests_user_id_idx on public.track_change_requests (user_id, created_at desc);
create index if not exists attendance_log_user_id_idx on public.attendance_log (user_id, occurred_at desc);

create or replace view public.trainer_ratings_live as
select trainer_name as trainer, round(avg(stars)::numeric, 1) as avg, count(*)::integer as count
from public.session_ratings
group by trainer_name;

alter table public.session_ratings enable row level security;
alter table public.track_change_requests enable row level security;
alter table public.attendance_log enable row level security;

drop policy if exists gym_session_ratings_select on public.session_ratings;
drop policy if exists gym_track_change_requests_select on public.track_change_requests;
drop policy if exists gym_attendance_log_select on public.attendance_log;
create policy gym_session_ratings_select on public.session_ratings
  for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() in ('admin', 'trainer'));
create policy gym_track_change_requests_select on public.track_change_requests
  for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin');
create policy gym_attendance_log_select on public.attendance_log
  for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin');

create or replace function public.submit_session_rating(p_booking_id uuid, p_stars smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_booking public.bookings%rowtype;
begin
  if auth.uid() is null or public.current_app_role() <> 'client' then
    raise exception 'غير مصرح بتقييم الجلسة';
  end if;
  if p_stars not between 1 and 5 then
    raise exception 'التقييم يجب أن يكون بين 1 و5';
  end if;

  select * into selected_booking
  from public.bookings
  where id = p_booking_id and user_id = auth.uid() and status = 'منتهي';
  if not found then
    raise exception 'لا يمكن تقييم هذا الحجز';
  end if;

  insert into public.session_ratings (booking_id, user_id, trainer_name, stars)
  values (selected_booking.id, auth.uid(), coalesce(selected_booking.trainer_name, 'مدربة'), p_stars);
end;
$$;

create or replace function public.record_my_attendance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_action text;
  member_name text;
begin
  if auth.uid() is null or public.current_app_role() <> 'client' then
    raise exception 'غير مصرح بتسجيل الحضور';
  end if;
  select full_name into member_name from public.profiles where id = auth.uid();
  select case when type = 'دخول' then 'خروج' else 'دخول' end into next_action
  from public.attendance_log where user_id = auth.uid() order by occurred_at desc limit 1;
  next_action := coalesce(next_action, 'دخول');

  insert into public.attendance_log (user_id, member_name, type, method)
  values (auth.uid(), coalesce(member_name, 'عضوة'), next_action, 'QR');
  return jsonb_build_object('action', next_action);
end;
$$;

create or replace function public.request_track_change(p_track_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.current_app_role() <> 'client' then
    raise exception 'غير مصرح بطلب التحويل';
  end if;
  if length(trim(coalesce(p_track_name, ''))) = 0 then
    raise exception 'المسار مطلوب';
  end if;
  if exists (select 1 from public.track_change_requests where user_id = auth.uid() and track_name = p_track_name and status = 'pending') then
    raise exception 'يوجد طلب تحويل معلّق لهذا المسار';
  end if;
  insert into public.track_change_requests (user_id, track_name) values (auth.uid(), trim(p_track_name));
end;
$$;

revoke all on function public.submit_session_rating(uuid, smallint) from public;
revoke all on function public.record_my_attendance() from public;
revoke all on function public.request_track_change(text) from public;
grant execute on function public.submit_session_rating(uuid, smallint) to authenticated;
grant execute on function public.record_my_attendance() to authenticated;
grant execute on function public.request_track_change(text) to authenticated;
grant select on public.trainer_ratings_live to authenticated;
