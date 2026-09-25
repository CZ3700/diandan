variable "name" { type = string }
variable "account_id" { type = string }
variable "admin_origin" { type = string }
variable "distribution_arn" { type = string }
resource "aws_kms_key" "media" {
  description             = "${var.name} private media"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}
resource "aws_kms_key_policy" "media" {
  key_id = aws_kms_key.media.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "AccountAdministration", Effect = "Allow", Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }, Action = "kms:*", Resource = "*" },
    { Sid = "CloudFrontDerivativeRead", Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "kms:Decrypt", Resource = "*", Condition = { StringEquals = { "AWS:SourceArn" = var.distribution_arn } } }
  ] })
}
resource "aws_s3_bucket" "media" {
  for_each      = toset(["source", "derivative"])
  bucket        = "${var.name}-${var.account_id}-${each.key}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "media" {
  for_each                = { for name, bucket in aws_s3_bucket.media : name => { id = bucket.id, arn = bucket.arn } }
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "media" {
  for_each = { for name, bucket in aws_s3_bucket.media : name => { id = bucket.id, arn = bucket.arn } }
  bucket   = each.value.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "media" {
  for_each = { for name, bucket in aws_s3_bucket.media : name => { id = bucket.id, arn = bucket.arn } }
  bucket   = each.value.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  for_each = { for name, bucket in aws_s3_bucket.media : name => { id = bucket.id, arn = bucket.arn } }
  bucket   = each.value.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.media.arn
    }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  for_each = { for name, bucket in aws_s3_bucket.media : name => { id = bucket.id, arn = bucket.arn } }
  bucket   = each.value.id
  rule {
    id     = "abort-incomplete-upload"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
    noncurrent_version_transition {
      noncurrent_days = 35
      storage_class   = "STANDARD_IA"
    }
  }
  depends_on = [aws_s3_bucket_versioning.media]
}
resource "aws_s3_bucket_cors_configuration" "source" {
  bucket = aws_s3_bucket.media["source"].id
  cors_rule {
    allowed_methods = ["PUT", "POST", "HEAD"]
    allowed_origins = [var.admin_origin]
    allowed_headers = ["if-none-match", "content-type", "x-amz-checksum-sha256", "x-amz-content-sha256", "x-amz-date", "authorization", "x-amz-security-token"]
    expose_headers  = ["ETag", "x-amz-version-id", "x-amz-checksum-sha256"]
    max_age_seconds = 300
  }
}
resource "aws_s3_bucket_policy" "media" {
  for_each = { for name, bucket in aws_s3_bucket.media : name => { id = bucket.id, arn = bucket.arn } }
  bucket   = each.value.id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [each.value.arn, "${each.value.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }
    ], each.key == "derivative" ? [
    { Sid = "CloudFrontReadOnly", Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject", Resource = "${each.value.arn}/*", Condition = { StringEquals = { "AWS:SourceArn" = var.distribution_arn } } }
  ] : []) })
  depends_on = [aws_s3_bucket_public_access_block.media]
}
output "buckets" { value = { for name, bucket in aws_s3_bucket.media : name => { id = bucket.id, arn = bucket.arn, domain = bucket.bucket_regional_domain_name } } }
output "kms_key_arn" { value = aws_kms_key.media.arn }
output "invariants" {
  value = { private_buckets = length(aws_s3_bucket_public_access_block.media), versioned_buckets = length(aws_s3_bucket_versioning.media), encrypted_buckets = length(aws_s3_bucket_server_side_encryption_configuration.media), source_upload_headers = one(aws_s3_bucket_cors_configuration.source.cors_rule).allowed_headers, source_cdn_access = strcontains(aws_s3_bucket_policy.media["source"].policy, "cloudfront.amazonaws.com") }
}
