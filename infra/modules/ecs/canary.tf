# infra/modules/ecs/canary.tf
# Canary deployment: two ECS task definitions + ALB weighted target groups

# ── Variables ─────────────────────────────────────────────────────────────────

variable "service_name" {
  description = "Name of the ECS service."
  type        = string
}

variable "cluster_arn" {
  description = "ARN of the ECS cluster."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for the ALB target groups."
  type        = string
}

variable "alb_listener_arn" {
  description = "ARN of the ALB HTTPS listener."
  type        = string
}

variable "stable_image" {
  description = "Container image URI for the stable task definition."
  type        = string
}

variable "canary_image" {
  description = "Container image URI for the canary task definition. Defaults to stable_image when empty."
  type        = string
  default     = ""
}

variable "stable_weight" {
  description = "Percentage of ALB traffic routed to the stable target group (0–100)."
  type        = number
  default     = 90
}

variable "canary_weight" {
  description = "Percentage of ALB traffic routed to the canary target group (0–100)."
  type        = number
  default     = 10
}

variable "task_cpu" {
  description = "CPU units for each task definition."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Memory (MiB) for each task definition."
  type        = number
  default     = 512
}

variable "container_port" {
  description = "Port the container listens on."
  type        = number
  default     = 3000
}

variable "execution_role_arn" {
  description = "IAM role ARN for ECS task execution."
  type        = string
}

variable "task_role_arn" {
  description = "IAM role ARN for the ECS task."
  type        = string
}

variable "subnets" {
  description = "Subnet IDs for the ECS services."
  type        = list(string)
}

variable "security_groups" {
  description = "Security group IDs for the ECS services."
  type        = list(string)
}

# ── Data sources ──────────────────────────────────────────────────────────────

data "aws_region" "current" {}

# ── Stable task definition ────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "stable" {
  family                   = "${var.service_name}-stable"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([
    {
      name      = "${var.service_name}-stable"
      image     = var.stable_image
      essential = true
      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.service_name}/stable"
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = {
    Service   = var.service_name
    Variant   = "stable"
    ManagedBy = "terraform"
  }
}

# ── Canary task definition ────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "canary" {
  family                   = "${var.service_name}-canary"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([
    {
      name      = "${var.service_name}-canary"
      image     = coalesce(var.canary_image, var.stable_image)
      essential = true
      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.service_name}/canary"
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = {
    Service   = var.service_name
    Variant   = "canary"
    ManagedBy = "terraform"
  }
}

# ── ALB target groups ─────────────────────────────────────────────────────────

resource "aws_lb_target_group" "stable" {
  name        = "${var.service_name}-stable"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }

  tags = {
    Service   = var.service_name
    Variant   = "stable"
    ManagedBy = "terraform"
  }
}

resource "aws_lb_target_group" "canary" {
  name        = "${var.service_name}-canary"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }

  tags = {
    Service   = var.service_name
    Variant   = "canary"
    ManagedBy = "terraform"
  }
}

# ── ALB weighted listener rule ────────────────────────────────────────────────

resource "aws_lb_listener_rule" "weighted" {
  listener_arn = var.alb_listener_arn
  priority     = 100

  action {
    type = "forward"
    forward {
      target_group {
        arn    = aws_lb_target_group.stable.arn
        weight = var.stable_weight
      }
      target_group {
        arn    = aws_lb_target_group.canary.arn
        weight = var.canary_weight
      }
      stickiness {
        enabled  = false
        duration = 1
      }
    }
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }
}

# ── ECS services ──────────────────────────────────────────────────────────────

resource "aws_ecs_service" "stable" {
  name            = "${var.service_name}-stable"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.stable.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnets
    security_groups  = var.security_groups
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.stable.arn
    container_name   = "${var.service_name}-stable"
    container_port   = var.container_port
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = {
    Service   = var.service_name
    Variant   = "stable"
    ManagedBy = "terraform"
  }
}

resource "aws_ecs_service" "canary" {
  name            = "${var.service_name}-canary"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.canary.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnets
    security_groups  = var.security_groups
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.canary.arn
    container_name   = "${var.service_name}-canary"
    container_port   = var.container_port
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = {
    Service   = var.service_name
    Variant   = "canary"
    ManagedBy = "terraform"
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "stable_target_group_arn" {
  description = "ARN of the stable ALB target group."
  value       = aws_lb_target_group.stable.arn
}

output "canary_target_group_arn" {
  description = "ARN of the canary ALB target group."
  value       = aws_lb_target_group.canary.arn
}

output "stable_task_definition_arn" {
  description = "ARN of the stable ECS task definition."
  value       = aws_ecs_task_definition.stable.arn
}

output "canary_task_definition_arn" {
  description = "ARN of the canary ECS task definition."
  value       = aws_ecs_task_definition.canary.arn
}

output "stable_service_name" {
  description = "Name of the stable ECS service."
  value       = aws_ecs_service.stable.name
}

output "canary_service_name" {
  description = "Name of the canary ECS service."
  value       = aws_ecs_service.canary.name
}
