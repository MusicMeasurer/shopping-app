-- CI shim for Realtime. This file is never deployed to Supabase.
CREATE SCHEMA realtime;
CREATE TABLE realtime.messages (
  topic text NOT NULL, extension text NOT NULL, event text,
  payload jsonb, private boolean NOT NULL DEFAULT true
);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA realtime TO anon, authenticated;
GRANT SELECT, INSERT ON realtime.messages TO anon, authenticated;

CREATE FUNCTION realtime.topic() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT current_setting('realtime.topic', true)
$$;
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO realtime.messages(topic, extension, event, payload, private)
  VALUES ($3, 'broadcast', $2, $1 || jsonb_build_object('id', gen_random_uuid()), $4)
$$;
CREATE POLICY lab_broad_select ON realtime.messages FOR SELECT USING (true);
CREATE POLICY lab_broad_insert ON realtime.messages FOR INSERT WITH CHECK (true);
\ir ../../cloud/drafts/036_e4_list_revision_broadcast_REVIEW_ONLY.sql

BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
INSERT INTO public.shopping_lists(id, owner_id, name)
VALUES ('10000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001', 'Private title');
RESET ROLE;
UPDATE public.shopping_lists SET revision = revision WHERE name = 'Private title';
UPDATE public.shopping_lists SET revision = revision + 1 WHERE name = 'Private title';
DO $$
BEGIN
  IF (SELECT count(*) FROM realtime.messages) <> 2 OR NOT EXISTS (
    SELECT 1 FROM realtime.messages WHERE private AND event = 'list_revision'
      AND (payload - 'id') = '{"list_id":"10000000-0000-4000-8000-000000000001","revision":1}'::jsonb
  ) THEN RAISE EXCEPTION 'unexpected broadcasts or payload'; END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('realtime.topic', 'shopping-lists:00000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM realtime.messages) <> 2 THEN
    RAISE EXCEPTION 'owner cannot read their broadcast';
  END IF;
  BEGIN
    INSERT INTO realtime.messages(topic, extension) VALUES (realtime.topic(), 'broadcast');
    RAISE EXCEPTION 'client sent a server-only broadcast';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM realtime.messages) THEN RAISE EXCEPTION 'cross-account broadcast leaked'; END IF;
END;
$$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM realtime.messages) THEN RAISE EXCEPTION 'anonymous broadcast leaked'; END IF;
END;
$$;
ROLLBACK;
