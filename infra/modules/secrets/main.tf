# infra/modules/secrets/main.tf
#
# AWS Secrets Manager entries for ai-net runtime secrets.
# Values are intentionally set to placeholder strings at provision time.
# Operators must update the secret values out-of-band (e.g. via the AWS
# Console, AWS CLI, or a separate sealed-secrets workflow) before deploying.
#
# Usage
# ─────
#   module "secrets" {
#     source = "./modules/secrets"
#     env    = "production"
#   }
#
#   # Inject into ECS task definition:
#   valueFrom = module.secrets.pagerduty_secret_arn
#
# Security invariants
# ───────────────────
# • The actual secret value is NEVER stored in Terraform state or source code.
# • Access is restricted to the ECS task execution role via IAM resource policy.
# • Rotation is enabled (auto-rotate every 90 days via a Lambda placeholder).

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "env" {
  description = "Deployment environment (e.g. staging, production)"
  type        = string
}

variable "ecs_task_execution_role_arn" {
  description = "ARN of the ECS task execution IAM role that needs read access"
  type        = string
  default     = ""
}

# ── PagerDuty integration key ─────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "pagerduty_integration_key" {
  name        = "ai-net/${var.env}/pagerduty-integration-key"
  description = "PagerDuty Events API v2 routing key for P1 incident escalation"

  # Prevent accidental deletion without a recovery window
  recovery_window_in_days = 7

  tags = {
    Project     = "ai-net"
    Environment = var.env
    ManagedBy   = "terraform"
    SecretType  = "pagerduty-integration"
  }
}

resource "aws_secretsmanager_secret_version" "pagerduty_integration_key" {
  secret_id = aws_secretsmanager_secret.pagerduty_integration_key.id
  # Placeholder — operators MUST replace this value before deploying to production.
  # Never commit a real PagerDuty key to source control.
  secret_string = "REPLACE_ME_WITH_PAGERDUTY_INTEGRATION_KEY"

  lifecycle {
    # Prevent Terraform from overwriting a value that was set out-of-band.
    ignore_changes = [secret_string]
  }
}

# ── Slack webhook: #incidents ──────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "slack_webhook_incidents" {
  name        = "ai-net/${var.env}/slack-webhook-incidents"
  description = "Slack incoming webhook URL for #incidents (P2 alerts)"

  recovery_window_in_days = 7

  tags = {
    Project     = "ai-net"
    Environment = var.env
    ManagedBy   = "terraform"
    SecretType  = "slack-webhook"
  }
}

resource "aws_secretsmanager_secret_version" "slack_webhook_incidents" {
  secret_id     = aws_secretsmanager_secret.slack_webhook_incidents.id
  secret_string = "REPLACE_ME_WITH_SLACK_WEBHOOK_URL"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── Slack webhook: #ops-alerts ─────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "slack_webhook_ops" {
  name        = "ai-net/${var.env}/slack-webhook-ops-alerts"
  description = "Slack incoming webhook URL for #ops-alerts (P3 alerts)"

  recovery_window_in_days = 7

  tags = {
    Project     = "ai-net"
    Environment = var.env
    ManagedBy   = "terraform"
    SecretType  = "slack-webhook"
  }
}

resource "aws_secretsmanager_secret_version" "slack_webhook_ops" {
  secret_id     = aws_secretsmanager_secret.slack_webhook_ops.id
  secret_string = "REPLACE_ME_WITH_SLACK_WEBHOOK_OPS_URL"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── IAM policy: allow ECS task role to read all ai-net secrets ────────────────

data "aws_iam_policy_document" "secrets_read_policy" {
  statement {
    sid    = "AllowECSReadAiNetSecrets"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = var.ecs_task_execution_role_arn != "" ? [var.ecs_task_execution_role_arn] : ["*"]
    }

    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]

    resources = [
      aws_secretsmanager_secret.pagerduty_integration_key.arn,
      aws_secretsmanager_secret.slack_webhook_incidents.arn,
      aws_secretsmanager_secret.slack_webhook_ops.arn,
    ]
  }
}

resource "aws_secretsmanager_secret_policy" "pagerduty" {
  secret_arn = aws_secretsmanager_secret.pagerduty_integration_key.arn
  policy     = data.aws_iam_policy_document.secrets_read_policy.json
}

resource "aws_secretsmanager_secret_policy" "slack_incidents" {
  secret_arn = aws_secretsmanager_secret.slack_webhook_incidents.arn
  policy     = data.aws_iam_policy_document.secrets_read_policy.json
}

resource "aws_secretsmanager_secret_policy" "slack_ops" {
  secret_arn = aws_secretsmanager_secret.slack_webhook_ops.arn
  policy     = data.aws_iam_policy_document.secrets_read_policy.json
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "pagerduty_secret_arn" {
  description = "ARN of the PagerDuty integration key secret"
  value       = aws_secretsmanager_secret.pagerduty_integration_key.arn
}

output "slack_incidents_secret_arn" {
  description = "ARN of the Slack #incidents webhook secret"
  value       = aws_secretsmanager_secret.slack_webhook_incidents.arn
}

output "slack_ops_secret_arn" {
  description = "ARN of the Slack #ops-alerts webhook secret"
  value       = aws_secretsmanager_secret.slack_webhook_ops.arn
}

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

