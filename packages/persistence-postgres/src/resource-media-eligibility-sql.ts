/** A shared master is usable only while every recorded original retains its current rights. */
export const mediaProvenanceEligibilitySql = `(asset.identity_kind='SOURCE' OR (
  EXISTS(SELECT 1 FROM public.media_processing_jobs provenance JOIN public.media_processing_outputs output
    ON output.job_id=provenance.id AND output.kind='MASTER' AND output.media_asset_id=asset.id
    WHERE provenance.output_asset_id=asset.id AND provenance.status='SUCCEEDED')
  AND NOT EXISTS(SELECT 1 FROM public.media_processing_jobs provenance JOIN public.media_assets original ON original.id=provenance.source_asset_id
    WHERE provenance.output_asset_id=asset.id AND (provenance.status<>'SUCCEEDED' OR original.identity_kind<>'SOURCE'
      OR original.rights_status<>'APPROVED' OR original.processing_status='ARCHIVED'))))`;
