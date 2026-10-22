variable "primary_region" {
  description = "AWS region for the active deployment."
  type        = string
  default     = "us-east-1"
}

variable "standby_region" {
  description = "AWS region for the standby deployment."
  type        = string
  default     = "us-west-2"
}

variable "hosted_zone_id" {
  description = "Existing public Route53 hosted zone ID."
  type        = string
}

variable "record_name" {
  description = "DNS name to fail over, such as api.example.com."
  type        = string
}

variable "primary_endpoint_dns" {
  description = "Public DNS name of the primary region load balancer."
  type        = string
}

variable "standby_endpoint_dns" {
  description = "Public DNS name of the standby region load balancer."
  type        = string
}

variable "health_check_path" {
  description = "HTTPS path used by Route53 health checks."
  type        = string
  default     = "/health"
}

variable "health_check_port" {
  description = "HTTPS port used by Route53 health checks."
  type        = number
  default     = 443
}

variable "primary_backup_bucket_name" {
  description = "Globally unique bucket name for SQLite backups in the primary region."
  type        = string
}

variable "standby_backup_bucket_name" {
  description = "Globally unique bucket name for replicated SQLite backups in the standby region."
  type        = string
}

variable "backup_prefix" {
  description = "S3 prefix containing completed SQLite backups to replicate."
  type        = string
  default     = "backups/"

  validation {
    condition     = length(var.backup_prefix) > 0 && endswith(var.backup_prefix, "/")
    error_message = "backup_prefix must be a non-empty S3 prefix ending in '/'."
  }
}
