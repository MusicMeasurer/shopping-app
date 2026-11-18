-- Seed committed 001-016 data BEFORE applying review-only 017.
INSERT INTO auth.users(id) VALUES
 ('00000000-0000-4000-8000-0000000000f8'),
 ('00000000-0000-4000-8000-0000000000f9');
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
 ('10000000-0000-4000-8000-0000000000f8',
  '00000000-0000-4000-8000-0000000000f8','existing groceries');
INSERT INTO public.list_members(list_id,user_id) VALUES
 ('10000000-0000-4000-8000-0000000000f8',
  '00000000-0000-4000-8000-0000000000f9');
INSERT INTO public.shopping_items(id,list_id,name,purchased,quantity,unit) VALUES
 ('20000000-0000-4000-8000-0000000000f8',
  '10000000-0000-4000-8000-0000000000f8','milk',true,2,'L');
