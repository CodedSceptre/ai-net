output "secret_arns" {
  value       = [for s in aws_secretsmanager_secret.app : s.arn]
  description = "ARNs of all application secrets"
}
