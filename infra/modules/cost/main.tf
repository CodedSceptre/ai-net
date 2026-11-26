terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "environment" {
  description = "Deployment environment (e.g. staging, production)"
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly budget limit in USD"
  type        = number
  default     = 500
}

variable "alert_email" {
  description = "Email address to receive budget alerts"
  type        = string
}

variable "slack_webhook_url" {
  description = "Slack incoming webhook URL for cost notifications"
  type        = string
  sensitive   = true
}

locals {
  common_tags = {
    Project     = "ai-net"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ── SNS topic for budget alerts ────────────────────────────────────────────────
resource "aws_sns_topic" "budget_alerts" {
  name = "ai-net-${var.environment}-budget-alerts"
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "budget_email" {
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ── Lambda: SNS → Slack forwarding ────────────────────────────────────────────
data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "slack_notifier" {
  name               = "ai-net-${var.environment}-slack-notifier"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "slack_notifier_basic" {
  role       = aws_iam_role.slack_notifier.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "archive_file" "slack_notifier" {
  type        = "zip"
  output_path = "${path.module}/slack_notifier.zip"
  source {
    content  = <<-PYTHON
import json, urllib.request, os

def handler(event, context):
    webhook = os.environ["SLACK_WEBHOOK_URL"]
    for record in event.get("Records", []):
        message = record["Sns"]["Message"]
        subject = record["Sns"].get("Subject", "AWS Budget Alert")
        payload = json.dumps({
            "text": f":money_with_wings: *{subject}*\n{message}"
        })
        req = urllib.request.Request(
            webhook,
            data=payload.encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req)
    return {"statusCode": 200}
PYTHON
    filename = "index.py"
  }
}

resource "aws_lambda_function" "slack_notifier" {
  function_name    = "ai-net-${var.environment}-budget-slack-notifier"
  role             = aws_iam_role.slack_notifier.arn
  handler          = "index.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.slack_notifier.output_path
  source_code_hash = data.archive_file.slack_notifier.output_base64sha256

  environment {
    variables = {
      SLACK_WEBHOOK_URL = var.slack_webhook_url
    }
  }

  tags = local.common_tags
}

resource "aws_lambda_permission" "allow_sns_notifier" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.slack_notifier.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.budget_alerts.arn
}

resource "aws_sns_topic_subscription" "budget_slack" {
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.slack_notifier.arn
}

# ── AWS Budgets ────────────────────────────────────────────────────────────────
resource "aws_budgets_budget" "monthly" {
  name         = "ai-net-${var.environment}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # 80% forecasted → email only
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }

  # 100% actual → email + Slack (via SNS topic)
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
    subscriber_sns_topic_arns  = [aws_sns_topic.budget_alerts.arn]
  }

  tags = local.common_tags
}

# ── CloudWatch Cost Anomaly Detector ──────────────────────────────────────────
resource "aws_ce_anomaly_monitor" "total_spend" {
  name              = "ai-net-${var.environment}-total-spend"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
  tags              = local.common_tags
}

resource "aws_ce_anomaly_subscription" "ops_alert" {
  name      = "ai-net-${var.environment}-anomaly-ops"
  frequency = "DAILY"

  monitor_arn_list = [aws_ce_anomaly_monitor.total_spend.arn]

  subscriber {
    type    = "SNS"
    address = aws_sns_topic.budget_alerts.arn
  }

  # Alert when day-over-day spend increases by 20% or more
  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_PERCENTAGE"
      values        = ["20"]
      match_options = ["GREATER_THAN_OR_EQUAL"]
    }
  }

  tags = local.common_tags
}

# ── Monthly cost report Lambda ─────────────────────────────────────────────────
data "aws_iam_policy_document" "cost_reporter_policy" {
  statement {
    actions   = ["ce:GetCostAndUsage"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "cost_reporter" {
  name   = "ai-net-${var.environment}-cost-reporter"
  policy = data.aws_iam_policy_document.cost_reporter_policy.json
  tags   = local.common_tags
}

resource "aws_iam_role" "cost_reporter" {
  name               = "ai-net-${var.environment}-cost-reporter"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "cost_reporter_basic" {
  role       = aws_iam_role.cost_reporter.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "cost_reporter_ce" {
  role       = aws_iam_role.cost_reporter.name
  policy_arn = aws_iam_policy.cost_reporter.arn
}

data "archive_file" "cost_reporter" {
  type        = "zip"
  output_path = "${path.module}/cost_reporter.zip"
  source {
    content  = <<-PYTHON
import json, urllib.request, os, boto3
from datetime import date
from dateutil.relativedelta import relativedelta

def handler(event, context):
    today = date.today()
    first_of_this_month = today.replace(day=1)
    first_of_last_month = first_of_this_month - relativedelta(months=1)

    ce = boto3.client("ce", region_name="us-east-1")
    response = ce.get_cost_and_usage(
        TimePeriod={
            "Start": first_of_last_month.isoformat(),
            "End": first_of_this_month.isoformat(),
        },
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
    )

    results = response["ResultsByTime"][0]
    total = results["Total"]["UnblendedCost"]["Amount"]
    groups = sorted(
        results["Groups"],
        key=lambda g: float(g["Metrics"]["UnblendedCost"]["Amount"]),
        reverse=True,
    )

    lines = [f":bar_chart: *ai-net Monthly Cost Report — {first_of_last_month.strftime('%B %Y')}*"]
    lines.append(f"*Total: ${float(total):.2f} USD*\n")
    for g in groups[:10]:
        svc = g["Keys"][0]
        amt = float(g["Metrics"]["UnblendedCost"]["Amount"])
        if amt > 0.01:
            lines.append(f"• {svc}: ${amt:.2f}")

    webhook = os.environ["SLACK_WEBHOOK_URL"]
    payload = json.dumps({"text": "\n".join(lines)})
    req = urllib.request.Request(
        webhook,
        data=payload.encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req)
    return {"statusCode": 200}
PYTHON
    filename = "index.py"
  }
}

resource "aws_lambda_function" "cost_reporter" {
  function_name    = "ai-net-${var.environment}-cost-reporter"
  role             = aws_iam_role.cost_reporter.arn
  handler          = "index.handler"
  runtime          = "python3.12"
  filename         = data.archive_file.cost_reporter.output_path
  source_code_hash = data.archive_file.cost_reporter.output_base64sha256
  timeout          = 60

  environment {
    variables = {
      SLACK_WEBHOOK_URL = var.slack_webhook_url
    }
  }

  tags = local.common_tags
}

# EventBridge: 1st of every month at 09:00 UTC
resource "aws_cloudwatch_event_rule" "monthly_report" {
  name                = "ai-net-${var.environment}-monthly-cost-report"
  description         = "Triggers monthly cost report Lambda on the 1st of each month"
  schedule_expression = "cron(0 9 1 * ? *)"
  tags                = local.common_tags
}

resource "aws_cloudwatch_event_target" "monthly_report" {
  rule      = aws_cloudwatch_event_rule.monthly_report.name
  target_id = "cost-reporter-lambda"
  arn       = aws_lambda_function.cost_reporter.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cost_reporter.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.monthly_report.arn
}

# ── Outputs ────────────────────────────────────────────────────────────────────
output "budget_name" {
  value       = aws_budgets_budget.monthly.name
  description = "Name of the monthly AWS budget"
}

output "sns_topic_arn" {
  value       = aws_sns_topic.budget_alerts.arn
  description = "ARN of the budget alerts SNS topic"
}

output "anomaly_monitor_arn" {
  value       = aws_ce_anomaly_monitor.total_spend.arn
  description = "ARN of the CloudWatch cost anomaly monitor"
}
