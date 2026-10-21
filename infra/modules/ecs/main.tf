# ─────────────────────────────────────────────────────────────────────────────
# ECS Module — backend service with canary ALB weighted routing
#
# Routing model:
#   stable  target group → 90 % of traffic (listener rule weight 90)
#   canary  target group → 10 % of traffic (listener rule weight 10)
#
# During a canary deployment the GitHub Actions workflow shifts traffic by
# updating the listener rule weights via the AWS CLI.  Full promotion sets
# canary weight → 100 and stable weight → 0, then swaps the task definitions
# so the "stable" group always tracks the last-known-good version.
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ─── Variables ────────────────────────────────────────────────────────────────

variable "app_name" {
  description = "Application name prefix used for all resource names."
  type        = string
  default     = "ai-net"
}

variable "environment" {
  description = "Deployment environment (e.g. staging, production)."
  type        = string
}

variable "region" {
  description = "AWS region."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC that hosts the service."
  type        = string
}

variable "public_subnet_ids" {
  description = "Subnet IDs for the ALB (public-facing)."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Subnet IDs for the ECS tasks (private)."
  type        = list(string)
}

variable "container_image" {
  description = "Docker image URI for the stable backend (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/ai-net-backend:v1.2.3)."
  type        = string
}

variable "canary_container_image" {
  description = "Docker image URI for the canary backend.  Empty string disables the canary task definition."
  type        = string
  default     = ""
}

variable "container_port" {
  description = "Port exposed by the container."
  type        = number
  default     = 3000
}

variable "task_cpu" {
  description = "ECS task CPU units (256 / 512 / 1024 …)."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "ECS task memory in MiB."
  type        = number
  default     = 1024
}

variable "desired_count_stable" {
  description = "Number of running stable tasks."
  type        = number
  default     = 2
}

variable "desired_count_canary" {
  description = "Number of running canary tasks (set to 0 to disable canary)."
  type        = number
  default     = 1
}

variable "health_check_path" {
  description = "ALB health-check path."
  type        = string
  default     = "/health"
}

variable "log_retention_days" {
  description = "CloudWatch log group retention in days."
  type        = number
  default     = 30
}

variable "alb_certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener.  Leave empty for HTTP-only (staging use-case)."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags applied to every resource."
  type        = map(string)
  default     = {}
}

# ─── Locals ───────────────────────────────────────────────────────────────────

locals {
  prefix = "${var.app_name}-${var.environment}"

  common_tags = merge(
    {
      App         = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags,
  )

  # Initial weights.  GitHub Actions updates these live via the AWS CLI;
  # Terraform only sets the baseline so re-applies don't fight in-flight shifts.
  stable_weight = 90
  canary_weight = 10
}

# ─── Data sources ─────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ─── IAM: task execution role ─────────────────────────────────────────────────

resource "aws_iam_role" "execution" {
  name               = "${local.prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow tasks to pull Secrets Manager values (e.g. STELLAR_SECRET_KEY, VENICE_API_KEY)
resource "aws_iam_role_policy" "execution_secrets" {
  name = "${local.prefix}-execution-secrets"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "ssm:GetParameters",
          "kms:Decrypt",
        ]
        Resource = "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${local.prefix}/*"
      },
    ]
  })
}

# ─── IAM: task role (runtime permissions) ────────────────────────────────────

resource "aws_iam_role" "task" {
  name               = "${local.prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy" "task_cloudwatch" {
  name = "${local.prefix}-task-cloudwatch"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "cloudwatch:PutMetricData",
        ]
        Resource = "*"
      },
    ]
  })
}

# ─── Security groups ──────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${local.prefix}-alb"
  description = "ALB — allow HTTP/HTTPS inbound, all outbound"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.prefix}-alb" })

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "${local.prefix}-ecs-tasks"
  description = "ECS tasks — allow traffic from ALB only"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.prefix}-ecs-tasks" })

  ingress {
    description     = "Backend port from ALB"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ─── ALB ──────────────────────────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "${local.prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.environment == "production"

  tags = merge(local.common_tags, { Name = "${local.prefix}-alb" })
}

# ─── ALB target groups ────────────────────────────────────────────────────────

