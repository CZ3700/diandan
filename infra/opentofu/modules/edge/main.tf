variable "name" { type = string }
variable "domains" { type = object({ storefront = string, admin = string, origin = string, media = string }) }
variable "aliases" { type = list(string) }
variable "zone_id" { type = string }
variable "alb" { type = object({ arn = string, dns_name = string, zone_id = string, arn_suffix = string }) }
variable "derivative_domain" { type = string }
variable "waf_enforce" { type = bool }
variable "rate_limit" { type = number }
variable "rate_limit_window_seconds" { type = number }
variable "operation_rate_limits" {
  type = map(object({ limit = number, window_seconds = number }))
}
locals {
  # Source-owned route scopes; one IP bucket per operation spans BFF/API and all IDs.
  operation_rate_routes = jsondecode(<<-ROUTES
{
  "LOGIN": [
    {
      "method": "POST",
      "path": "^/api/(admin/auth/(begin|logout)|v1/admin/access/(begin|callback|logout))/?$"
    },
    {
      "method": "GET",
      "path": "^/api/admin/auth/callback/?$"
    }
  ],
  "ORDER_ACCESS": [
    {
      "method": "POST",
      "path": "^/api/(storefront|v1)/(order-access/(exchange|revoke|locate)|checkout/sessions/[^/]+/order-access)/?$"
    },
    {
      "method": "GET",
      "path": "^/api/(storefront|v1)/orders/[^/]+/?$"
    },
    {
      "method": "GET",
      "path": "^/api/(storefront|v1)/orders/[^/]+/delivery-proofs/[^/]+/(thumbnail|display)/?$"
    }
  ],
  "CART": [
    {
      "method": "POST",
      "path": "^/api/(storefront/cart(/items(/[^/]+/editor)?|/validate)?|v1/(carts|cart/(items(/[^/]+/editor)?|validate)))/?$"
    },
    {
      "method": "GET",
      "path": "^/api/(storefront|v1)/cart/?$"
    },
    {
      "method": "PATCH",
      "path": "^/api/(storefront|v1)/cart/items/[^/]+/?$"
    },
    {
      "method": "DELETE",
      "path": "^/api/(storefront|v1)/cart/items/[^/]+/?$"
    }
  ],
  "PAYMENT_CREATE": [
    {
      "method": "POST",
      "path": "^/api/(storefront|v1)/checkout/sessions(/[^/]+/attempts(/[^/]+/recover)?)?/?$"
    }
  ],
  "REFUND": [
    {
      "method": "POST",
      "path": "^/api/(admin/finance-refund|v1/admin/finance/refund)/?$"
    }
  ],
  "WEBHOOK": [
    {
      "method": "POST",
      "path": "^/api/v1/webhooks/payments/[^/]+/?$"
    }
  ]
}
ROUTES
  )
}
resource "aws_acm_certificate" "this" {
  domain_name               = var.domains.storefront
  subject_alternative_names = concat([var.domains.admin, var.domains.origin, var.domains.media], var.aliases)
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}
resource "aws_route53_record" "validation" {
  for_each = { for domain in concat(values(var.domains), var.aliases) : domain => domain }
  zone_id  = var.zone_id
  name     = one([for option in aws_acm_certificate.this.domain_validation_options : option.resource_record_name if option.domain_name == each.key])
  type     = one([for option in aws_acm_certificate.this.domain_validation_options : option.resource_record_type if option.domain_name == each.key])
  records  = [one([for option in aws_acm_certificate.this.domain_validation_options : option.resource_record_value if option.domain_name == each.key])]
  ttl      = 300
}
resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]
}
resource "aws_route53_record" "origin" {
  zone_id = var.zone_id
  name    = var.domains.origin
  type    = "A"
  alias {
    name                   = var.alb.dns_name
    zone_id                = var.alb.zone_id
    evaluate_target_health = true
  }
}
resource "aws_cloudfront_vpc_origin" "this" {
  vpc_origin_endpoint_config {
    name                   = var.name
    arn                    = var.alb.arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "https-only"
    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }
}
resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.name}-media"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_cache_policy" "private" {
  name        = "${var.name}-no-store"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 0
  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}
