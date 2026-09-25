terraform {
  required_version = "= 1.12.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.66.0" }
  }
  backend "s3" {}
}
variable "name" { type = string }
variable "account_id" { type = string }
provider "aws" {
  region              = "us-east-1"
  allowed_account_ids = [var.account_id]
}
locals { ports = { storefront = 3000, admin = 3000, api = 3002, worker = 3003 } }
resource "aws_ecr_repository" "application" {
  for_each             = local.ports
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "KMS" }
}
# Keep tagged releases for rollback; only incomplete/untagged uploads expire.
resource "aws_ecr_lifecycle_policy" "untagged" {
  for_each   = local.ports
  repository = aws_ecr_repository.application[each.key].name
  policy     = jsonencode({ rules = [{ rulePriority = 1, description = "Expire untagged images after 14 days", selection = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 14 }, action = { type = "expire" } }] })
}
output "repositories" { value = { for app, repository in aws_ecr_repository.application : app => { name = repository.name, arn = repository.arn, url = repository.repository_url } } }
