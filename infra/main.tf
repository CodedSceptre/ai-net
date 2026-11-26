terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.31"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Remote state in S3 with DynamoDB locking.
  # Bucket and table are created by infra/bootstrap/ before first apply.
  backend "s3" {
    bucket         = "ai-net-tfstate"
    key            = "ai-net/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "ai-net-tfstate-lock"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ai-net"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ── Modules ──────────────────────────────────────────────────────────────────

module "networking" {
  source      = "./modules/networking"
  environment = var.environment
  vpc_cidr    = var.vpc_cidr
  aws_region  = var.aws_region
}

module "ecs" {
  source                      = "./modules/ecs"
  environment                 = var.environment
  aws_region                  = var.aws_region
  vpc_id                      = module.networking.vpc_id
  private_subnet_ids          = module.networking.private_subnet_ids
  public_subnet_ids           = module.networking.public_subnet_ids
  backend_sg_id               = module.networking.backend_sg_id
  alb_sg_id                   = module.networking.alb_sg_id
  backend_image               = coalesce(var.backend_image, "${aws_ecr_repository.services["backend"].repository_url}:initial")
  frontend_image              = coalesce(var.frontend_image, "${aws_ecr_repository.services["frontend"].repository_url}:initial")
  frontend_cpu                = var.frontend_cpu
  frontend_memory             = var.frontend_memory
  frontend_desired_count      = var.frontend_desired_count
  frontend_sg_id              = module.networking.frontend_sg_id
  redis_secret_arn            = module.redis.redis_url_secret_arn
  domain_name                 = var.domain_name
  backend_logs_retention_days = var.environment == "production" ? 90 : 30
  acm_certificate_arn = var.acm_certificate_arn != "" ? var.acm_certificate_arn : (
    local.validate_certificate ? aws_acm_certificate_validation.alb[0].certificate_arn : aws_acm_certificate.alb[0].arn
  )
  backend_cpu        = var.backend_cpu
  backend_memory     = var.backend_memory
  desired_count      = var.desired_count
  task_role_arn      = module.iam.ecs_task_role_arn
  execution_role_arn = module.iam.ecs_execution_role_arn
  secrets_arns       = module.secrets.ecs_environment_secrets
  log_group_name     = module.logging.backend_log_group_name
}

module "rds" {
  source             = "./modules/rds"
  environment        = var.environment
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  db_sg_id           = module.networking.db_sg_id
  db_instance_class  = var.db_instance_class
  db_name            = var.db_name
  db_username        = var.db_username
}

module "s3" {
  source      = "./modules/s3"
  environment = var.environment
  aws_region  = var.aws_region
}

module "cloudfront" {
  source                 = "./modules/cloudfront"
  environment            = var.environment
  frontend_bucket_name   = module.s3.frontend_bucket_name
  frontend_bucket_arn    = module.s3.frontend_bucket_arn
  frontend_bucket_domain = module.s3.frontend_bucket_domain
  acm_certificate_arn    = ""
  domain_name            = ""
}

module "route53" {
  source            = "./modules/route53"
  environment       = var.environment
  domain_name       = var.domain_name
  hosted_zone_id    = var.hosted_zone_id
  alb_dns_name      = module.ecs.alb_dns_name
  alb_zone_id       = module.ecs.alb_zone_id
  frontend_dns_name = module.ecs.alb_dns_name
  frontend_zone_id  = module.ecs.alb_zone_id
}

module "iam" {
  source      = "./modules/iam"
  environment = var.environment
  aws_region  = var.aws_region
  account_id  = data.aws_caller_identity.current.account_id
  s3_bucket_arns = [
    module.s3.task_results_bucket_arn,
    module.s3.redis_backups_bucket_arn,
    module.s3.database_backups_bucket_arn,
  ]
  secrets_arns = concat(module.secrets.secret_arns, [module.redis.redis_url_secret_arn])
}

module "secrets" {
  source      = "./modules/secrets"
  environment = var.environment
}

module "logging" {
  source              = "./modules/logging"
  environment         = var.environment
  archive_bucket_name = module.s3.log_archive_bucket_name
  archive_bucket_arn  = module.s3.log_archive_bucket_arn
}

# ── Data sources ──────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}

module "redis" {
  source             = "./modules/redis"
  name               = "ai-net-${var.environment}"
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  backend_sg_id      = module.networking.backend_sg_id
  node_type          = var.redis_node_type
  node_count         = var.redis_node_count
}

resource "aws_ecr_repository" "services" {
  for_each             = toset(["backend", "frontend"])
  name                 = "ai-net-${var.environment}-${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_acm_certificate" "alb" {
  count                     = var.acm_certificate_arn == "" ? 1 : 0
  domain_name               = var.domain_name
  subject_alternative_names = ["api.${var.domain_name}", "www.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  certificate_domains  = toset([var.domain_name, "api.${var.domain_name}", "www.${var.domain_name}"])
  validate_certificate = var.acm_certificate_arn == "" && var.hosted_zone_id != ""
}

resource "aws_route53_record" "certificate" {
  for_each = local.validate_certificate ? local.certificate_domains : toset([])
  zone_id  = var.hosted_zone_id
  name     = one([for option in aws_acm_certificate.alb[0].domain_validation_options : option.resource_record_name if option.domain_name == each.key])
  type     = one([for option in aws_acm_certificate.alb[0].domain_validation_options : option.resource_record_type if option.domain_name == each.key])
  records  = [one([for option in aws_acm_certificate.alb[0].domain_validation_options : option.resource_record_value if option.domain_name == each.key])]
  ttl      = 60
}

resource "aws_acm_certificate_validation" "alb" {
  count                   = local.validate_certificate ? 1 : 0
  certificate_arn         = aws_acm_certificate.alb[0].arn
  validation_record_fqdns = [for record in aws_route53_record.certificate : record.fqdn]
}
