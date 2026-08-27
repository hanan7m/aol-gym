-- Fixes review findings without rewriting migrations that may already be applied.

alter table public.profiles
  add column if not exists training_track text;

alter table public.classes
  add column if not exists trainer_id uuid references public.profiles(id) on delete set null;
alter table public.private_slots
  add column if not exists trainer_id uuid references public.profiles(id) on delete set null;
alter table public.bookings
  add column if not exists trainer_id uuid references public.profiles(id) on delete set null;
alter table public.session_ratings
  add column if not exists trainer_id uuid references public.profiles(id) on delete set null;

-- Backfill only names that identify exactly one trainer. Ambiguous legacy names
-- remain unset rather than attaching ratings or bookings to the wrong account.
with unique_trainers as (
  select full_name, min(id) as id
  from public.profiles
  where role = 'trainer' and full_name is not null
  group by full_name
  having count(*) = 1
)
update public.classes as target
set trainer_id = source.id
from unique_trainers as source
where target.trainer_id is null and target.trainer_name = source.full_name;

with unique_trainers as (
  select full_name, min(id) as id
  from public.profiles
  where role = 'trainer' and full_name is not null
  group by full_name
  having count(*) = 1
)
update public.private_slots as target
set trainer_id = source.id
from unique_trainers as source
where target.trainer_id is null and target.trainer_name = source.full_name;

update public.bookings as booking
set trainer_id = class.trainer_id
from public.classes as class
where booking.trainer_id is null and class.id = booking.class_id and class.trainer_id is not null;

update public.bookings as booking
set trainer_id = slot.trainer_id
from public.private_slots as slot
where booking.trainer_id is null and slot.id = booking.slot_id;

update public.session_ratings as rating
set trainer_id = booking.trainer_id
from public.bookings as booking
where rating.trainer_id is null and booking.id = rating.booking_id;

create index if not exists classes_trainer_id_idx on public.classes (trainer_id);
create index if not exists private_slots_trainer_id_idx on public.private_slots (trainer_id);
create index if not exists bookings_trainer_id_idx on public.bookings (trainer_id);
create index if not exists session_ratings_trainer_id_idx on public.session_ratings (trainer_id);

drop view if exists public.trainer_ratings_live;
create view public.trainer_ratings_live with (security_invoker = true) as
select trainer_id, max(trainer_name) as trainer,
  round(avg(stars)::numeric, 1) as avg, count(*)::integer as count
from public.session_ratings
where trainer_id is not null
group by trainer_id;

create or replace function public.book_private_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_slot public.private_slots%rowtype;
begin
  if auth.uid() is null or public.current_app_role() <> 'client' then
    raise exception 'غير مصرح بحجز موعد خاص';
  end if;

  select * into selected_slot from public.private_slots where id = p_slot_id for update;
  if not found or selected_slot.is_booked then
    raise exception 'الموعد لم يعد متاحاً';
  end if;

  insert into public.bookings (
    user_id, slot_id, title, booking_date, booking_time, trainer_name, trainer_id, status
  ) values (
    auth.uid(), selected_slot.id, selected_slot.session_type, selected_slot.slot_date,
    selected_slot.slot_time, selected_slot.trainer_name, selected_slot.trainer_id, 'مؤكد'
  );

  update public.private_slots set is_booked = true where id = selected_slot.id;
end;
$$;

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
  if exists (select 1 from public.session_ratings where booking_id = p_booking_id) then
    raise exception 'تم تقييم هذه الجلسة مسبقاً';
  end if;

  select * into selected_booking
  from public.bookings
  where id = p_booking_id and user_id = auth.uid() and status = 'منتهي';
  if not found or selected_booking.trainer_id is null then
    raise exception 'لا يمكن تقييم هذا الحجز';
  end if;

  insert into public.session_ratings (booking_id, user_id, trainer_id, trainer_name, stars)
  values (selected_booking.id, auth.uid(), selected_booking.trainer_id,
    coalesce(selected_booking.trainer_name, 'مدربة'), p_stars);
end;
$$;

