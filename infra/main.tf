terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 7.0"
    }
  }
}

provider "aws" {
  region = var.primary_region
}

provider "aws" {
  alias  = "standby"
  region = var.standby_region
}

module "route53_failover" {
  source = "./modules/route53"

  hosted_zone_id         = var.hosted_zone_id
  record_name            = var.record_name
  primary_endpoint_dns   = var.primary_endpoint_dns
  standby_endpoint_dns   = var.standby_endpoint_dns
  health_check_path      = var.health_check_path
  health_check_port      = var.health_check_port
}

module "database_backup_replication" {
  source = "./modules/s3"

  providers = {
    aws.primary = aws
    aws.standby = aws.standby
  }

  primary_bucket_name        = var.primary_backup_bucket_name
  standby_bucket_name        = var.standby_backup_bucket_name
  backup_prefix              = var.backup_prefix
}
