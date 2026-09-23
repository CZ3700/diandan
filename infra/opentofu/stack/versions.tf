terraform {
  required_version = "= 1.12.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.66.0" }
  }
  backend "s3" {}
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags { tags = { Project = var.name, Environment = var.environment_name, ManagedBy = "OpenTofu" } }
}
provider "aws" {
  alias               = "backup"
  region              = var.backup_region
  allowed_account_ids = [var.account_id]
  default_tags { tags = { Project = var.name, Environment = var.environment_name, ManagedBy = "OpenTofu" } }
}
