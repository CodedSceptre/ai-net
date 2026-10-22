output "primary_backup_bucket" {
  description = "Primary region SQLite backup bucket."
  value       = module.database_backup_replication.primary_bucket_name
}

output "standby_backup_bucket" {
  description = "Standby region replicated SQLite backup bucket."
  value       = module.database_backup_replication.standby_bucket_name
}

output "primary_health_check_id" {
  description = "Route53 health check ID for the primary service."
  value       = module.route53_failover.primary_health_check_id
}

output "standby_health_check_id" {
  description = "Route53 health check ID for the standby service."
  value       = module.route53_failover.standby_health_check_id
}

output "replication_lag_alarm_name" {
  description = "CloudWatch alarm for backup replication latency."
  value       = module.database_backup_replication.replication_lag_alarm_name
}
