/** Test-only, read-only projection of the exact receipt/session guard inputs.
 * Returns only enums, booleans and relative microseconds; no identifiers or payloads.
 */
export async function publicationSessionDiagnostic(connection, receiptId) {
  const result = await connection.query(
    `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now),
    receipt AS (
      SELECT r.*,m.manifest,p.replaces_publication_id,
        j.retry_of
      FROM public.content_publication_receipts r
      LEFT JOIN public.content_publication_manifests m ON m.id=r.manifest_id
      LEFT JOIN public.content_publications p ON p.id=r.publication_id
      LEFT JOIN public.content_purge_jobs j ON j.id=r.purge_job_id
      WHERE r.id=$1
    ), revisions AS (
      SELECT r.manifest->'revision' AS value FROM receipt r
      UNION ALL
      SELECT value FROM receipt r,jsonb_array_elements(r.manifest->'mediaRevisions')
    ), evidence_times AS (
      SELECT (value->>'createdAt')::timestamptz AS at FROM revisions
      UNION ALL
      SELECT (audit->>'editedAt')::timestamptz FROM revisions,jsonb_array_elements(value->'translationAudits') audit
      UNION ALL
      SELECT (audit#>>'{review,reviewedAt}')::timestamptz FROM revisions,jsonb_array_elements(value->'translationAudits') audit
      UNION ALL
      SELECT (audit->>'editedAt')::timestamptz FROM receipt r,jsonb_array_elements(r.manifest->'extensionApprovals') audit
      UNION ALL
      SELECT (audit->>'reviewedAt')::timestamptz FROM receipt r,jsonb_array_elements(r.manifest->'extensionApprovals') audit
      UNION ALL
      SELECT p.published_at+interval '1 microsecond' FROM receipt r JOIN public.content_publications p ON p.id=r.replaces_publication_id
      UNION ALL
      SELECT parent.validated_at FROM receipt r JOIN (
        SELECT id,validated_at FROM public.idol_revisions
        UNION ALL SELECT id,validated_at FROM public.gift_revisions
        UNION ALL SELECT id,validated_at FROM public.homepage_revisions
        UNION ALL SELECT id,validated_at FROM public.policy_revisions
        UNION ALL SELECT id,validated_at FROM public.media_metadata_revisions
      ) parent ON parent.id=(r.manifest#>>'{target,revisionId}')::uuid WHERE r.action IN ('PUBLISH','ROLLBACK')
      UNION ALL
      SELECT j.updated_at FROM receipt r JOIN public.content_purge_jobs j ON j.id=r.retry_of
    ), bound AS (SELECT max(at) AS at FROM evidence_times),
    permission_grants AS (
      SELECT ar.granted_at AS identity_granted_at,rp.granted_at AS permission_granted_at
      FROM receipt r JOIN public.admin_identity_roles ar ON ar.admin_identity_id=r.actor_id
      JOIN public.roles role ON role.id=ar.role_id
      JOIN public.role_permissions rp ON rp.role_id=role.id
      JOIN public.permissions p ON p.id=rp.permission_id
      WHERE p.permission_key='content.publish'
    ), permission_stats AS (
      SELECT count(*)::int AS permission_join_count,
        count(*) FILTER (WHERE g.identity_granted_at<=instant.now)::int AS identity_role_wall_count,
        count(*) FILTER (WHERE g.permission_granted_at<=instant.now)::int AS role_permission_wall_count,
        count(*) FILTER (WHERE g.identity_granted_at<=instant.now AND g.permission_granted_at<=instant.now)::int AS permission_wall_count,
        count(*) FILTER (WHERE g.identity_granted_at<=r.created_at AND g.permission_granted_at<=r.created_at)::int AS permission_event_count,
        count(*) FILTER (WHERE g.identity_granted_at<=instant.now AND g.permission_granted_at<=instant.now
          AND g.identity_granted_at<=r.created_at AND g.permission_granted_at<=r.created_at)::int AS permission_full_count,
        (extract(epoch FROM min(LEAST(g.identity_granted_at,g.permission_granted_at)-instant.now))*1000000)::text AS min_grant_minus_wall_us,
        (extract(epoch FROM max(GREATEST(g.identity_granted_at,g.permission_granted_at)-instant.now))*1000000)::text AS max_grant_minus_wall_us,
        (extract(epoch FROM min(LEAST(g.identity_granted_at,g.permission_granted_at)-r.created_at))*1000000)::text AS min_grant_minus_event_us,
        (extract(epoch FROM max(GREATEST(g.identity_granted_at,g.permission_granted_at)-r.created_at))*1000000)::text AS max_grant_minus_event_us
      FROM permission_grants g CROSS JOIN instant CROSS JOIN receipt r
    )
    SELECT r.action,
      s.id IS NOT NULL AS session_exists,
      s.admin_identity_id=r.actor_id AS session_actor_matches,
      i.status='ACTIVE' AS identity_active,
      s.authenticated_with_mfa AS mfa,
      s.revoked_at IS NULL AS unrevoked,
      (extract(epoch FROM (s.expires_at-instant.now))*1000000)::text AS expiry_minus_wall_us,
      (extract(epoch FROM (instant.now-s.created_at))*1000000)::text AS wall_minus_session_creation_us,
      (extract(epoch FROM (r.created_at-s.created_at))*1000000)::text AS event_minus_session_creation_us,
      (extract(epoch FROM (s.expires_at-r.created_at))*1000000)::text AS expiry_minus_event_us,
      (extract(epoch FROM (r.created_at-GREATEST(instant.now,transaction_timestamp(),s.created_at,bound.at)))*1000000)::text AS event_minus_upper_us,
      (extract(epoch FROM (r.created_at-transaction_timestamp()))*1000000)::text AS event_minus_transaction_us,
      (extract(epoch FROM (r.created_at-bound.at))*1000000)::text AS event_minus_causal_history_us,
      permission_stats.*
    FROM receipt r LEFT JOIN public.admin_sessions s ON s.id=r.session_id
    LEFT JOIN public.admin_identities i ON i.id=r.actor_id CROSS JOIN instant CROSS JOIN bound CROSS JOIN permission_stats`,
    [receiptId],
  );
  return result.rows[0] ?? { action: "MISSING_RECEIPT" };
}
