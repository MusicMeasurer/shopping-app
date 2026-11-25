-- Isolated Auth/REST shim for the account-deletion contract tests.
create role authenticator login;
alter table auth.users add column email text, add column email_confirmed_at timestamptz,
  add column banned_until timestamptz, add column deleted_at timestamptz;
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade
);
create table auth.refresh_tokens (
  id uuid primary key,
  session_id uuid not null references auth.sessions(id) on delete cascade
);
