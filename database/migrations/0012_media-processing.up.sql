-- Originals and generated masters have independent immutable object identities and review states.
-- Keep checksum deduplication inside each purpose without rewriting legacy originals.
ALTER TABLE public.media_assets ADD COLUMN identity_kind text NOT NULL DEFAULT 'SOURCE'
  CHECK (identity_kind IN ('SOURCE','PROCESSED_MASTER'));
ALTER TABLE public.media_assets DROP CONSTRAINT media_assets_checksum_unique;
ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_checksum_identity_kind_unique
  UNIQUE (checksum_sha256,identity_kind);
CREATE TRIGGER media_assets_identity_kind_immutable BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_columns('identity_kind');

-- Durable image processing is independent of payment event consumers.
CREATE TABLE public.media_processing_jobs (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  source_asset_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  source_metadata_revision_id uuid NOT NULL,
  source_checksum_sha256 public.sha256_hex NOT NULL,
  profile_version smallint NOT NULL CHECK (profile_version = 1),
  role text NOT NULL CHECK (role IN ('PORTRAIT','HERO_DESKTOP','HERO_MOBILE','GIFT_PRIMARY')),
  fit text NOT NULL CHECK (fit IN ('COVER','CONTAIN')),
  focal_x numeric(6,5) NOT NULL CHECK (focal_x BETWEEN 0 AND 1),
  focal_y numeric(6,5) NOT NULL CHECK (focal_y BETWEEN 0 AND 1),
  command_hash public.sha256_hex NOT NULL UNIQUE,
  requested_by uuid NOT NULL REFERENCES public.admin_identities(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 256),
  status text NOT NULL CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 6),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  error_code text,
  error_retryable boolean,
  output_asset_id uuid REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  result_hash public.sha256_hex,
  orientation smallint CHECK (orientation BETWEEN 1 AND 8),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  completed_at timestamptz,
  CONSTRAINT media_processing_source_metadata_fk FOREIGN KEY (source_metadata_revision_id,source_asset_id)
    REFERENCES public.media_metadata_revisions(id,media_asset_id) ON DELETE RESTRICT,
  CONSTRAINT media_processing_error_shape CHECK (
    (error_code IS NULL AND error_retryable IS NULL)
    OR (error_code IN ('INVALID_COMMAND','SOURCE_NOT_FOUND','SOURCE_CHANGED','INVALID_IMAGE','MIME_MISMATCH',
      'DIMENSION_MISMATCH','SOURCE_TOO_SMALL','PIXEL_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED','STORAGE_UNAVAILABLE',
      'OBJECT_CONFLICT','PROCESSING_TIMEOUT','UNEXPECTED_PROCESSING_FAILURE')
      AND error_retryable IS NOT NULL AND error_retryable = (error_code IN ('STORAGE_UNAVAILABLE','PROCESSING_TIMEOUT','UNEXPECTED_PROCESSING_FAILURE')))
  ),
  CONSTRAINT media_processing_job_shape CHECK (
    (status = 'PENDING' AND lease_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NOT NULL
      AND attempt_count < 6 AND output_asset_id IS NULL AND result_hash IS NULL AND orientation IS NULL AND completed_at IS NULL)
    OR (status = 'PROCESSING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND next_attempt_at IS NULL
      AND attempt_count > 0 AND output_asset_id IS NULL AND result_hash IS NULL AND orientation IS NULL AND completed_at IS NULL)
    OR (status = 'SUCCEEDED' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND next_attempt_at IS NULL
      AND attempt_count > 0 AND output_asset_id IS NOT NULL AND result_hash IS NOT NULL AND orientation IS NOT NULL
      AND error_code IS NULL AND completed_at IS NOT NULL)
    OR (status = 'FAILED' AND next_attempt_at IS NULL AND output_asset_id IS NULL AND result_hash IS NULL
      AND orientation IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX media_processing_ready_idx ON public.media_processing_jobs (next_attempt_at,id) WHERE status = 'PENDING';
CREATE INDEX media_processing_expired_idx ON public.media_processing_jobs (lease_expires_at,id) WHERE status = 'PROCESSING';
CREATE TABLE public.media_processing_attempts (
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  job_id uuid NOT NULL REFERENCES public.media_processing_jobs(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 6),
  lease_token uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('PROCESSING','SUCCEEDED','FAILED','EXPIRED')),
  started_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  lease_expires_at timestamptz NOT NULL,
  finished_at timestamptz,
  error_code text,
  error_retryable boolean,
  PRIMARY KEY(job_id,attempt_number),
  CONSTRAINT media_processing_attempt_shape CHECK (
    (status = 'PROCESSING' AND finished_at IS NULL AND error_code IS NULL AND error_retryable IS NULL)
    OR (status = 'SUCCEEDED' AND finished_at IS NOT NULL AND error_code IS NULL AND error_retryable IS NULL)
    OR (status IN ('FAILED','EXPIRED') AND finished_at IS NOT NULL AND error_code IS NOT NULL AND error_retryable IS NOT NULL)
  ),
  CONSTRAINT media_processing_attempt_error_shape CHECK (error_code IS NULL OR
    (error_code IN ('INVALID_COMMAND','SOURCE_NOT_FOUND','SOURCE_CHANGED','INVALID_IMAGE','MIME_MISMATCH',
      'DIMENSION_MISMATCH','SOURCE_TOO_SMALL','PIXEL_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED','STORAGE_UNAVAILABLE',
      'OBJECT_CONFLICT','PROCESSING_TIMEOUT','UNEXPECTED_PROCESSING_FAILURE')
      AND error_retryable = (error_code IN ('STORAGE_UNAVAILABLE','PROCESSING_TIMEOUT','UNEXPECTED_PROCESSING_FAILURE')))),
  CHECK (lease_expires_at > started_at AND (finished_at IS NULL OR finished_at >= started_at))
);
CREATE TABLE public.media_processing_outputs (
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  job_id uuid NOT NULL REFERENCES public.media_processing_jobs(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('MASTER','VARIANT')),
  format text NOT NULL CHECK (format IN ('PNG','AVIF','WEBP','JPEG')),
  media_asset_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  media_variant_id uuid REFERENCES public.media_variants(id) ON DELETE RESTRICT,
  width integer NOT NULL CHECK (width BETWEEN 1 AND 20000),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 20000),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 33554432),
  checksum_sha256 public.sha256_hex NOT NULL,
  object_key public.media_object_key NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (job_id,kind,format,width,height),
  CHECK ((kind = 'MASTER' AND format = 'PNG' AND media_variant_id IS NULL)
    OR (kind = 'VARIANT' AND format <> 'PNG' AND media_variant_id IS NOT NULL))
);
CREATE UNIQUE INDEX media_processing_master_once_idx ON public.media_processing_outputs(job_id) WHERE kind = 'MASTER';
CREATE UNIQUE INDEX media_processing_variant_once_idx ON public.media_processing_outputs(job_id,media_variant_id) WHERE kind = 'VARIANT';

