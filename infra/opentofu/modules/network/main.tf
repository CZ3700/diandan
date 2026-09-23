variable "name" { type = string }
variable "region" { type = string }
variable "vpc_cidr" { type = string }
variable "availability_zone_ids" {
  type = list(string)
  validation {
    condition     = length(var.availability_zone_ids) >= 2 && length(distinct(var.availability_zone_ids)) == length(var.availability_zone_ids)
    error_message = "At least two distinct availability zones are required."
  }
}
locals {
  zones = { for index, zone in var.availability_zone_ids : zone => index }
  ports = { storefront = 3000, admin = 3000, api = 3002, worker = 3003 }
}
resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = var.name }
}
# CloudFront VPC origins require an attached IGW; private subnets never route to it.
resource "aws_internet_gateway" "this" { vpc_id = aws_vpc.this.id }
resource "aws_subnet" "public" {
  for_each                = local.zones
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, each.value)
  availability_zone_id    = each.key
  map_public_ip_on_launch = false
}
resource "aws_subnet" "application" {
  for_each                = local.zones
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, each.value + 16)
  availability_zone_id    = each.key
  map_public_ip_on_launch = false
}
resource "aws_subnet" "database" {
  for_each                = local.zones
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, each.value + 32)
  availability_zone_id    = each.key
  map_public_ip_on_launch = false
}
resource "aws_route_table" "public" { vpc_id = aws_vpc.this.id }
resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}
resource "aws_route_table_association" "public" {
  for_each       = local.zones
  subnet_id      = aws_subnet.public[each.key].id
  route_table_id = aws_route_table.public.id
}
resource "aws_eip" "nat" {
  for_each = local.zones
  domain   = "vpc"
}
resource "aws_nat_gateway" "this" {
  for_each      = local.zones
  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.public[each.key].id
  depends_on    = [aws_internet_gateway.this]
}
resource "aws_route_table" "application" {
  for_each = local.zones
  vpc_id   = aws_vpc.this.id
}
resource "aws_route" "egress" {
  for_each               = local.zones
  route_table_id         = aws_route_table.application[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[each.key].id
}
resource "aws_route_table_association" "application" {
  for_each       = local.zones
  subnet_id      = aws_subnet.application[each.key].id
  route_table_id = aws_route_table.application[each.key].id
}
resource "aws_route_table" "database" { vpc_id = aws_vpc.this.id }
resource "aws_route_table_association" "database" {
  for_each       = local.zones
  subnet_id      = aws_subnet.database[each.key].id
  route_table_id = aws_route_table.database.id
}
resource "aws_security_group" "alb" {
  name_prefix = "${var.name}-alb-"
  vpc_id      = aws_vpc.this.id
}
resource "aws_security_group" "application" {
  for_each    = local.ports
  name_prefix = "${var.name}-${each.key}-"
  vpc_id      = aws_vpc.this.id
}
resource "aws_security_group" "database" {
  name_prefix = "${var.name}-database-"
  vpc_id      = aws_vpc.this.id
}
resource "aws_security_group" "endpoints" {
  name_prefix = "${var.name}-endpoints-"
  vpc_id      = aws_vpc.this.id
}
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}
resource "aws_vpc_security_group_ingress_rule" "cloudfront" {
  security_group_id = aws_security_group.alb.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}
resource "aws_vpc_security_group_ingress_rule" "internal_api" {
  for_each                     = toset(["storefront", "admin", "api", "worker"])
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.application[each.key].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}
resource "aws_vpc_security_group_ingress_rule" "application" {
  for_each                     = { for app, port in local.ports : app => port if app != "worker" }
  security_group_id            = aws_security_group.application[each.key].id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = each.value
  to_port                      = each.value
  ip_protocol                  = "tcp"
}
resource "aws_vpc_security_group_egress_rule" "alb" {
  for_each                     = { for app, port in local.ports : app => port if app != "worker" }
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.application[each.key].id
  from_port                    = each.value
  to_port                      = each.value
  ip_protocol                  = "tcp"
}
resource "aws_vpc_security_group_ingress_rule" "postgres" {
  for_each                     = toset(["api", "worker"])
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.application[each.key].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
resource "aws_vpc_security_group_egress_rule" "postgres" {
  for_each                     = toset(["api", "worker"])
  security_group_id            = aws_security_group.application[each.key].id
  referenced_security_group_id = aws_security_group.database.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
# HTTPS egress supports explicitly configured PSP/OIDC/mail services through per-AZ NAT.
resource "aws_vpc_security_group_egress_rule" "https" {
  for_each          = local.ports
  security_group_id = aws_security_group.application[each.key].id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}
resource "aws_vpc_security_group_ingress_rule" "endpoints" {
  for_each                     = local.ports
  security_group_id            = aws_security_group.endpoints.id
  referenced_security_group_id = aws_security_group.application[each.key].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}
resource "aws_vpc_endpoint" "interface" {
  for_each            = toset(["ecr.api", "ecr.dkr", "logs", "secretsmanager", "kms"])
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.application : subnet.id]
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true
}
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for table in aws_route_table.application : table.id]
}
output "vpc_id" { value = aws_vpc.this.id }
output "application_subnet_ids" { value = [for subnet in aws_subnet.application : subnet.id] }
output "database_subnet_ids" { value = [for subnet in aws_subnet.database : subnet.id] }
output "alb_security_group_id" { value = aws_security_group.alb.id }
output "application_security_group_ids" { value = { for app, group in aws_security_group.application : app => group.id } }
output "database_security_group_id" { value = aws_security_group.database.id }
output "invariants" {
  value = { az_count = length(local.zones), private_application = alltrue([for subnet in aws_subnet.application : !subnet.map_public_ip_on_launch]), isolated_database = length(aws_route_table_association.database) == length(local.zones), nat_per_az = length(aws_nat_gateway.this), worker_ingress = contains(keys(aws_vpc_security_group_ingress_rule.application), "worker") }
}
