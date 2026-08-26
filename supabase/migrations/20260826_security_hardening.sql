-- Security hardening for client support and trainer-owned client data.
-- Apply this migration in the Supabase SQL editor before deploying the UI changes.

create table if not exists public.trainer_client_assignments (
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id),
  primary key (trainer_id, client_id),
  check (trainer_id <> client_id)
);

create index if not exists trainer_client_assignments_client_id_idx
  on public.trainer_client_assignments (client_id);

-- SECURITY DEFINER avoids recursive RLS checks while deriving the current role.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_assigned_trainer(client_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trainer_client_assignments
    where trainer_id = auth.uid() and client_id = client_uuid
  )
$$;

revoke all on function public.current_app_role() from public;
revoke all on function public.is_assigned_trainer(uuid) from public;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_assigned_trainer(uuid) to authenticated;

alter table public.trainer_client_assignments enable row level security;
alter table public.tickets enable row level security;
alter table public.inbody_records enable row level security;
alter table public.inbody_requests enable row level security;
alter table public.programs enable row level security;
alter table public.profiles enable row level security;

drop policy if exists gym_assignments_select on public.trainer_client_assignments;
drop policy if exists gym_assignments_manage on public.trainer_client_assignments;
create policy gym_assignments_select on public.trainer_client_assignments
  for select to authenticated
  using (trainer_id = auth.uid() or client_id = auth.uid() or public.current_app_role() = 'admin');
create policy gym_assignments_manage on public.trainer_client_assignments
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

drop policy if exists gym_tickets_select on public.tickets;
drop policy if exists gym_tickets_insert on public.tickets;
drop policy if exists gym_tickets_update on public.tickets;
create policy gym_tickets_select on public.tickets
  for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin');
create policy gym_tickets_insert on public.tickets
  for insert to authenticated
  with check (user_id = auth.uid() and public.current_app_role() = 'client');
create policy gym_tickets_update on public.tickets
  for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

drop policy if exists gym_inbody_records_select on public.inbody_records;
drop policy if exists gym_inbody_records_insert on public.inbody_records;
create policy gym_inbody_records_select on public.inbody_records
  for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin' or public.is_assigned_trainer(user_id));
create policy gym_inbody_records_insert on public.inbody_records
  for insert to authenticated
  with check (public.current_app_role() = 'trainer' and public.is_assigned_trainer(user_id));

drop policy if exists gym_inbody_requests_select on public.inbody_requests;
drop policy if exists gym_inbody_requests_insert on public.inbody_requests;
drop policy if exists gym_inbody_requests_update on public.inbody_requests;
create policy gym_inbody_requests_select on public.inbody_requests
  for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin' or public.is_assigned_trainer(user_id));
create policy gym_inbody_requests_insert on public.inbody_requests
  for insert to authenticated
  with check (user_id = auth.uid() and public.current_app_role() = 'client');
create policy gym_inbody_requests_update on public.inbody_requests
  for update to authenticated
  using (public.current_app_role() = 'trainer' and public.is_assigned_trainer(user_id))
  with check (public.current_app_role() = 'trainer' and public.is_assigned_trainer(user_id));

drop policy if exists gym_programs_select on public.programs;
drop policy if exists gym_programs_insert on public.programs;
create policy gym_programs_select on public.programs
  for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin' or public.is_assigned_trainer(user_id));
create policy gym_programs_insert on public.programs
  for insert to authenticated
  with check (public.current_app_role() = 'trainer' and public.is_assigned_trainer(user_id));

drop policy if exists gym_profiles_select on public.profiles;
drop policy if exists gym_profiles_update_self on public.profiles;
create policy gym_profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.current_app_role() = 'admin'
    or (role = 'client' and public.is_assigned_trainer(id))
  );
create policy gym_profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.current_app_role() = 'admin')
  with check (id = auth.uid() or public.current_app_role() = 'admin');

create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and public.current_app_role() <> 'admin' then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute function public.prevent_profile_privilege_escalation();

-- Existing broad policies on these tables can override restrictive intent because
-- PostgreSQL combines permissive policies with OR. Remove or replace old broad
-- policies after reviewing them in the Supabase dashboard.
