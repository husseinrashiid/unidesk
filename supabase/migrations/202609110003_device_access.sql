ALTER TABLE public.unidesk_devices ADD COLUMN session_id uuid;
ALTER TABLE public.unidesk_devices ADD COLUMN revoked_at timestamptz;
CREATE INDEX unidesk_device_session ON public.unidesk_devices(owner,session_id);

CREATE FUNCTION public.unidesk_session_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.unidesk_devices WHERE owner=auth.uid()
   AND session_id=nullif(auth.jwt()->>'session_id','')::uuid AND revoked_at IS NOT NULL
 )
$$;
REVOKE ALL ON FUNCTION public.unidesk_session_allowed() FROM public,anon;
GRANT EXECUTE ON FUNCTION public.unidesk_session_allowed() TO authenticated;
CREATE POLICY active_session_records ON public.unidesk_records AS RESTRICTIVE FOR SELECT TO authenticated USING(public.unidesk_session_allowed());
CREATE POLICY active_session_revisions ON public.unidesk_revisions AS RESTRICTIVE FOR SELECT TO authenticated USING(public.unidesk_session_allowed());
CREATE POLICY active_session_devices ON public.unidesk_devices AS RESTRICTIVE FOR SELECT TO authenticated USING(public.unidesk_session_allowed());
CREATE POLICY active_session_blob_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'unidesk-files' OR public.unidesk_session_allowed());
CREATE POLICY active_session_blob_create ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'unidesk-files' OR public.unidesk_session_allowed());

ALTER FUNCTION public.unidesk_sync(text,jsonb) RENAME TO unidesk_sync_core;
REVOKE ALL ON FUNCTION public.unidesk_sync_core(text,jsonb) FROM public,anon,authenticated;
CREATE FUNCTION public.unidesk_sync(p_route text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; owner_id uuid:=auth.uid(); device text:=p_body->>'device';
BEGIN
 IF owner_id IS NULL THEN RAISE EXCEPTION 'Authentication required';END IF;
 IF p_body->>'protocol' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Update UniDesk to continue syncing';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 IF NOT public.unidesk_session_allowed() OR EXISTS(SELECT 1 FROM public.unidesk_devices WHERE owner=owner_id AND id=device AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'This device was removed. Restore its access from another connected device';END IF;
 IF p_route IN ('remove-device','restore-device') THEN
  IF p_body->>'target'=device THEN RAISE EXCEPTION 'Use Sign out on this device';END IF;
  UPDATE public.unidesk_devices SET revoked_at=CASE WHEN p_route='remove-device' THEN now() ELSE NULL END WHERE owner=owner_id AND id=p_body->>'target';
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found';END IF;
  RETURN jsonb_build_object('ok',true);
 END IF;
 result:=public.unidesk_sync_core(p_route,p_body);
 UPDATE public.unidesk_devices SET session_id=nullif(auth.jwt()->>'session_id','')::uuid WHERE owner=owner_id AND id=device;
 IF p_route='info' THEN
  result:=result||jsonb_build_object('devices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'platform',platform,'appVersion',app_version,'registeredAt',registered_at,'lastSeenAt',last_seen_at,'revokedAt',revoked_at)),'[]') FROM public.unidesk_devices WHERE owner=owner_id));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.unidesk_sync(text,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.unidesk_sync(text,jsonb) TO authenticated;
