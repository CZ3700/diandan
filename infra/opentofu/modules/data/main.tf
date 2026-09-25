terraform {
  required_providers {
    aws = { source = "hashicorp/aws", configuration_aliases = [aws.backup] }
  }
}
variable "name" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "engine_version" { type = string }
variable "parameter_family" { type = string }
variable "instance_class" { type = string }
variable "allocated_storage" { type = number }
variable "final_snapshot_identifier" { type = string }
resource "aws_kms_key" "database" {
  description             = "${var.name} RDS and RDS-managed master secret"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}
resource "aws_kms_key" "backup" {
  provider                = aws.backup
  description             = "${var.name} cross-region RDS backups"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}
resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}
resource "aws_db_parameter_group" "this" {
  name_prefix = "${var.name}-"
  family      = var.parameter_family
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  # Statements can contain PII; application logging remains an explicit allowlist.
  parameter {
    name  = "log_statement"
    value = "none"
  }
  parameter {
    name  = "log_min_error_statement"
    value = "panic"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "-1"
  }
  parameter {
    name  = "log_parameter_max_length_on_error"
    value = "0"
  }
  lifecycle { create_before_destroy = true }
}
resource "aws_db_instance" "this" {
  identifier                          = var.name
  engine                              = "postgres"
  engine_version                      = var.engine_version
  instance_class                      = var.instance_class
  allocated_storage                   = var.allocated_storage
  max_allocated_storage               = var.allocated_storage * 4
  storage_type                        = "gp3"
  storage_encrypted                   = true
  kms_key_id                          = aws_kms_key.database.arn
  multi_az                            = true
  publicly_accessible                 = false
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [var.security_group_id]
  parameter_group_name                = aws_db_parameter_group.this.name
  db_name                             = "fan_support"
  username                            = "platform_administrator"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = aws_kms_key.database.arn
  backup_retention_period             = 35
  backup_window                       = "06:00-07:00"
  maintenance_window                  = "sun:08:00-sun:09:00"
  delete_automated_backups            = false
  deletion_protection                 = true
  skip_final_snapshot                 = false
  final_snapshot_identifier           = var.final_snapshot_identifier
  copy_tags_to_snapshot               = true
  auto_minor_version_upgrade          = false
  allow_major_version_upgrade         = false
  apply_immediately                   = false
  iam_database_authentication_enabled = true
  performance_insights_enabled        = true
  performance_insights_kms_key_id     = aws_kms_key.database.arn
  enabled_cloudwatch_logs_exports     = ["postgresql", "upgrade"]
  lifecycle { prevent_destroy = true }
}
resource "aws_db_instance_automated_backups_replication" "this" {
  provider               = aws.backup
  source_db_instance_arn = aws_db_instance.this.arn
  kms_key_id             = aws_kms_key.backup.arn
  retention_period       = 35
}
output "endpoint" { value = aws_db_instance.this.address }
output "database_id" { value = aws_db_instance.this.identifier }
output "master_secret_arn" {
  description = "Break-glass/provisioning reference only; never granted to application roles."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}
output "invariants" {
  value = { multi_az = aws_db_instance.this.multi_az, public = aws_db_instance.this.publicly_accessible, encrypted = aws_db_instance.this.storage_encrypted, pitr_days = aws_db_instance.this.backup_retention_period, backup_days = aws_db_instance_automated_backups_replication.this.retention_period, managed_password = aws_db_instance.this.manage_master_user_password, final_snapshot = !aws_db_instance.this.skip_final_snapshot }
}
