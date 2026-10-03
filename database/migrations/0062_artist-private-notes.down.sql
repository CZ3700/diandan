SET search_path=public;
-- Private notes and their reads are history; refuse to drop them silently.
LOCK TABLE artist_private_notes, artist_private_note_accesses, artist_private_note_confirmations IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM artist_private_notes) OR EXISTS(SELECT 1 FROM artist_private_note_accesses) THEN
  RAISE EXCEPTION 'artist private note history cannot be downgraded' USING ERRCODE='55000';
 END IF;
END $$;
DROP TABLE artist_private_note_confirmations;
DROP TABLE artist_private_note_accesses;
DROP TABLE artist_private_notes;
DROP FUNCTION public.assert_artist_private_note_confirmation();
DROP FUNCTION public.assert_artist_private_note_access();
DROP FUNCTION public.assert_artist_private_note();
DROP FUNCTION public.guard_artist_private_note();
DROP FUNCTION public.artist_private_note_authorized(uuid,uuid,timestamptz);
DELETE FROM role_permissions rp USING permissions p WHERE rp.permission_id=p.id AND p.permission_key='idols.private';
DELETE FROM permissions WHERE permission_key='idols.private';
