-- ShoppingApp draft 008: ownership transfer infrastructure.
-- Apply after 007 in disposable test DB only.
-- Does not implement account deletion or Auth admin orchestration.

create table public.ownership_events (
 id bigint generated always as identity primary key,
 list_id uuid not null,
 old_owner uuid not null,
 new_owner uuid not null,
 reason text not null check (reason in ('voluntary','account_deletion')),
 created_at timestamptz not null default now()
);
create table public.user_notifications (
 id bigint generated always as identity primary key,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 list_id uuid,
 event_type text not null,
 payload jsonb not null,
 created_at timestamptz not null default now(),
 read_at timestamptz
);
create index user_notifications_recipient_idx
 on public.user_notifications(recipient_id,created_at desc);
alter table public.ownership_events enable row level security;
alter table public.user_notifications enable row level security;
create policy notifications_read on public.user_notifications
 for select to authenticated using (recipient_id = (select auth.uid()));
revoke insert,update,delete,truncate on public.ownership_events from public,anon,authenticated;
revoke insert,update,delete,truncate on public.user_notifications from public,anon,authenticated;

-- The old trigger from 002 blocks all owner changes. Replace with a guard
-- allowing only an explicit trusted transaction-local context.
drop trigger if exists protect_list_owner on public.shopping_lists;
create or replace function public.reject_list_owner_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
 if new.owner_id is distinct from old.owner_id
 and current_setting('shoppingapp.owner_transfer_allowed',true) is distinct from 'yes' then
  raise exception 'Ownership changes require trusted workflow';
 end if;
 return new;
end;
$$;
create trigger protect_list_owner before update on public.shopping_lists
for each row execute function public.reject_list_owner_change();

-- IMPORTANT SECURITY BLOCKER: a custom GUC is NOT a security boundary.
-- A SQL-capable client may set it. Before deployment replace with a
-- protected execution-context mechanism or privileged function ownership
-- and column-level access controls; review this migration critically.
