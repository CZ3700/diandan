SET search_path = public;

DROP TRIGGER audit_logs_no_truncate_trigger ON audit_logs;
DROP TRIGGER audit_logs_append_only_trigger ON audit_logs;
DROP TABLE audit_logs;
DROP TABLE idempotency_records;
DROP TABLE config_versions;
DROP TABLE admin_sessions;
DROP TABLE admin_identity_roles;
DROP TABLE role_permissions;
DROP TABLE permissions;
DROP TABLE roles;
DROP TABLE admin_identities;

DROP FUNCTION guard_idempotency_record_mutation();
DROP FUNCTION guard_config_version_mutation();
DROP FUNCTION guard_immutable_columns();
DROP FUNCTION guard_append_only();

DROP DOMAIN ciphertext_bytes;
DROP DOMAIN secret_reference;
DROP DOMAIN safe_idempotency_result_reference;
DROP DOMAIN idempotency_actor_reference;
DROP DOMAIN finite_timestamptz;
DROP DOMAIN opaque_provider_reference;
DROP DOMAIN media_object_key;
DROP DOMAIN idempotency_key_value;
DROP DOMAIN sha256_hex;
DROP DOMAIN positive_version;
DROP DOMAIN minor_amount;
DROP DOMAIN market_code;
DROP DOMAIN country_code;
DROP DOMAIN currency_code;
DROP DOMAIN supported_locale;

DROP EXTENSION btree_gist;
