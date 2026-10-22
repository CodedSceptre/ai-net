variable "primary_bucket_name" {
  description = "Unique name for the primary backup bucket."
  type        = string
}

variable "standby_bucket_name" {
  description = "Unique name for the standby backup bucket."
  type        = string
}

variable "backup_prefix" {
  description = "Object prefix selected for cross-region replication."
  type        = string
  default     = "backups/"
}
