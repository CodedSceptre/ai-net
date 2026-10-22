output "primary_bucket_name" {
  description = "Primary region backup bucket name."
  value       = aws_s3_bucket.primary.id
}

output "standby_bucket_name" {
  description = "Standby region replicated backup bucket name."
  value       = aws_s3_bucket.standby.id
}

output "replication_role_arn" {
  description = "IAM role assumed by S3 for cross-region replication."
  value       = aws_iam_role.replication.arn
}

output "replication_lag_alarm_name" {
  description = "CloudWatch alarm for replication latency above 15 minutes."
  value       = aws_cloudwatch_metric_alarm.replication_lag.alarm_name
}
