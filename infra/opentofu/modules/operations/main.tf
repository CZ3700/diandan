variable "name" { type = string }
variable "account_id" { type = string }
variable "region" { type = string }
variable "cluster_name" { type = string }
variable "service_names" { type = map(string) }
variable "database_id" { type = string }
variable "alb_suffix" { type = string }
variable "target_groups" { type = map(string) }
variable "monthly_budget_usd" { type = number }
variable "notification_emails" { type = list(string) }
variable "repository_arns" { type = list(string) }
variable "task_role_arns" { type = list(string) }
variable "service_arns" { type = list(string) }
variable "oidc_provider_arn" { type = string }
variable "oidc_issuer" { type = string }
variable "oidc_subjects" { type = list(string) }
resource "aws_kms_key" "alerts" {
  description             = "${var.name} alert topic encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }, Action = "kms:*", Resource = "*" },
    { Effect = "Allow", Principal = { Service = ["cloudwatch.amazonaws.com", "budgets.amazonaws.com"] }, Action = ["kms:Decrypt", "kms:GenerateDataKey*"], Resource = "*", Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } } }
  ] })
}
resource "aws_sns_topic" "alerts" {
  name              = "${var.name}-alerts"
  kms_master_key_id = aws_kms_key.alerts.arn
}
resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }, Action = "SNS:*", Resource = aws_sns_topic.alerts.arn },
    { Effect = "Allow", Principal = { Service = ["cloudwatch.amazonaws.com", "budgets.amazonaws.com"] }, Action = "SNS:Publish", Resource = aws_sns_topic.alerts.arn, Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } } }
  ] })
}
resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.notification_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.key
}
resource "aws_cloudwatch_metric_alarm" "cpu" {
  for_each            = var.service_names
  alarm_name          = "${var.name}-${each.key}-cpu"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = { ClusterName = var.cluster_name, ServiceName = each.value }
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_metric_alarm" "task_count" {
  for_each            = var.service_names
  alarm_name          = "${var.name}-${each.key}-task-count"
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = { ClusterName = var.cluster_name, ServiceName = each.value }
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  period              = 60
  statistic           = "Minimum"
  threshold           = 2
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_metric_alarm" "healthy" {
  for_each            = var.target_groups
  alarm_name          = "${var.name}-${each.key}-healthy"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = { LoadBalancer = var.alb_suffix, TargetGroup = each.value }
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  period              = 60
  statistic           = "Minimum"
  threshold           = 2
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${var.name}-database-free-storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = var.database_id }
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  period              = 300
  statistic           = "Minimum"
  threshold           = 10737418240
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_metric_alarm" "target_errors" {
  alarm_name          = "${var.name}-target-5xx"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = var.alb_suffix }
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_budgets_budget" "monthly" {
  name         = var.name
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  # Account-wide rather than tag-filtered so untagged spend cannot evade the guardrail.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.notification_emails
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.notification_emails
  }
}
resource "aws_ce_anomaly_monitor" "services" {
  name              = var.name
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}
resource "aws_ce_anomaly_subscription" "this" {
  name             = var.name
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.services.arn]
  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.monthly_budget_usd * 0.1)]
    }
  }
  dynamic "subscriber" {
    for_each = toset(var.notification_emails)
    content {
      type    = "EMAIL"
      address = subscriber.value
    }
  }
}
data "aws_servicequotas_service_quota" "fargate" {
  service_code = "fargate"
  quota_code   = "L-3032A538"
}
resource "aws_cloudwatch_metric_alarm" "fargate_quota" {
  alarm_name          = "${var.name}-fargate-quota"
  namespace           = "AWS/Usage"
  metric_name         = "ResourceCount"
  dimensions          = { Service = "Fargate", Type = "Resource", Resource = "vCPU", Class = "Standard/OnDemand" }
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 60
  statistic           = "Maximum"
  threshold           = data.aws_servicequotas_service_quota.fargate.value * 0.8
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_iam_role" "deployment" {
  name = "${var.name}-deployment"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Federated = var.oidc_provider_arn }, Action = "sts:AssumeRoleWithWebIdentity", Condition = { StringEquals = { "${var.oidc_issuer}:aud" = "sts.amazonaws.com", "${var.oidc_issuer}:sub" = var.oidc_subjects } }
  }] })
}
resource "aws_iam_role_policy" "deployment" {
  role = aws_iam_role.deployment.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:DescribeImages", "ecr:BatchGetImage"], Resource = var.repository_arns },
    { Effect = "Allow", Action = ["ecs:UpdateService", "ecs:DescribeServices"], Resource = var.service_arns },
    { Effect = "Allow", Action = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"], Resource = "*" },
    { Effect = "Allow", Action = "iam:PassRole", Resource = var.task_role_arns, Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } } }
  ] })
}
output "invariants" { value = { monthly_budget = var.monthly_budget_usd, alarm_count = length(aws_cloudwatch_metric_alarm.cpu) + length(aws_cloudwatch_metric_alarm.task_count) + length(aws_cloudwatch_metric_alarm.healthy) + 3, quota_code = data.aws_servicequotas_service_quota.fargate.quota_code, subscription_confirmation_required = true, deployment_uses_oidc = true } }
output "deployment_role_arn" { value = aws_iam_role.deployment.arn }
