terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

# ─── Variables ───────────────────────────────────────────────────────────────

variable "bucket_name" {
  description = "Name of the S3 bucket used to store database backups."
  type        = string
  default     = "ai-net-backups"
}

variable "retention_days" {
  description = "Number of days after which backup objects are automatically deleted."
  type        = number
  default     = 30
}

variable "environment" {
  description = "Deployment environment tag (e.g. development, production)."
  type        = string
  default     = "production"
}

variable "kms_key_arn" {
  description = "Optional KMS key ARN for SSE-KMS encryption. Leave empty to use SSE-S3 (AES-256)."
  type        = string
  default     = ""
}

# ─── S3 bucket ───────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "backup" {
  bucket = var.bucket_name

  tags = {
    Name        = var.bucket_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Purpose     = "ai-net-db-backup"
  }
}

# Block all public access
resource "aws_s3_bucket_public_access_block" "backup" {
  bucket = aws_s3_bucket.backup.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning — retain previous backup versions within the retention window
resource "aws_s3_bucket_versioning" "backup" {
  bucket = aws_s3_bucket.backup.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption — SSE-KMS when a key is provided, otherwise SSE-S3
resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_arn != "" ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_key_arn != "" ? var.kms_key_arn : null
    }
    bucket_key_enabled = true
  }
}

# Lifecycle — delete objects older than retention_days, including old versions
resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    id     = "expire-old-backups"
    status = "Enabled"

    expiration {
      days = var.retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "bucket_name" {
  description = "Name of the created S3 backup bucket."
  value       = aws_s3_bucket.backup.bucket
}

output "bucket_arn" {
  description = "ARN of the created S3 backup bucket."
  value       = aws_s3_bucket.backup.arn
}

output "bucket_id" {
  description = "ID of the created S3 backup bucket."
  value       = aws_s3_bucket.backup.id
}
