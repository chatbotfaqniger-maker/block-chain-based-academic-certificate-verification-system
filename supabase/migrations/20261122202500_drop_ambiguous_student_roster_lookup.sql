-- Remove the initial single-argument helper. All callers must specify the exact institution ID.
drop function if exists public.list_verity_student_roster(text);