CREATE FUNCTION public.guard_media_processing_job()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.attempt_count <> 0 OR NEW.error_code IS NOT NULL THEN
      RAISE EXCEPTION 'media processing must begin pending' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.media_assets asset JOIN public.media_metadata_revisions metadata
        ON metadata.media_asset_id = asset.id
      WHERE asset.id = NEW.source_asset_id AND metadata.id = NEW.source_metadata_revision_id
        AND asset.checksum_sha256 = NEW.source_checksum_sha256
        AND asset.identity_kind = 'SOURCE' AND asset.processing_status <> 'ARCHIVED' AND asset.rights_status IN ('PENDING','APPROVED')
        AND asset.byte_size <= 26214400 AND asset.width <= 20000 AND asset.height <= 20000
        AND asset.width::bigint * asset.height <= 40000000 AND metadata.lifecycle <> 'ARCHIVED'
        AND metadata.focal_x = NEW.focal_x AND metadata.focal_y = NEW.focal_y
    ) THEN RAISE EXCEPTION 'media processing source is not eligible' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'media processing history cannot be deleted' USING ERRCODE = '55000'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status','attempt_count','lease_token','lease_expires_at','next_attempt_at','error_code','error_retryable','output_asset_id','result_hash','orientation','updated_at','completed_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','attempt_count','lease_token','lease_expires_at','next_attempt_at','error_code','error_retryable','output_asset_id','result_hash','orientation','updated_at','completed_at']) THEN
    RAISE EXCEPTION 'media processing recipe is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED') THEN
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'terminal media processing is immutable' USING ERRCODE = '55000'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'PROCESSING' THEN
    IF NOT ((OLD.status = 'PENDING' AND OLD.next_attempt_at <= statement_timestamp())
      OR (OLD.status = 'PROCESSING' AND OLD.lease_expires_at <= statement_timestamp()))
      OR NEW.attempt_count <> OLD.attempt_count + 1 OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token
      OR NEW.lease_expires_at < statement_timestamp() + interval '60 seconds'
      OR NEW.lease_expires_at > statement_timestamp() + interval '3600 seconds' THEN
      RAISE EXCEPTION 'media claim must advance an available lease' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'PENDING' THEN
    IF OLD.status <> 'PROCESSING' OR NEW.attempt_count <> OLD.attempt_count
      OR NEW.error_retryable IS DISTINCT FROM true
      OR NEW.next_attempt_at < statement_timestamp() + make_interval(secs => least(300, power(2,NEW.attempt_count)::integer)) THEN
      RAISE EXCEPTION 'media retry requires bounded backoff' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status IN ('SUCCEEDED','FAILED') THEN
    IF NEW.attempt_count <> OLD.attempt_count OR (NEW.status = 'SUCCEEDED' AND
      (OLD.status <> 'PROCESSING' OR OLD.lease_expires_at <= statement_timestamp())) THEN
      RAISE EXCEPTION 'media completion requires a current claim' USING ERRCODE = '23514';
    END IF;
    IF NEW.lease_token IS DISTINCT FROM OLD.lease_token OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at THEN
      RAISE EXCEPTION 'media completion must preserve claim evidence' USING ERRCODE = '23514';
    END IF;
  ELSE RAISE EXCEPTION 'invalid media transition' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER media_processing_job_guard BEFORE INSERT OR UPDATE OR DELETE ON public.media_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_media_processing_job();
