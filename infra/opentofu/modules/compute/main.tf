variable "name" { type = string }
variable "region" { type = string }
variable "account_id" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_ids" { type = map(string) }
variable "alb_security_group_id" { type = string }
variable "certificate_arn" { type = string }
variable "domains" { type = object({ storefront = string, admin = string, origin = string, media = string }) }
variable "images" { type = map(string) }
variable "environment" { type = map(map(string)) }
variable "secrets" { type = map(map(string)) }
variable "secret_kms_key_arns" { type = map(list(string)) }
variable "media" { type = map(object({ id = string, arn = string, domain = string })) }
variable "media_kms_key_arn" { type = string }
variable "application_kms_key_arns" { type = map(list(string)) }
variable "application_mac_key_arns" { type = map(list(string)) }
variable "distribution_arn" { type = string }
variable "task_cpu" { type = number }
variable "task_memory" { type = number }
variable "log_retention_days" { type = number }
locals {
  ports       = { storefront = 3000, admin = 3000, api = 3002, worker = 3003 }
  http        = { for app, port in local.ports : app => port if app != "worker" }
  assume_task = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole", Condition = { StringEquals = { "aws:SourceAccount" = var.account_id }, ArnLike = { "aws:SourceArn" = "arn:aws:ecs:${var.region}:${var.account_id}:*" } } }] })
}
data "aws_ecr_repository" "application" {
  for_each = local.ports
  name     = "${var.name}/${each.key}"
}
resource "aws_kms_key" "logs" {
  description             = "${var.name} CloudWatch platform logs"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }, Action = "kms:*", Resource = "*" },
    { Effect = "Allow", Principal = { Service = "logs.${var.region}.amazonaws.com" }, Action = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"], Resource = "*", Condition = { ArnLike = { "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/ecs/${var.name}/*" } } }
  ] })
}
resource "aws_cloudwatch_log_group" "application" {
  for_each          = local.ports
  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn
}
resource "aws_iam_role" "execution" {
  for_each           = local.ports
  name               = "${var.name}-${each.key}-execution"
  assume_role_policy = local.assume_task
}
resource "aws_iam_role_policy" "execution" {
  for_each = local.ports
  role     = aws_iam_role.execution[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = data.aws_ecr_repository.application[each.key].arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.application[each.key].arn}:*" }
    ], length(var.secrets[each.key]) == 0 ? [] : [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = values(var.secrets[each.key]) }
    ], length(var.secret_kms_key_arns[each.key]) == 0 ? [] : [
    { Effect = "Allow", Action = "kms:Decrypt", Resource = var.secret_kms_key_arns[each.key], Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.${var.region}.amazonaws.com" } } }
  ]) })
}
resource "aws_iam_role" "application" {
  for_each           = local.ports
  name               = "${var.name}-${each.key}-application"
  assume_role_policy = local.assume_task
}
resource "aws_iam_role_policy" "media" {
  for_each = toset(["api", "worker"])
  role     = aws_iam_role.application[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:AbortMultipartUpload"], Resource = "${var.media.source.arn}/*" },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion"], Resource = "${var.media.derivative.arn}/*" },
    { Effect = "Allow", Action = ["s3:ListBucket", "s3:ListBucketVersions"], Resource = [var.media.source.arn, var.media.derivative.arn] },
    { Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = var.media_kms_key_arn, Condition = { StringEquals = { "kms:ViaService" = "s3.${var.region}.amazonaws.com" } } }
    ], each.key == "worker" ? [
    { Effect = "Allow", Action = ["s3:PutObject", "s3:AbortMultipartUpload"], Resource = "${var.media.derivative.arn}/*" },
    { Effect = "Allow", Action = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"], Resource = var.distribution_arn }
  ] : []) })
}
resource "aws_iam_role_policy" "application_kms" {
  for_each = { for app, arns in var.application_kms_key_arns : app => arns if length(arns) > 0 }
  role     = aws_iam_role.application[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext"], Resource = each.value }
  ] })
}
resource "aws_iam_role_policy" "application_mac" {
  for_each = { for app, arns in var.application_mac_key_arns : app => arns if length(arns) > 0 }
  role     = aws_iam_role.application[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["kms:GenerateMac"], Resource = each.value }
  ] })
}
resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}
resource "aws_lb" "this" {
  name                       = var.name
  internal                   = true
  load_balancer_type         = "application"
  subnets                    = var.subnet_ids
  security_groups            = [var.alb_security_group_id]
  enable_deletion_protection = true
  drop_invalid_header_fields = true
  desync_mitigation_mode     = "strictest"
  # Raw ALB access logs contain query strings; no token/PII-safe format exists here.
}
resource "aws_lb_target_group" "application" {
  for_each             = local.http
  name                 = "${var.name}-${each.key}"
  port                 = each.value
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30
  health_check {
    path                = "/healthz"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
  }
}
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  condition {
    path_pattern { values = ["/api/v1/*"] }
  }
  condition {
    host_header { values = [var.domains.storefront, var.domains.admin, var.domains.origin] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.application["api"].arn
  }
}
resource "aws_lb_listener_rule" "frontend" {
  for_each     = toset(["storefront", "admin"])
  listener_arn = aws_lb_listener.https.arn
  priority     = each.key == "storefront" ? 20 : 30
  condition {
    host_header { values = [var.domains[each.key]] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.application[each.key].arn
  }
}
resource "aws_ecs_task_definition" "application" {
  for_each                 = local.ports
  family                   = "${var.name}-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution[each.key].arn
  task_role_arn            = aws_iam_role.application[each.key].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = each.key
    image                  = var.images[each.key]
    essential              = true
    readonlyRootFilesystem = false
    user                   = "1000:1000"
    portMappings           = [{ containerPort = each.value, protocol = "tcp" }]
    environment            = [for name, value in var.environment[each.key] : { name = name, value = value }]
    secrets                = [for name, arn in var.secrets[each.key] : { name = name, valueFrom = arn }]
    linuxParameters        = { initProcessEnabled = true, capabilities = { drop = ["ALL"] } }
    healthCheck            = { command = ["CMD", "node", "-e", "fetch('http://127.0.0.1:${each.value}/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"], interval = 15, timeout = 5, retries = 3, startPeriod = 60 }
    logConfiguration       = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.application[each.key].name, awslogs-region = var.region, awslogs-stream-prefix = each.key } }
    stopTimeout            = 120
  }])
}
resource "aws_ecs_service" "application" {
  for_each                           = local.ports
  name                               = each.key
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.application[each.key].arn
  desired_count                      = 2
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  availability_zone_rebalancing      = "ENABLED"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  enable_execute_command             = false
  wait_for_steady_state              = true
  health_check_grace_period_seconds  = each.key == "worker" ? null : 90
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_ids[each.key]]
    assign_public_ip = false
  }
  dynamic "load_balancer" {
    for_each = each.key == "worker" ? [] : [each.key]
    content {
      target_group_arn = aws_lb_target_group.application[each.key].arn
      container_name   = each.key
      container_port   = each.value
    }
  }
  depends_on = [aws_lb_listener_rule.api, aws_lb_listener_rule.frontend, aws_iam_role_policy.execution, aws_iam_role_policy.media, aws_iam_role_policy.application_kms, aws_iam_role_policy.application_mac]
}
output "alb" {
  value      = { arn = aws_lb.this.arn, dns_name = aws_lb.this.dns_name, zone_id = aws_lb.this.zone_id, arn_suffix = aws_lb.this.arn_suffix }
  depends_on = [aws_lb_listener.https]
}
output "cluster_name" { value = aws_ecs_cluster.this.name }
output "service_names" { value = { for app, service in aws_ecs_service.application : app => service.name } }
output "target_groups" { value = { for app, group in aws_lb_target_group.application : app => group.arn_suffix } }
output "repository_arns" { value = [for repository in data.aws_ecr_repository.application : repository.arn] }
output "task_role_arns" { value = concat([for role in aws_iam_role.application : role.arn], [for role in aws_iam_role.execution : role.arn]) }
output "service_arns" { value = [for service in aws_ecs_service.application : service.id] }
output "invariants" {
  value = { services = { for app, service in aws_ecs_service.application : app => { desired_count = service.desired_count, public_ip = service.network_configuration[0].assign_public_ip, ingress = app != "worker" } }, internal_alb = aws_lb.this.internal, images = { for app, task in aws_ecs_task_definition.application : app => jsondecode(task.container_definitions)[0].image }, separate_roles = length(aws_iam_role.application), backend_paths = flatten([for condition in aws_lb_listener_rule.api.condition : [for pattern in condition.path_pattern : pattern.values]]), application_envelope_actions = { for app, policy in aws_iam_role_policy.application_kms : app => jsondecode(policy.policy).Statement[0].Action }, application_mac_actions = { for app, policy in aws_iam_role_policy.application_mac : app => jsondecode(policy.policy).Statement[0].Action }, no_secret_values = true }
}