resource "aws_cloudfront_cache_policy" "immutable" {
  name        = "${var.name}-immutable"
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}
resource "aws_cloudfront_cache_policy" "application_static" {
  name        = "${var.name}-application-static"
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config { cookie_behavior = "none" }
    headers_config {
      header_behavior = "whitelist"
      headers { items = ["Host"] }
    }
    query_strings_config { query_string_behavior = "none" }
  }
}
resource "aws_cloudfront_origin_request_policy" "application" {
  name = "${var.name}-all-viewer"
  cookies_config { cookie_behavior = "all" }
  headers_config { header_behavior = "allViewer" }
  query_strings_config { query_string_behavior = "all" }
}
resource "aws_cloudfront_response_headers_policy" "private" {
  name = "${var.name}-private"
  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "private, no-store"
      override = true
    }
    items {
      header   = "Referrer-Policy"
      value    = "no-referrer"
      override = true
    }
  }
  security_headers_config {
    content_type_options { override = true }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }
  }
}
resource "aws_cloudfront_function" "canonical" {
  name    = "${var.name}-canonical"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      var aliases = ${jsonencode(var.aliases)};
      if (aliases.indexOf(request.headers.host.value) < 0) return request;
      var pairs = [];
      Object.keys(request.querystring).forEach(function (key) {
        var item = request.querystring[key];
        (item.multiValue || [item]).forEach(function (value) {
          pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value.value));
        });
      });
      return { statusCode: 308, statusDescription: 'Permanent Redirect', headers: {
        location: { value: 'https://${var.domains.storefront}' + request.uri + (pairs.length ? '?' + pairs.join('&') : '') },
        'cache-control': { value: 'private, no-store' },
        'referrer-policy': { value: 'no-referrer' }
      }};
    }
  JS
}
resource "aws_wafv2_web_acl" "this" {
  name  = var.name
  scope = "CLOUDFRONT"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = false
  }
  rule {
    name     = "managed-baseline"
    priority = 1
    override_action {
      dynamic "count" {
        for_each = var.waf_enforce ? [] : [1]
        content {}
      }
      dynamic "none" {
        for_each = var.waf_enforce ? [1] : []
        content {}
      }
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-managed"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "rate-limit"
    priority = 2
    action {
      dynamic "count" {
        for_each = var.waf_enforce ? [] : [1]
        content {}
      }
      dynamic "block" {
        for_each = var.waf_enforce ? [1] : []
        content {}
      }
    }
    statement {
      rate_based_statement {
        aggregate_key_type    = "IP"
        limit                 = var.rate_limit
        evaluation_window_sec = var.rate_limit_window_seconds
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate"
      sampled_requests_enabled   = false
    }
  }
  dynamic "rule" {
    for_each = local.operation_rate_routes
    content {
      name     = "operation-${rule.key}"
      priority = 10 + index(sort(keys(local.operation_rate_routes)), rule.key)
      action {
        dynamic "count" {
          for_each = var.waf_enforce ? [] : [1]
          content {}
        }
        dynamic "block" {
          for_each = var.waf_enforce ? [1] : []
          content {}
        }
      }
      statement {
        rate_based_statement {
          aggregate_key_type    = "IP"
          limit                 = var.operation_rate_limits[rule.key].limit
          evaluation_window_sec = var.operation_rate_limits[rule.key].window_seconds
          scope_down_statement {
            dynamic "and_statement" {
              for_each = length(rule.value) == 1 ? rule.value : []
              content {

                statement {
                  byte_match_statement {
                    field_to_match {
                      method {}
                    }
                    positional_constraint = "EXACTLY"
                    search_string         = and_statement.value.method
                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }
                statement {
                  regex_match_statement {
                    field_to_match {
                      uri_path {}
                    }
                    regex_string = and_statement.value.path
                    text_transformation {
                      priority = 0
                      type     = "URL_DECODE"
                    }
                    text_transformation {
                      priority = 1
                      type     = "NORMALIZE_PATH"
                    }
                  }
                }

              }
            }
            dynamic "or_statement" {
              for_each = length(rule.value) > 1 ? [rule.value] : []
              content {
                dynamic "statement" {
                  for_each = or_statement.value
                  content {
                    and_statement {
                      statement {
                        byte_match_statement {
                          field_to_match {
                            method {}
                          }
                          positional_constraint = "EXACTLY"
                          search_string         = statement.value.method
                          text_transformation {
                            priority = 0
                            type     = "NONE"
                          }
                        }
                      }
                      statement {
                        regex_match_statement {
                          field_to_match {
                            uri_path {}
                          }
                          regex_string = statement.value.path
                          text_transformation {
                            priority = 0
                            type     = "URL_DECODE"
                          }
                          text_transformation {
                            priority = 1
                            type     = "NORMALIZE_PATH"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name}-${lower(rule.key)}"
        sampled_requests_enabled   = false
      }
    }
  }
}
resource "aws_cloudfront_distribution" "application" {
  enabled         = true
  is_ipv6_enabled = true
  aliases         = concat([var.domains.storefront, var.domains.admin], var.aliases)
  web_acl_id      = aws_wafv2_web_acl.this.arn
  http_version    = "http2and3"
  origin {
    origin_id   = "application"
    domain_name = var.domains.origin
    vpc_origin_config { vpc_origin_id = aws_cloudfront_vpc_origin.this.id }
  }
  default_cache_behavior {
    target_origin_id           = "application"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.private.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.application.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.private.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.canonical.arn
    }
  }
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "application"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.application_static.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.canonical.arn
    }
  }
  dynamic "custom_error_response" {
    for_each = toset([403, 404, 500, 502, 503, 504])
    content {
      error_code            = custom_error_response.value
      error_caching_min_ttl = 0
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.this.certificate_arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }
  # Never enable raw CloudFront logs/cookies; app emits allowlisted events instead.
}
resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  is_ipv6_enabled = true
  aliases         = [var.domains.media]
  web_acl_id      = aws_wafv2_web_acl.this.arn
  http_version    = "http2and3"
  origin {
    origin_id                = "derivative"
    domain_name              = var.derivative_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }
  default_cache_behavior {
    target_origin_id       = "derivative"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.immutable.id
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.this.certificate_arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }
}
locals {
  records = merge({ for domain in concat([var.domains.storefront, var.domains.admin], var.aliases) : domain => { dns_name = aws_cloudfront_distribution.application.domain_name, zone_id = aws_cloudfront_distribution.application.hosted_zone_id } }, { (var.domains.media) = { dns_name = aws_cloudfront_distribution.media.domain_name, zone_id = aws_cloudfront_distribution.media.hosted_zone_id } })
}
resource "aws_route53_record" "ipv4" {
  for_each = local.records
  zone_id  = var.zone_id
  name     = each.key
  type     = "A"
  alias {
    name                   = each.value.dns_name
    zone_id                = each.value.zone_id
    evaluate_target_health = false
  }
}
resource "aws_route53_record" "ipv6" {
  for_each = local.records
  zone_id  = var.zone_id
  name     = each.key
  type     = "AAAA"
  alias {
    name                   = each.value.dns_name
    zone_id                = each.value.zone_id
    evaluate_target_health = false
  }
}
output "certificate_arn" { value = aws_acm_certificate_validation.this.certificate_arn }
output "distribution_arn" { value = aws_cloudfront_distribution.application.arn }
output "media_distribution_arn" { value = aws_cloudfront_distribution.media.arn }
output "distribution_id" { value = aws_cloudfront_distribution.application.id }
output "invariants" {
  value = merge({ private_origin = true, origin_protocol = aws_cloudfront_vpc_origin.this.vpc_origin_endpoint_config[0].origin_protocol_policy, dynamic_cache_ttl = aws_cloudfront_cache_policy.private.max_ttl, no_store = anytrue([for item in aws_cloudfront_response_headers_policy.private.custom_headers_config[0].items : item.header == "Cache-Control" && item.value == "private, no-store" && item.override]), oac_signing = aws_cloudfront_origin_access_control.media.signing_behavior, waf_enforce = var.waf_enforce, managed_count = sum([for rule in aws_wafv2_web_acl.this.rule : length(rule.override_action) > 0 ? length(rule.override_action[0].count) : 0]) > 0, rate_count = sum([for rule in aws_wafv2_web_acl.this.rule : length(rule.action) > 0 ? length(rule.action[0].count) : 0]) > 0, sampled_requests = aws_wafv2_web_acl.this.visibility_config[0].sampled_requests_enabled, error_cache_ttl = max([for error in aws_cloudfront_distribution.application.custom_error_response : error.error_caching_min_ttl]...) }, {
    global_rate_limit = one([for rule in aws_wafv2_web_acl.this.rule : {
      limit              = rule.statement[0].rate_based_statement[0].limit
      window_seconds     = rule.statement[0].rate_based_statement[0].evaluation_window_sec
      aggregate_key_type = rule.statement[0].rate_based_statement[0].aggregate_key_type
    } if rule.name == "rate-limit"])
    operation_rates = { for rule in aws_wafv2_web_acl.this.rule : trimprefix(rule.name, "operation-") => {
      limit              = rule.statement[0].rate_based_statement[0].limit
      window_seconds     = rule.statement[0].rate_based_statement[0].evaluation_window_sec
      aggregate_key_type = rule.statement[0].rate_based_statement[0].aggregate_key_type
      count              = length(rule.action[0].count) == 1
      block              = length(rule.action[0].block) == 1
      sampled_requests   = rule.visibility_config[0].sampled_requests_enabled
      scope              = rule.statement[0].rate_based_statement[0].scope_down_statement
    } if startswith(rule.name, "operation-") }
    operation_routes = local.operation_rate_routes
  })
}