CREATE TRIGGER media_processing_jobs_no_truncate BEFORE TRUNCATE ON public.media_processing_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.guard_media_processing_attempt()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'media attempts cannot be deleted' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'PROCESSING' OR NEW.status = 'PROCESSING'
      OR (to_jsonb(NEW) - ARRAY['status','finished_at','error_code','error_retryable']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status','finished_at','error_code','error_retryable']) THEN
      RAISE EXCEPTION 'media attempt evidence is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.status = 'EXPIRED' AND (OLD.lease_expires_at > statement_timestamp()
      OR NEW.error_code <> 'PROCESSING_TIMEOUT' OR NEW.error_retryable IS DISTINCT FROM true) THEN
      RAISE EXCEPTION 'only expired claims can expire' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status <> 'PROCESSING' OR NOT EXISTS (
    SELECT 1 FROM public.media_processing_jobs job WHERE job.id = NEW.job_id AND job.status = 'PROCESSING'
      AND job.attempt_count = NEW.attempt_number AND job.lease_token = NEW.lease_token
      AND job.lease_expires_at = NEW.lease_expires_at
  ) THEN RAISE EXCEPTION 'attempt must match claimed job' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER media_processing_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.media_processing_attempts
  FOR EACH ROW EXECUTE FUNCTION public.guard_media_processing_attempt();
CREATE TRIGGER media_processing_attempts_no_truncate BEFORE TRUNCATE ON public.media_processing_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER media_processing_outputs_append_only BEFORE UPDATE OR DELETE ON public.media_processing_outputs
  FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
CREATE TRIGGER media_processing_outputs_no_truncate BEFORE TRUNCATE ON public.media_processing_outputs
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_append_only();

CREATE FUNCTION public.assert_media_processing_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  job public.media_processing_jobs%ROWTYPE;
  job_identifier uuid;
  target_width integer;
  target_height integer;
