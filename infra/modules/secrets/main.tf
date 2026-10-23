variable "name_prefix" {
  description = "Prefix used for ai-net secret names."
  type        = string
  default     = "ai-net"
}

resource "aws_secretsmanager_secret" "pagerduty_integration_key" {
  name                    = "${var.name_prefix}/pagerduty/integration-key"
  description             = "PagerDuty Events API integration key for P1 alerts."
  recovery_window_in_days = 7
}

output "pagerduty_integration_key_arn" {
  description = "ARN to reference when injecting the PagerDuty key into the alerting service."
  value       = aws_secretsmanager_secret.pagerduty_integration_key.arn
}