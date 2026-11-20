# Cost Management

This document describes the cost monitoring and alerting setup for the ai-net AWS infrastructure.

---

## Monthly Budget

A monthly AWS Budget is provisioned via `infra/modules/cost/main.tf` with a **$500 USD** limit (configurable via `monthly_budget_usd`).

| Threshold | Type       | Notification                   |
|-----------|------------|--------------------------------|
| 80%       | Forecasted | Email                          |
| 100%      | Actual     | Email + Slack (`#ops`)         |

The 100% alert is routed through an SNS topic. A Lambda function (`ai-net-{env}-budget-slack-notifier`) subscribes to the topic and forwards the message to Slack via an incoming webhook.

---

## Infracost PR Comments

The `.github/workflows/infra-cost.yml` workflow triggers on every pull request that touches `infra/**`. It runs [Infracost](https://www.infracost.io/) to compare the PR branch cost estimate against `main` and posts a delta comment showing the monthly cost change in dollars.

**Required secret:** `INFRACOST_API_KEY` — obtain a free key at [infracost.io](https://www.infracost.io/) and add it as a repository secret.

---

## CloudWatch Cost Anomaly Detection

A Cost Anomaly Monitor (`aws_ce_anomaly_monitor`) watches spend across all AWS services. An anomaly subscription sends a daily alert to the SNS topic — and therefore Slack — when total spend increases by **20% or more** day-over-day.

To test the alert manually, publish a test message directly to the SNS topic:

```bash
aws sns publish \
  --topic-arn <sns_topic_arn> \
  --subject "Test: Cost Anomaly Alert" \
  --message "This is a manual test of the cost anomaly alert."
```

---

## Monthly Cost Report

A scheduled Lambda (`ai-net-{env}-cost-reporter`) runs at **09:00 UTC on the 1st of each month** via an EventBridge rule. It calls `aws ce get-cost-and-usage` for the previous calendar month and posts a per-service cost breakdown to the configured Slack channel.

---

## Resource Tagging

Every Terraform resource in this module carries mandatory cost allocation tags:

| Tag           | Value               |
|---------------|---------------------|
| `Project`     | `ai-net`            |
| `Environment` | `var.environment`   |
| `ManagedBy`   | `terraform`         |

Use these tags in AWS Cost Explorer (Billing → Cost Explorer → Tags) to filter and group costs by project and environment.

---

## Configuration Variables

| Variable             | Description                        | Default |
|----------------------|------------------------------------|---------|
| `environment`        | Deployment environment             | —       |
| `monthly_budget_usd` | Monthly budget cap in USD          | `500`   |
| `alert_email`        | Email for budget threshold alerts  | —       |
| `slack_webhook_url`  | Slack incoming webhook URL         | —       |

Set these in your `terraform.tfvars` file or pass them via `-var` flags. Never commit real webhook URLs or email addresses to the repository — use a `.tfvars` file excluded by `.gitignore`.
