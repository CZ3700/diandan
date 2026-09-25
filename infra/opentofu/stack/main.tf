module "network" {
  source                = "../modules/network"
  name                  = var.name
  region                = var.region
  vpc_cidr              = var.vpc_cidr
  availability_zone_ids = var.availability_zone_ids
}
module "data" {
  source                    = "../modules/data"
  providers                 = { aws = aws, aws.backup = aws.backup }
  name                      = var.name
  subnet_ids                = module.network.database_subnet_ids
  security_group_id         = module.network.database_security_group_id
  engine_version            = var.postgres_engine_version
  parameter_family          = var.postgres_parameter_family
  instance_class            = var.postgres_instance_class
  allocated_storage         = var.postgres_storage_gib
  final_snapshot_identifier = var.final_snapshot_identifier
}
module "media" {
  source           = "../modules/media"
  name             = var.name
  account_id       = var.account_id
  admin_origin     = "https://${var.domains.admin}"
  distribution_arn = module.edge.media_distribution_arn
}
module "compute" {
  source                = "../modules/compute"
  name                  = var.name
  region                = var.region
  account_id            = var.account_id
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.application_subnet_ids
  security_group_ids    = module.network.application_security_group_ids
  alb_security_group_id = module.network.alb_security_group_id
  certificate_arn       = module.edge.certificate_arn
  domains               = var.domains
  images                = var.images
  environment = { for app in ["storefront", "admin", "api", "worker"] : app => merge(var.application_environment[app], {
    NODE_ENV                        = "production"
    HOSTNAME                        = "0.0.0.0"
    PORT                            = tostring({ storefront = 3000, admin = 3000, api = 3002, worker = 3003 }[app])
    FAN_SUPPORT_DEPLOYMENT_ENV      = var.environment_name
    FAN_SUPPORT_SITE_ORIGIN         = "https://${app == "admin" ? var.domains.admin : var.domains.storefront}"
    FAN_SUPPORT_INTERNAL_API_ORIGIN = "https://${var.domains.origin}"
  }) }
  secrets                  = var.secret_references
  secret_kms_key_arns      = var.secret_kms_key_arns
  application_kms_key_arns = var.application_kms_key_arns
  application_mac_key_arns = var.application_mac_key_arns
  media                    = module.media.buckets
  media_kms_key_arn        = module.media.kms_key_arn
  distribution_arn         = module.edge.distribution_arn
  task_cpu                 = var.task_cpu
  task_memory              = var.task_memory
  log_retention_days       = var.log_retention_days
}
module "edge" {
  source                    = "../modules/edge"
  name                      = var.name
  domains                   = var.domains
  aliases                   = var.aliases
  zone_id                   = var.zone_id
  alb                       = module.compute.alb
  derivative_domain         = module.media.buckets.derivative.domain
  waf_enforce               = var.waf_enforce
  rate_limit                = var.rate_limit
  rate_limit_window_seconds = var.rate_limit_window_seconds
  operation_rate_limits     = var.operation_rate_limits
}
module "operations" {
  source              = "../modules/operations"
  name                = var.name
  account_id          = var.account_id
  region              = var.region
  cluster_name        = module.compute.cluster_name
  service_names       = module.compute.service_names
  database_id         = module.data.database_id
  alb_suffix          = module.compute.alb.arn_suffix
  target_groups       = module.compute.target_groups
  monthly_budget_usd  = var.monthly_budget_usd
  notification_emails = var.notification_emails
  repository_arns     = module.compute.repository_arns
  task_role_arns      = module.compute.task_role_arns
  service_arns        = module.compute.service_arns
  oidc_provider_arn   = var.oidc_provider_arn
  oidc_issuer         = var.oidc_issuer
  oidc_subjects       = var.oidc_subjects
}
