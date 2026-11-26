variable "environment" { type = string }
variable "aws_region" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "public_subnet_ids" { type = list(string) }
variable "backend_sg_id" { type = string }
variable "alb_sg_id" { type = string }
variable "backend_image" { type = string }
variable "backend_cpu" { type = number }
variable "backend_memory" { type = number }
variable "desired_count" { type = number }
variable "task_role_arn" { type = string }
variable "execution_role_arn" { type = string }
variable "secrets_arns" { type = map(string) }
variable "log_group_name" { type = string }
variable "acm_certificate_arn" {
  type = string
}

variable "frontend_image" { type = string }
variable "frontend_cpu" { type = number }
variable "frontend_memory" { type = number }
variable "frontend_desired_count" { type = number }
variable "frontend_sg_id" { type = string }
variable "redis_secret_arn" { type = string }
variable "domain_name" { type = string }
variable "backend_logs_retention_days" { type = number }
