# Loki LogQL Query Reference

This document provides example LogQL queries for querying ai-net logs in the Grafana Explore panel via the Loki data source.

**Data source URL:** `http://loki:3100`  
**Explore panel:** Grafana → Explore → select **Loki** data source

---

## 1. All backend error logs

Returns every log line emitted by the backend container at `level="error"`.

```logql
{service="ai-net-backend", level="error"}
```

Use this as a starting point for incident triage. Combine with a time range (e.g. last 1 hour) to scope the results.

---

## 2. Error rate over time (backend)

Calculates the number of error log lines per minute from the backend service, plotted as a time series.

```logql
sum(rate({service="ai-net-backend", level="error"}[1m]))
```

Add this panel to the ai-net Grafana dashboard to alert when the backend error rate exceeds a threshold (e.g. > 5 errors/min).

---

## 3. Trace ID correlation — find all log lines for a specific request

Finds every log line across all services that share a given `traceId`. Replace `<trace-id>` with the actual ID from an error report or a user complaint.

```logql
{service=~"ai-net-.+"} |= `"traceId":"<trace-id>"`
```

Loki's derived field configuration automatically links the `traceId` value in Grafana to a trace URL, enabling one-click navigation from a log line to the full distributed trace.

---

## 4. Payment failure logs

Returns log lines from the backend that mention payment failures, combined with coordinator logs, filtered to errors and warnings only.

```logql
{service=~"ai-net-backend|ai-net-coordinator", level=~"error|warn"} |= "payment"
```

Narrow further by adding a JSON filter for a specific task:

```logql
{service="ai-net-backend", level="error"} | json | taskId="<task-id>"
```

---

## 5. All logs from a specific service in the last 15 minutes

Returns every log line from the frontend Nginx container. Useful for debugging routing or static-asset delivery issues.

```logql
{service="ai-net-frontend"}
```

Switch `ai-net-frontend` to any of the following service labels to query other containers:

| Label                   | Container              |
|-------------------------|------------------------|
| `ai-net-backend`        | Backend API            |
| `ai-net-frontend`       | Frontend Nginx/Vite    |
| `ai-net-coordinator`    | Task coordinator       |
| `ai-net-redis`          | Redis                  |
| `ai-net-stellar-standalone` | Stellar quickstart |

---

## 6. Backend logs by module

Filter to a specific backend module (e.g. `coordinator`, `payment`, `registry`) using the `module` label extracted by the Promtail pipeline stage.

```logql
{service="ai-net-backend", module="coordinator"}
```

```logql
{service="ai-net-backend", module="payment", level="error"}
```

---

## 7. High-latency request detection

Find backend log lines that contain slow request durations (over 2000 ms), parsed from the pino HTTP log's `responseTime` field.

```logql
{service="ai-net-backend"} | json | responseTime > 2000
```

---

## Tips

- Use `|=` for case-sensitive substring match, `|~` for regex match.
- Use `| json` to parse structured JSON log fields for filtering and metric extraction.
- Loki label cardinality matters: prefer label filters (`{level="error"}`) over regex line filters for performance.
- 7-day retention is configured in `monitoring/loki/loki-config.yml` via `limits_config.retention_period: 168h`.