# Stable target group — receives 90 % of production traffic at steady state
resource "aws_lb_target_group" "stable" {
  name        = "${local.prefix}-stable"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip" # required for Fargate (awsvpc mode)

  health_check {
    enabled             = true
    path                = var.health_check_path
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Drain connections quickly so rollback is fast
  deregistration_delay = 30

  stickiness {
    enabled = false
    type    = "lb_cookie"
  }

  tags = merge(local.common_tags, {
    Name    = "${local.prefix}-stable"
    Version = "stable"
  })
}

# Canary target group — receives 10 % of traffic during canary phase
resource "aws_lb_target_group" "canary" {
  name        = "${local.prefix}-canary"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = var.health_check_path
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30

  stickiness {
    enabled = false
    type    = "lb_cookie"
  }

  tags = merge(local.common_tags, {
    Name    = "${local.prefix}-canary"
    Version = "canary"
  })
}

# ─── ALB listeners ────────────────────────────────────────────────────────────

# HTTP listener — always present; redirects to HTTPS when a certificate is configured
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = var.alb_certificate_arn == "" ? "forward" : "redirect"

    dynamic "redirect" {
      for_each = var.alb_certificate_arn != "" ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    dynamic "forward" {
      for_each = var.alb_certificate_arn == "" ? [1] : []
      content {
        target_group {
          arn    = aws_lb_target_group.stable.arn
          weight = local.stable_weight
        }
        target_group {
          arn    = aws_lb_target_group.canary.arn
          weight = local.canary_weight
        }
      }
    }
  }
}

# HTTPS listener — created only when a certificate ARN is provided
resource "aws_lb_listener" "https" {
  count = var.alb_certificate_arn != "" ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.alb_certificate_arn

  default_action {
    type = "forward"

    forward {
      target_group {
        arn    = aws_lb_target_group.stable.arn
        weight = local.stable_weight
      }
      target_group {
        arn    = aws_lb_target_group.canary.arn
        weight = local.canary_weight
      }
    }
  }
}

# ─── CloudWatch log groups ────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "stable" {
  name              = "/ecs/${local.prefix}/stable"
  retention_in_days = var.log_retention_days
  tags              = merge(local.common_tags, { Version = "stable" })
}

resource "aws_cloudwatch_log_group" "canary" {
  name              = "/ecs/${local.prefix}/canary"
  retention_in_days = var.log_retention_days
  tags              = merge(local.common_tags, { Version = "canary" })
}

# ─── ECS cluster ──────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${local.prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = merge(local.common_tags, { Name = "${local.prefix}-cluster" })
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# ─── ECS task definitions ─────────────────────────────────────────────────────

