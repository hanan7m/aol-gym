-- Creates a booking and marks its private slot as booked atomically.
-- Apply after 20260826_security_hardening.sql.

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

  -- FOR UPDATE serializes competing reservations for the same slot.
  select * into selected_slot
  from public.private_slots
  where id = p_slot_id
  for update;

  if not found or selected_slot.is_booked then
    raise exception 'الموعد لم يعد متاحاً';
  end if;

  insert into public.bookings (
    user_id, slot_id, title, booking_date, booking_time, trainer_name, status
  ) values (
    auth.uid(), selected_slot.id, selected_slot.session_type, selected_slot.slot_date,
    selected_slot.slot_time, selected_slot.trainer_name, 'مؤكد'
  );

  update public.private_slots
  set is_booked = true
  where id = selected_slot.id;
end;
$$;

revoke all on function public.book_private_slot(uuid) from public;
grant execute on function public.book_private_slot(uuid) to authenticated;
