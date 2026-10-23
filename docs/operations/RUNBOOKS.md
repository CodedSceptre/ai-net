# Alerting Runbook

## P1: API unavailable, payment failures, or all agents offline

P1 alerts route to the `pagerduty-p1` contact point. Acknowledge the page, check the ai-net overview dashboard, and confirm backend health with `GET /health` and Prometheus `GET /metrics`. The current payment schema has no distinct failed state, so the payment failure alert treats refunded records as the failure proxy. Inspect payment records and the task/event timeline before retrying or refunding any payment.

## P2: Database pool pressure, dead-letter jobs, or high API latency

P2 alerts route to Slack. Check `ainet_db_pool_pending_acquires`, `ainet_queue_dead_letter_depth`, and the HTTP latency histogram. For dead-letter jobs, inspect `/api/admin/queue/dead-letter`; retry a job only after identifying and correcting the underlying failure.

## P3: Disk usage or cache misses

P3 alerts route to Slack. Check host filesystem usage and cache hit/miss rates. Expand or clean storage only after confirming which files or volumes are consuming space; investigate cache key churn and upstream availability before changing cache TTLs.

## Provisioning secrets

Create the PagerDuty secret resource with the Terraform module in `infra/modules/secrets`. Populate the secret value out of band using an approved secret-management workflow; do not pass it as a Terraform variable because Terraform state can retain secret values. Inject the resulting secret into Grafana as `PAGERDUTY_INTEGRATION_KEY`. Provide the Slack webhook as `SLACK_WEBHOOK_URL` to Grafana, and mount the PagerDuty and Slack values at the file paths configured in `monitoring/alertmanager.yml` when running Prometheus Alertmanager.

Grafana provisions its contact points and routing policy from `monitoring/grafana/provisioning/alerting`. Prometheus alert rules are in `monitoring/alert-rules.yml`. The Slack dashboard link uses the configured Grafana external URL; configure Grafana's public URL and create the dashboard with UID `ai-net-overview`.

## Verification

Use Grafana's test contact point action to verify Slack and PagerDuty delivery in staging. Fire a non-production test alert with `severity=P2` to verify Slack routing, then a controlled `severity=P1` alert to verify PagerDuty escalation. Confirm the resolved notification is also delivered.