BEGIN
  IF TG_TABLE_NAME = 'media_processing_jobs' THEN job_identifier := NEW.id; ELSE job_identifier := NEW.job_id; END IF;
  SELECT * INTO job FROM public.media_processing_jobs WHERE id = job_identifier;
  IF (SELECT count(*) FROM public.media_processing_attempts WHERE job_id = job.id) <> job.attempt_count THEN
    RAISE EXCEPTION 'media attempt history must be complete' USING ERRCODE = '23514';
  END IF;
  IF job.attempt_count > 0 AND NOT EXISTS (
    SELECT 1 FROM public.media_processing_attempts attempt WHERE attempt.job_id = job.id AND attempt.attempt_number = job.attempt_count
      AND ((job.status = 'PROCESSING' AND attempt.status = 'PROCESSING' AND attempt.lease_token = job.lease_token)
        OR (job.status = 'SUCCEEDED' AND attempt.status = 'SUCCEEDED' AND attempt.lease_token = job.lease_token)
        OR (job.status IN ('PENDING','FAILED') AND attempt.status IN ('FAILED','EXPIRED')))
  ) THEN RAISE EXCEPTION 'media job must match terminal attempt evidence' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.media_processing_attempts WHERE job_id = job.id AND attempt_number < job.attempt_count AND status = 'PROCESSING') THEN
    RAISE EXCEPTION 'prior media attempts must be terminal' USING ERRCODE = '23514';
  END IF;
  IF job.status <> 'SUCCEEDED' THEN
    IF EXISTS (SELECT 1 FROM public.media_processing_outputs WHERE job_id = job.id) THEN
      RAISE EXCEPTION 'partial media outputs cannot become persisted evidence' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;
  target_width := CASE job.role WHEN 'PORTRAIT' THEN 1600 WHEN 'HERO_DESKTOP' THEN 2400 WHEN 'HERO_MOBILE' THEN 1080 ELSE 1200 END;
  target_height := CASE job.role WHEN 'PORTRAIT' THEN 2000 WHEN 'HERO_DESKTOP' THEN 1350 WHEN 'HERO_MOBILE' THEN 1350 ELSE 1200 END;
  IF (SELECT count(*) FROM public.media_processing_outputs WHERE job_id = job.id) <> 13
    OR (SELECT count(*) FROM public.media_processing_outputs WHERE job_id = job.id AND kind = 'MASTER') <> 1
    OR EXISTS (
      SELECT 1 FROM public.media_processing_outputs output WHERE output.job_id = job.id AND
        (output.media_asset_id <> job.output_asset_id OR output.width::bigint * target_height <> output.height::bigint * target_width
          OR (output.kind = 'MASTER' AND output.width <> target_width)
          OR (output.kind = 'VARIANT' AND output.width NOT IN (320,640,960,target_width))
          OR output.object_key <> 'processed/v1/' || CASE WHEN output.kind = 'VARIANT' THEN
            (SELECT master.checksum_sha256 || '/' FROM public.media_processing_outputs master WHERE master.job_id = job.id AND master.kind = 'MASTER')
            ELSE '' END || output.checksum_sha256 || '.' || CASE output.format WHEN 'JPEG' THEN 'jpg' ELSE lower(output.format) END)
    ) OR EXISTS (
      SELECT 1 FROM public.media_processing_outputs output
      LEFT JOIN public.media_assets asset ON asset.id = output.media_asset_id
      LEFT JOIN public.media_variants variant ON variant.id = output.media_variant_id
      WHERE output.job_id = job.id AND ((output.kind = 'MASTER' AND
        (asset.identity_kind <> 'PROCESSED_MASTER' OR asset.processing_status <> 'READY' OR asset.rights_status NOT IN ('PENDING','APPROVED') OR asset.mime_type <> 'image/png'
          OR asset.width <> output.width OR asset.height <> output.height OR asset.byte_size <> output.byte_size
          OR asset.object_key <> output.object_key OR asset.checksum_sha256 <> output.checksum_sha256))
        OR (output.kind = 'VARIANT' AND (variant.media_asset_id <> output.media_asset_id OR variant.status <> 'READY'
          OR variant.format <> output.format OR variant.width <> output.width OR variant.height <> output.height
          OR variant.byte_size <> output.byte_size OR variant.object_key <> output.object_key OR variant.checksum_sha256 <> output.checksum_sha256)))
    ) THEN RAISE EXCEPTION 'media success requires complete immutable output evidence' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER media_processing_job_evidence AFTER INSERT OR UPDATE ON public.media_processing_jobs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_media_processing_evidence();
CREATE CONSTRAINT TRIGGER media_processing_attempt_evidence AFTER INSERT OR UPDATE ON public.media_processing_attempts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_media_processing_evidence();
CREATE CONSTRAINT TRIGGER media_processing_output_evidence AFTER INSERT ON public.media_processing_outputs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_media_processing_evidence();
