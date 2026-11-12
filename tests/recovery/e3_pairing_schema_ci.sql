-- CI-ONLY RECONSTRUCTION from read-only live lab metadata, NOT a production migration.
-- Dependencies: baseline 001-016, ACL 018, invitation 017, Siri 020.
-- No live project is modified by this script.
ALTER TABLE public.siri_shortcut_credentials ALTER COLUMN expires_at DROP NOT NULL;
CREATE TABLE public.siri_pairing_requests (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 list_id uuid not null references public.shopping_lists(id) on delete cascade,
 code_hash bytea not null unique,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '10 minutes'),
 consumed_at timestamptz
);
CREATE INDEX siri_pairing_requests_owner_created_idx ON public.siri_pairing_requests(owner_id,created_at);
ALTER TABLE public.siri_pairing_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siri_pairing_requests FROM PUBLIC, anon, authenticated;
-- Only restore explicitly reviewed app functions, excluding platform event trigger.
-- Captured function definitions are injected in reviewed CI build, excluding rls_auto_enable.
