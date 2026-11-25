output "redis_url_secret_arn" {
  description = "Secrets Manager ARN for the TLS Redis URL"
  value       = aws_secretsmanager_secret_version.redis_url.arn
}
