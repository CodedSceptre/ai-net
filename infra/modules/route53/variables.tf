variable "hosted_zone_id" {
  description = "Existing public Route53 hosted zone ID."
  type        = string
}

variable "record_name" {
  description = "DNS name for the failover record."
  type        = string
}

variable "primary_endpoint_dns" {
  description = "Public DNS name for the primary target."
  type        = string
}

variable "standby_endpoint_dns" {
  description = "Public DNS name for the standby target."
  type        = string
}

variable "health_check_path" {
  description = "HTTPS health endpoint path."
  type        = string
  default     = "/health"
}

variable "health_check_port" {
  description = "HTTPS health endpoint port."
  type        = number
  default     = 443
}
