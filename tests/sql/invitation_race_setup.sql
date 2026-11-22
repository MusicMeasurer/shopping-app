-- Disposable CI database only. Fixture commits so two sessions can race.
GRANT INSERT,SELECT ON public.shopping_lists TO authenticated;
INSERT INTO auth.users(id) VALUES
('00000000-0000-4000-8000-0000000000a1'),
('00000000-0000-4000-8000-0000000000b1'),
('00000000-0000-4000-8000-0000000000c1');
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','race fixture');
COMMIT;
