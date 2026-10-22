# Multi-region disaster recovery

The Terraform in [`infra/`](../infra/) establishes the DNS and backup
replication building blocks for a primary deployment in `us-east-1` and a
standby deployment in `us-west-2`. It does not create application compute,
load balancers, database backup jobs, VPCs, or application secrets; those
existing regional resources must be supplied before applying this configuration.

## Architecture and recovery targets

- Route53 HTTPS health checks request `/health` from each regional load
  balancer every 30 seconds. The primary CNAME failover record uses a failure
  threshold of one check, and both failover records have a 30-second TTL.
  DNS failover is therefore designed to start within 60 seconds; actual client
  recovery depends on resolver caching and the standby service being healthy.
- S3 Cross-Region Replication copies versioned objects under `backups/` from
  the primary bucket to a private, encrypted bucket in the standby region.
  A CloudWatch alarm reports replication latency above 15 minutes.
- The RPO target is under 15 minutes only when the application writes a
  consistent SQLite backup to the source bucket at least every 15 minutes and
  replication is healthy. The RTO target is under five minutes only when the
  standby application is already deployed, configured, and able to restore
  from a recent replicated backup. These targets are operational objectives,
  not guarantees made by Terraform alone.

S3 replication applies to objects created after the replication configuration
is enabled. Seed or separately copy any existing backups before relying on the
standby bucket.

## Provisioning

1. Deploy and verify the application load balancer and `/health` endpoint in
   both regions. The endpoint must be reachable by Route53 health checkers over
   public HTTPS on port 443.
2. Create or identify the public Route53 hosted zone. Choose a non-apex DNS
   name for the failover record because Route53 CNAME records cannot be used at
   a zone apex.
3. Copy [`infra/terraform.tfvars.example`](../infra/terraform.tfvars.example)
   to an untracked `infra/terraform.tfvars` and set the actual hosted zone,
   endpoint DNS names, and globally unique bucket names. Region defaults are
   `us-east-1` and `us-west-2`.
4. From `infra/`, run `terraform init`, inspect `terraform plan`, then apply
   only after review. Use AWS credentials with permissions to manage Route53,
   S3, IAM, and CloudWatch in both regions. Keep Terraform state in an encrypted,
   access-controlled remote backend in production.
5. Configure the application backup job to write consistent SQLite backup
   objects beneath the configured `backup_prefix` at least every 15 minutes.
   The application and its credentials are not provisioned by this module.
6. Configure alert delivery for the `ai-net-backup-replication-lag` CloudWatch
   alarm and provision the Route53/S3 health views in the operations alerting
   system.

## Failover exercise and operations

1. Verify both regional endpoints return a healthy response:
   `curl --fail https://<regional-endpoint>/health`.
2. In a controlled maintenance window, make the primary `/health` endpoint
   fail or block its Route53 health-check traffic. Do not disable or delete the
   health check in production as a substitute for verifying the real endpoint.
3. Query the configured name repeatedly with `dig <record_name>`. Confirm it
   resolves to the standby CNAME after Route53 detects the primary failure;
   check the returned TTL is no greater than 30 seconds.
4. Verify a newly uploaded backup object appears in the standby bucket and
   monitor the replication-latency alarm. Restore a copy to a non-production
   standby environment and confirm the database opens and the application
   becomes healthy.
5. Restore primary health. Route53 should return traffic to the primary after
   health checks recover. Confirm application state before ending the exercise.

During a real regional outage, confirm the standby is healthy and its latest
replicated backup is within the RPO before directing production traffic to it.
If automatic health-check failover is unsuitable for the incident, use the
Route53 failover record as the controlled DNS entry point and follow the
organization's incident approval process. Record detection, DNS propagation,
restore, and data-loss timings after each exercise.