create or replace function public.review_track_change(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_request public.track_change_requests%rowtype;
begin
  if auth.uid() is null or public.current_app_role() <> 'admin' then
    raise exception 'غير مصرح بمراجعة طلبات التحويل';
  end if;

  select * into selected_request
  from public.track_change_requests
  where id = p_request_id and status = 'pending'
  for update;
  if not found then
    raise exception 'الطلب غير متاح للمراجعة';
  end if;

  update public.track_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(), reviewed_by = auth.uid()
  where id = selected_request.id;

  if p_approve then
    update public.profiles
    set training_track = selected_request.track_name
    where id = selected_request.user_id;
  end if;
end;
$$;

-- RLS policies are permissive by default and combine with OR. Remove every old
-- policy on the protected tables before recreating the intended access boundary.
do $$
declare
  target_table text;
  existing_policy record;
begin
  foreach target_table in array array[
    'trainer_client_assignments', 'tickets', 'inbody_records', 'inbody_requests',
    'programs', 'profiles', 'session_ratings', 'track_change_requests', 'attendance_log'
  ] loop
    for existing_policy in
      select policyname from pg_policies where schemaname = 'public' and tablename = target_table
    loop
      execute format('drop policy %I on public.%I', existing_policy.policyname, target_table);
    end loop;
  end loop;
end;
$$;

create policy gym_assignments_select on public.trainer_client_assignments
  for select to authenticated using (trainer_id = auth.uid() or client_id = auth.uid() or public.current_app_role() = 'admin');
create policy gym_assignments_manage on public.trainer_client_assignments
  for all to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy gym_tickets_select on public.tickets
  for select to authenticated using (user_id = auth.uid() or public.current_app_role() = 'admin');
create policy gym_tickets_insert on public.tickets
  for insert to authenticated with check (user_id = auth.uid() and public.current_app_role() = 'client');
create policy gym_tickets_update on public.tickets
  for update to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy gym_inbody_records_select on public.inbody_records
  for select to authenticated using (user_id = auth.uid() or public.current_app_role() = 'admin' or public.is_assigned_trainer(user_id));
create policy gym_inbody_records_insert on public.inbody_records
  for insert to authenticated with check (public.current_app_role() = 'trainer' and public.is_assigned_trainer(user_id));
create policy gym_inbody_requests_select on public.inbody_requests
  for select to authenticated using (user_id = auth.uid() or public.current_app_role() = 'admin' or public.is_assigned_trainer(user_id));
create policy gym_inbody_requests_insert on public.inbody_requests
  for insert to authenticated with check (user_id = auth.uid() and public.current_app_role() = 'client');
create policy gym_inbody_requests_update on public.inbody_requests
  for update to authenticated using (public.current_app_role() = 'trainer' and public.is_assigned_trainer(user_id)) with check (public.current_app_role() = 'trainer' and public.is_assigned_trainer(user_id));
create policy gym_programs_select on public.programs
  for select to authenticated using (user_id = auth.uid() or public.current_app_role() = 'admin' or public.is_assigned_trainer(user_id));
create policy gym_programs_insert on public.programs
  for insert to authenticated with check (public.current_app_role() = 'trainer' and public.is_assigned_trainer(user_id));
create policy gym_profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.current_app_role() = 'admin' or (role = 'client' and public.is_assigned_trainer(id)));
create policy gym_profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid() or public.current_app_role() = 'admin') with check (id = auth.uid() or public.current_app_role() = 'admin');
create policy gym_session_ratings_select on public.session_ratings
  for select to authenticated using (user_id = auth.uid() or trainer_id = auth.uid() or public.current_app_role() = 'admin');
create policy gym_track_change_requests_select on public.track_change_requests
  for select to authenticated using (user_id = auth.uid() or public.current_app_role() = 'admin');
create policy gym_attendance_log_select on public.attendance_log
  for select to authenticated using (user_id = auth.uid() or public.current_app_role() = 'admin');

revoke all on function public.book_private_slot(uuid) from public;
revoke all on function public.submit_session_rating(uuid, smallint) from public;
revoke all on function public.review_track_change(uuid, boolean) from public;
grant execute on function public.book_private_slot(uuid) to authenticated;
grant execute on function public.submit_session_rating(uuid, smallint) to authenticated;
grant execute on function public.review_track_change(uuid, boolean) to authenticated;
grant select on public.trainer_ratings_live to authenticated;
