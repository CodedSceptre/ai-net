# ai-net ECS infrastructure

Staging and production share these Terraform modules and use separate S3 state
workspaces. The public ALB redirects HTTP to HTTPS and routes API requests to
the backend. Nginx serves the Vite app and its client-side routes. Both services
run in private subnets. The backend scales between 2 and 10 tasks at 70% CPU.

RDS PostgreSQL is provisioned with an AWS-managed master credential. The current
backend still uses local SQLite stores for task, agent, payment, and queue data.
Those stores are separate per Fargate task. Deploy a backend with shared storage
support before using the autoscaled service for live workloads. The Redis
module creates an encrypted private ElastiCache replication group and injects
its TLS connection URL through Secrets Manager.

## Bootstrap state and select an environment

Use Terraform 1.6 or later and AWS credentials with access to your deployment
account. Run the bootstrap once per account.

```sh
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply
terraform -chdir=infra init
terraform -chdir=infra workspace new staging
terraform -chdir=infra workspace new production
terraform -chdir=infra workspace select staging
```

The bootstrap creates the versioned, encrypted `ai-net-tfstate` bucket and the
`ai-net-tfstate-lock` DynamoDB table. If that globally unique bucket name is
unavailable, use your own name in both the bootstrap and backend configuration.
State for each environment is under
`env:/<workspace>/ai-net/terraform.tfstate`.

## Supply DNS, images, and application secrets

Set the real domain in a local variable override for the selected environment.
Supply a Route 53 hosted zone ID for automatic ACM DNS validation and aliases,
or provide an issued ACM certificate covering the site, API, and www names in
the ALB region. With external DNS, point those names at the ALB DNS output.

On the first deployment, create the ECR repositories and Secrets Manager
metadata before starting the services.

```sh
terraform -chdir=infra apply -var-file=staging.tfvars \
  -target=aws_ecr_repository.services -target=module.secrets
terraform -chdir=infra output ecr_repository_urls
docker build -f backend/Dockerfile -t "$BACKEND_ECR_URL:initial" .
docker build -f frontend/Dockerfile.ecs -t "$FRONTEND_ECR_URL:initial" .
docker push "$BACKEND_ECR_URL:initial"
docker push "$FRONTEND_ECR_URL:initial"
```

Log in to ECR and set the two ECR URL variables from the output before building.
Populate `ai-net/<environment>/venice_api_key`, `jwt_secret`,
`stellar_coordinator_secret`, and `admin_api_key` using Secrets Manager. Supply
secrets through your secure credential workflow. Redis credentials are generated
by Terraform. Restrict access to remote state because it contains the Redis
credential. Credentials are omitted from the Terraform outputs.

## Plan and apply

Set `TF_VAR_hosted_zone_id` or `TF_VAR_acm_certificate_arn` for the environment.
The tracked domain names are examples. Override `domain_name` through
`-var='domain_name=your-domain'` or a local variable file loaded after the
environment file. Images default to the environment ECR repositories' immutable
`initial` tag. For subsequent deployments set `TF_VAR_backend_image` and
`TF_VAR_frontend_image` to the new image tags or digests.

```sh
terraform -chdir=infra workspace select staging
terraform -chdir=infra plan -var-file=staging.tfvars -out=staging.plan
terraform -chdir=infra apply staging.plan

terraform -chdir=infra workspace select production
terraform -chdir=infra plan -var-file=production.tfvars -out=production.plan
terraform -chdir=infra apply production.plan
```

Review the proposed changes before applying. After deployment, check the
frontend at `/healthz` and the backend at `/health` on the HTTPS domain.
