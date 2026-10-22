terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.primary, aws.standby]
    }
  }
}

resource "aws_s3_bucket" "primary" {
  provider = aws.primary
  bucket   = var.primary_bucket_name

  tags = {
    Name = "ai-net-primary-database-backups"
  }
}

resource "aws_s3_bucket" "standby" {
  provider = aws.standby
  bucket   = var.standby_bucket_name

  tags = {
    Name = "ai-net-standby-database-backups"
  }
}

resource "aws_s3_bucket_versioning" "primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.primary.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_versioning" "standby" {
  provider = aws.standby
  bucket   = aws_s3_bucket.standby.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "primary" {
  provider                = aws.primary
  bucket                  = aws_s3_bucket.primary.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "standby" {
  provider                = aws.standby
  bucket                  = aws_s3_bucket.standby.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.primary.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "standby" {
  provider = aws.standby
  bucket   = aws_s3_bucket.standby.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_iam_role" "replication" {
  provider = aws.primary
  name     = "ai-net-s3-backup-replication"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "s3.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "replication" {
  provider = aws.primary
  name     = "ai-net-s3-backup-replication"
  role     = aws_iam_role.replication.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.primary.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = "${aws_s3_bucket.primary.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Resource = "${aws_s3_bucket.standby.arn}/*"
      }
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "backups" {
  provider   = aws.primary
  depends_on = [aws_s3_bucket_versioning.primary, aws_s3_bucket_versioning.standby]

  role   = aws_iam_role.replication.arn
  bucket = aws_s3_bucket.primary.id

  rule {
    id       = "replicate-sqlite-backups"
    priority = 1
    status   = "Enabled"

    filter {
      prefix = var.backup_prefix
    }

    delete_marker_replication {
      status = "Disabled"
    }

    destination {
      bucket        = aws_s3_bucket.standby.arn
      storage_class = "STANDARD"

      metrics {
        status = "Enabled"

        event_threshold {
          minutes = 15
        }
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "replication_lag" {
  provider            = aws.primary
  alarm_name          = "ai-net-backup-replication-lag"
  alarm_description   = "S3 backup replication latency exceeded the 15-minute RPO target."
  namespace           = "AWS/S3"
  metric_name         = "ReplicationLatency"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 900
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    SourceBucket      = aws_s3_bucket.primary.id
    DestinationBucket = aws_s3_bucket.standby.id
    RuleId            = aws_s3_bucket_replication_configuration.backups.rule[0].id
  }
}
