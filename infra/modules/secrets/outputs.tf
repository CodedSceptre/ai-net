output "secret_arns" {
  value       = [for s in aws_secretsmanager_secret.app : s.arn]
  description = "ARNs of all application secrets"
}

output "rotation_lambda_arn" {
  value       = aws_lambda_function.rotation.arn
  description = "ARN of the secret rotation Lambda"
}

output "cloudtrail_arn" {
  value       = aws_cloudtrail.secrets_audit.arn
  description = "ARN of the CloudTrail audit trail for secret rotation"
}

output "ecs_environment_secrets" {
  value = {
    auth_jwt_secret            = aws_secretsmanager_secret.app["jwt_secret"].arn
    venice_api_key             = aws_secretsmanager_secret.app["venice_api_key"].arn
    stellar_coordinator_secret = aws_secretsmanager_secret.app["stellar_coordinator_secret"].arn
    admin_api_key              = aws_secretsmanager_secret.app["admin_api_key"].arn
  }
}
