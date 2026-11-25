variable "name" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "backend_sg_id" { type = string }
variable "node_type" { type = string }
variable "node_count" { type = number }
