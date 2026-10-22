resource "aws_route53_health_check" "primary" {
  fqdn              = var.primary_endpoint_dns
  port              = var.health_check_port
  type              = "HTTPS"
  resource_path     = var.health_check_path
  request_interval  = 30
  failure_threshold = 1
  enable_sni        = true

  tags = {
    Name = "${var.record_name}-primary-health"
  }
}

resource "aws_route53_health_check" "standby" {
  fqdn              = var.standby_endpoint_dns
  port              = var.health_check_port
  type              = "HTTPS"
  resource_path     = var.health_check_path
  request_interval  = 30
  failure_threshold = 1
  enable_sni        = true

  tags = {
    Name = "${var.record_name}-standby-health"
  }
}

resource "aws_route53_record" "primary" {
  zone_id        = var.hosted_zone_id
  name           = var.record_name
  type           = "CNAME"
  ttl            = 30
  set_identifier = "primary"

  failover_routing_policy {
    type = "PRIMARY"
  }

  health_check_id = aws_route53_health_check.primary.id
  records         = [var.primary_endpoint_dns]
}

resource "aws_route53_record" "standby" {
  zone_id        = var.hosted_zone_id
  name           = var.record_name
  type           = "CNAME"
  ttl            = 30
  set_identifier = "standby"

  failover_routing_policy {
    type = "SECONDARY"
  }

  health_check_id = aws_route53_health_check.standby.id
  records         = [var.standby_endpoint_dns]
}
