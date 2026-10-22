output "primary_health_check_id" {
  description = "Route53 health check ID for the primary endpoint."
  value       = aws_route53_health_check.primary.id
}

output "standby_health_check_id" {
  description = "Route53 health check ID for the standby endpoint."
  value       = aws_route53_health_check.standby.id
}