# Stable task definition
resource "aws_ecs_task_definition" "stable" {
  family                   = "${local.prefix}-stable"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.container_image
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
        }
      ]

      # Version label exposed as an env var so logs and metrics carry it
      environment = [
        { name = "APP_VERSION", value = "stable" },
        { name = "PORT", value = tostring(var.container_port) },
        { name = "NODE_ENV", value = "production" },
        { name = "DEPLOY_SLOT", value = "stable" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.stable.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:${var.container_port}/health || exit 1"]
        interval    = 10
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  tags = merge(local.common_tags, { Version = "stable" })
}

# Canary task definition — only created when a canary image is specified
resource "aws_ecs_task_definition" "canary" {
  count = var.canary_container_image != "" ? 1 : 0

  family                   = "${local.prefix}-canary"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.canary_container_image
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
        }
      ]

      # DEPLOY_SLOT=canary makes all logs and Prometheus metrics queryable by
      # version, enabling per-slot error-rate comparisons in CloudWatch / Grafana.
      environment = [
        { name = "APP_VERSION", value = "canary" },
        { name = "PORT", value = tostring(var.container_port) },
        { name = "NODE_ENV", value = "production" },
        { name = "DEPLOY_SLOT", value = "canary" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.canary.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:${var.container_port}/health || exit 1"]
        interval    = 10
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  tags = merge(local.common_tags, { Version = "canary" })
}

# ─── ECS services ─────────────────────────────────────────────────────────────

# Stable service — always running
resource "aws_ecs_service" "stable" {
  name            = "${local.prefix}-stable"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.stable.arn
  desired_count   = var.desired_count_stable
  launch_type     = "FARGATE"

  # Allow Terraform to manage desired_count without fighting the scaling policy
  lifecycle {
    ignore_changes = [desired_count, task_definition]
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.stable.arn
    container_name   = "backend"
    container_port   = var.container_port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  tags = merge(local.common_tags, { Version = "stable" })

  depends_on = [aws_lb_listener.http]
}

# Canary service — scaled down to 0 when no canary is active
resource "aws_ecs_service" "canary" {
  name            = "${local.prefix}-canary"
  cluster         = aws_ecs_cluster.main.id
  task_definition = var.canary_container_image != "" ? aws_ecs_task_definition.canary[0].arn : aws_ecs_task_definition.stable.arn
  desired_count   = var.desired_count_canary

  # GitHub Actions manages desired_count and task_definition during the
  # canary lifecycle; Terraform must not overwrite those changes on the next apply.
  lifecycle {
    ignore_changes = [desired_count, task_definition]
  }

  launch_type = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.canary.arn
    container_name   = "backend"
    container_port   = var.container_port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  tags = merge(local.common_tags, { Version = "canary" })

  depends_on = [aws_lb_listener.http]
}

# ─── CloudWatch alarms (referenced by alert-rules.yml) ───────────────────────

# Canary unhealthy host count — rollback trigger
resource "aws_cloudwatch_metric_alarm" "canary_unhealthy_hosts" {
  alarm_name          = "${local.prefix}-canary-unhealthy-hosts"
  alarm_description   = "Canary target group has unhealthy hosts — possible deployment failure."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.canary.arn_suffix
  }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = []  # populated by alert-rules.yml SNS ARN
  ok_actions    = []

  tags = merge(local.common_tags, { Version = "canary" })
}

# Canary 5xx rate — the primary rollback trigger used in the workflow
resource "aws_cloudwatch_metric_alarm" "canary_5xx_rate" {
  alarm_name          = "${local.prefix}-canary-5xx-rate"
  alarm_description   = "Canary HTTP 5xx rate exceeded 5 % — automated rollback may trigger."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.canary.arn_suffix
  }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = []
  ok_actions    = []

  tags = merge(local.common_tags, { Version = "canary" })
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer."
  value       = aws_lb.main.dns_name
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer."
  value       = aws_lb.main.arn
}

output "alb_arn_suffix" {
  description = "ARN suffix of the ALB (used in CloudWatch metric dimensions)."
  value       = aws_lb.main.arn_suffix
}

output "stable_target_group_arn" {
  description = "ARN of the stable ALB target group."
  value       = aws_lb_target_group.stable.arn
}

output "canary_target_group_arn" {
  description = "ARN of the canary ALB target group."
  value       = aws_lb_target_group.canary.arn
}

output "stable_target_group_arn_suffix" {
  description = "ARN suffix of the stable target group (CloudWatch dimension)."
  value       = aws_lb_target_group.stable.arn_suffix
}

output "canary_target_group_arn_suffix" {
  description = "ARN suffix of the canary target group (CloudWatch dimension)."
  value       = aws_lb_target_group.canary.arn_suffix
}

output "http_listener_arn" {
  description = "ARN of the HTTP (port 80) ALB listener."
  value       = aws_lb_listener.http.arn
}

output "https_listener_arn" {
  description = "ARN of the HTTPS (port 443) ALB listener (empty when no certificate is configured)."
  value       = length(aws_lb_listener.https) > 0 ? aws_lb_listener.https[0].arn : ""
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster."
  value       = aws_ecs_cluster.main.name
}

output "stable_service_name" {
  description = "Name of the stable ECS service."
  value       = aws_ecs_service.stable.name
}

output "canary_service_name" {
  description = "Name of the canary ECS service."
  value       = aws_ecs_service.canary.name
}

output "stable_task_definition_arn" {
  description = "ARN of the latest stable task definition."
  value       = aws_ecs_task_definition.stable.arn
}

output "canary_task_definition_arn" {
  description = "ARN of the latest canary task definition (empty when not configured)."
  value       = length(aws_ecs_task_definition.canary) > 0 ? aws_ecs_task_definition.canary[0].arn : ""
}

output "canary_5xx_alarm_name" {
  description = "Name of the CloudWatch alarm that tracks canary 5xx rate."
  value       = aws_cloudwatch_metric_alarm.canary_5xx_rate.alarm_name
}

output "canary_unhealthy_alarm_name" {
  description = "Name of the CloudWatch alarm for canary unhealthy hosts."
  value       = aws_cloudwatch_metric_alarm.canary_unhealthy_hosts.alarm_name
}
