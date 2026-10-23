# ── CloudWatch Log Groups ──────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ai-net/${var.environment}/backend"
  retention_in_days = 30  # INFO-level retention per issue #116 spec

  tags = { Name = "ai-net-${var.environment}-backend-logs" }
}

resource "aws_cloudwatch_log_group" "backend_errors" {
  name              = "/ai-net/${var.environment}/backend/errors"
  retention_in_days = 90  # ERROR-level retention per issue #116 spec

  tags = { Name = "ai-net-${var.environment}-backend-error-logs" }
}

resource "aws_cloudwatch_log_group" "ecs_agent" {
  name              = "/ai-net/${var.environment}/ecs-agent"
  retention_in_days = 30

  tags = { Name = "ai-net-${var.environment}-ecs-agent-logs" }
}

# ── Metric Filter: ERROR log lines ────────────────────────────────────────────

resource "aws_cloudwatch_log_metric_filter" "backend_errors" {
  name           = "ai-net-${var.environment}-backend-error-count"
  pattern        = "{ $.level = \"error\" }"
  log_group_name = aws_cloudwatch_log_group.backend.name

  metric_transformation {
    name      = "BackendErrorCount"
    namespace = "ai-net/${var.environment}"
    value     = "1"
  }
}

# ── CloudWatch Alarm: high error rate ────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "backend_error_rate" {
  alarm_name          = "ai-net-${var.environment}-backend-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "BackendErrorCount"
  namespace           = "ai-net/${var.environment}"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Backend error rate exceeded 10 errors per 5-minute window"
  treat_missing_data  = "notBreaching"

  tags = { Name = "ai-net-${var.environment}-backend-error-alarm" }
}
