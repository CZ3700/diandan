variable "name" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.name))
    error_message = "Use an explicit, environment-specific 3-20 character resource prefix."
  }
}
variable "environment_name" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment_name)
    error_message = "Only staging or production may use this cloud stack."
  }
}
variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "An explicit account ID is required; providers pin it."
  }
}
variable "region" {
  type    = string
  default = "us-east-1"
  validation {
    condition     = var.region == "us-east-1"
    error_message = "ADR-007 pins the first origin region to us-east-1."
  }
}
variable "backup_region" {
  type    = string
  default = "us-west-2"
  validation {
    condition     = var.backup_region == "us-west-2"
    error_message = "ADR-007 pins the backup-only region to us-west-2."
  }
}
variable "availability_zone_ids" {
  type = list(string)
  validation {
    condition     = length(var.availability_zone_ids) >= 2 && length(distinct(var.availability_zone_ids)) == length(var.availability_zone_ids) && alltrue([for zone in var.availability_zone_ids : can(regex("^use1-az[0-9]+$", zone)) && zone != "use1-az3"])
    error_message = "Use at least two distinct us-east-1 AZ IDs; CloudFront VPC origins currently exclude use1-az3."
  }
}
variable "vpc_cidr" { type = string }
variable "zone_id" { type = string }
variable "domains" {
  type = object({ storefront = string, admin = string, origin = string, media = string })
  validation {
    condition     = length(distinct(values(var.domains))) == 4 && alltrue([for domain in values(var.domains) : can(regex("^[a-z0-9][a-z0-9.-]+[a-z0-9]$", domain))])
    error_message = "Supply four distinct lower-case DNS names without schemes or paths."
  }
}
variable "aliases" { type = list(string) }
variable "release_commit" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{40}$", var.release_commit))
    error_message = "Pin the complete source commit."
  }
}
variable "images" {
  type = map(string)
  validation {
    condition = toset(keys(var.images)) == toset(["storefront", "admin", "api", "worker"]) && alltrue([
      for app, image in var.images : can(regex("^${var.account_id}\\.dkr\\.ecr\\.${var.region}\\.amazonaws\\.com/${var.name}/${app}@sha256:[a-f0-9]{64}$", image))
    ])
    error_message = "Exactly four environment-owned ECR images pinned by sha256 digest are required."
  }
}
variable "application_environment" {
  type = map(map(string))
  validation {
    condition = toset(keys(var.application_environment)) == toset(["storefront", "admin", "api", "worker"]) && alltrue(flatten([
      for app, entries in var.application_environment : [for name, value in entries : !can(regex("(?i)(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|DATABASE_URL|ACCESS_KEY|CREDENTIAL)", name)) && !contains(["PORT", "HOSTNAME", "NODE_ENV", "FAN_SUPPORT_SITE_ORIGIN", "FAN_SUPPORT_DEPLOYMENT_ENV", "FAN_SUPPORT_INTERNAL_API_ORIGIN"], name)]
    ]))
    error_message = "All four app maps are required; secret values and reserved composition settings are forbidden. Use Secrets Manager ARN references."
  }
}
variable "secret_references" {
  type = map(map(string))
  validation {
    condition = toset(keys(var.secret_references)) == toset(["storefront", "admin", "api", "worker"]) && alltrue(flatten([
      for app, entries in var.secret_references : [for name, arn in entries : can(regex("^arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$", arn))]
    ]))
    error_message = "Provide complete Secrets Manager ARNs only, never secret versions or values."
  }
}
variable "secret_kms_key_arns" {
  type = map(list(string))
  validation {
    condition     = toset(keys(var.secret_kms_key_arns)) == toset(["storefront", "admin", "api", "worker"]) && alltrue(flatten([for app, arns in var.secret_kms_key_arns : [for arn in arns : can(regex("^arn:aws:kms:${var.region}:${var.account_id}:key/(mrk-[a-f0-9]{32}|[a-f0-9-]{36})$", arn))]]))
    error_message = "Provide exact same-account KMS key ARNs per app; wildcards and frontend envelope/HMAC grants are forbidden."
  }
}
variable "application_kms_key_arns" {
  type = map(list(string))
  validation {
    condition     = toset(keys(var.application_kms_key_arns)) == toset(["storefront", "admin", "api", "worker"]) && alltrue(flatten([for app, arns in var.application_kms_key_arns : [for arn in arns : can(regex("^arn:aws:kms:${var.region}:${var.account_id}:key/(mrk-[a-f0-9]{32}|[a-f0-9-]{36})$", arn))]])) && length(var.application_kms_key_arns["storefront"]) == 0 && length(var.application_kms_key_arns["admin"]) == 0
    error_message = "Provide exact same-account KMS key ARNs per app; wildcards and frontend envelope/HMAC grants are forbidden."
  }
}
variable "application_mac_key_arns" {
  type = map(list(string))
  validation {
    condition     = toset(keys(var.application_mac_key_arns)) == toset(["storefront", "admin", "api", "worker"]) && alltrue(flatten([for app, arns in var.application_mac_key_arns : [for arn in arns : can(regex("^arn:aws:kms:${var.region}:${var.account_id}:key/(mrk-[a-f0-9]{32}|[a-f0-9-]{36})$", arn))]])) && length(var.application_mac_key_arns["storefront"]) == 0 && length(var.application_mac_key_arns["admin"]) == 0
    error_message = "Provide exact same-account KMS key ARNs per app; wildcards and frontend envelope/HMAC grants are forbidden."
  }
}
variable "postgres_engine_version" { type = string }
variable "postgres_parameter_family" { type = string }
variable "postgres_instance_class" { type = string }
variable "postgres_storage_gib" {
  type = number
  validation {
    condition     = var.postgres_storage_gib >= 40
    error_message = "Provision at least 40 GiB; sizing remains a measured cloud gate."
  }
}
variable "final_snapshot_identifier" { type = string }
variable "task_cpu" { type = number }
variable "task_memory" { type = number }
variable "log_retention_days" { type = number }
variable "monthly_budget_usd" {
  type = number
  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "An explicit positive reviewed budget is required."
  }
}
variable "notification_emails" {
  type = list(string)
  validation {
    condition     = length(var.notification_emails) > 0 && length(var.notification_emails) <= 10
    error_message = "At least one reviewed notification recipient is required."
  }
}
variable "waf_enforce" {
  description = "Keep false for count-before-block staging measurement; enable only with webhook/return evidence."
  type        = bool
  default     = false
}
variable "rate_limit" { type = number }
variable "oidc_provider_arn" { type = string }
variable "oidc_issuer" { type = string }
variable "oidc_subjects" {
  type = list(string)
  validation {
    condition     = length(var.oidc_subjects) > 0 && alltrue([for subject in var.oidc_subjects : !strcontains(subject, "*")])
    error_message = "Deployment OIDC subjects must be explicit and cannot contain wildcards."
  }
}
