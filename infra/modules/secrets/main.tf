# ── Secrets Manager ───────────────────────────────────────────────────────────
# Placeholders – values are set via the AWS Console or rotation lambdas.
# Do NOT store real values in Terraform code or state.

locals {
  secrets = {
    venice_api_key              = "Venice AI API key for LLM inference"
    stellar_coordinator_secret  = "Stellar coordinator hot-wallet secret key"
    admin_api_key               = "Admin API key for protected backend endpoints"
    redis_url                   = "Redis connection URL including credentials"
    db_password                 = "RDS master password (managed separately; stored here for app reference)"
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.secrets

  name        = "ai-net/${var.environment}/${each.key}"
  description = each.value

  # Automatic rotation is configured per-secret after initial deployment.
  # See docs/NODE_OPERATORS_GUIDE.md §Secret Rotation for rotation lambda setup.
  recovery_window_in_days = var.environment == "production" ? 30 : 7

  tags = { Name = "ai-net-${var.environment}-${each.key}" }
}

# Placeholder versions – real values must be populated before deploying ECS tasks.
# Use: aws secretsmanager put-secret-value --secret-id <arn> --secret-string '<value>'
resource "aws_secretsmanager_secret_version" "app" {
  for_each = local.secrets

  secret_id     = aws_secretsmanager_secret.app[each.key].id
  secret_string = "PLACEHOLDER_REPLACE_BEFORE_DEPLOY"

  lifecycle {
    # Prevent Terraform from overwriting values set externally (e.g., via rotation).
    ignore_changes = [secret_string]
  }
}
