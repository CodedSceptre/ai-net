# 🔒 ai-net Security Hardening Guide

This guide covers production security hardening for ai-net node operators. Work through each section before exposing a node to the internet or mainnet traffic.

---

## Quick Reference

| Section                                                | Topic                                                     |
| ------------------------------------------------------ | --------------------------------------------------------- |
| [1. Server Hardening](#1-server-hardening)             | OS patching, firewall, SSH hardening, fail2ban            |
| [2. Stellar Key Management](#2-stellar-key-management) | HSM options, key rotation procedure, secrets storage      |
| [3. API Security](#3-api-security)                     | JWT rotation, rate limits, TLS 1.3, HSTS, certificates    |
| [4. Docker Security](#4-docker-security)               | Non-root user, image scanning, socket mounts, hardening   |
| [5. Network Security](#5-network-security)             | VPC isolation, RPC selection, private networking, secrets |
| [6. Incident Response](#6-incident-response)           | Unauthorized call detection, emergency pause, evidence    |
| [7. Compliance Checklist](#7-compliance-checklist)     | SOC 2 Type II controls mapped to operator actions         |

---

## 1. Server Hardening

### OS Patching Cadence

Apply security patches on a weekly cadence using `unattended-upgrades`. Perform a manual review for feature and kernel updates monthly.

```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Configure `/etc/apt/apt.conf.d/50unattended-upgrades`:

```
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
```

### Firewall Rules (ufw)

Only expose ports 443 (HTTPS/WSS) and 3001 (backend API). Block all other inbound traffic.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3001/tcp
sudo ufw enable
```

Verify rules are active:

```bash
sudo ufw status verbose
```

> ⚠️ **Warning**: Apply these rules before connecting the server to the internet. Applying `ufw enable` on an existing session over SSH may disconnect you if port 22 is not already allowed.

### fail2ban for SSH

Install and configure fail2ban to block brute-force SSH login attempts.

```bash
sudo apt-get install -y fail2ban
```

Create `/etc/fail2ban/jail.local`:

```ini
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port    = ssh
logpath = %(sshd_log)s
backend = %(sshd_backend)s
```

Enable and start the service:

```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
sudo fail2ban-client status sshd
```

### Harden SSH Configuration

Edit `/etc/ssh/sshd_config` to disable root login and password authentication:

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
```

Reload SSH to apply changes:

```bash
sudo systemctl reload sshd
```

> ⚠️ **Warning**: Ensure your SSH public key is added to `~/.ssh/authorized_keys` and you can authenticate with it **before** setting `PasswordAuthentication no`. Locking yourself out of a remote server requires console access to recover.

---

## 2. Stellar Key Management

### HSM Hardware Options

Storing Stellar signing keys in a hardware security module prevents key extraction even if the host OS is compromised. Choose based on your deployment model and budget:

| Option                                       | Cost              | Use Case                     | Notes                                                                                                                                                        |
| -------------------------------------------- | ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **YubiHSM 2**                                | ~$650 one-time    | Single-node, bare-metal      | Hardware key storage; integrates with stellar-sdk via PKCS#11; requires USB access to the server                                                             |
| **AWS CloudHSM**                             | ~$1.60/hr per HSM | Cloud deployments            | FIPS 140-2 Level 3 certified; fully managed; integrates via AWS SDK; higher ongoing cost but no hardware management                                          |
| **HashiCorp Vault (Transit Secrets Engine)** | ~$0 self-hosted   | Operators without HSM budget | Software HSM alternative; stores Stellar signing keys encrypted at rest; accessible via API; practical starting point before investing in dedicated hardware |

### Key Rotation Procedure

Rotate Stellar keypairs when an operator leaves, on suspected compromise, or on a scheduled cadence.

> ⚠️ **Warning**: Perform key rotation during a low-traffic window. The old key must remain authorized until all in-flight tasks complete. Do not delete it.

1. Generate a new keypair:

   ```bash
   stellar keys generate new-operator-key --network testnet
   ```

2. Fund the new account with the minimum XLM reserve:

   ```bash
   # Testnet — use Friendbot
   NEW_PUBLIC=$(stellar keys address new-operator-key)
   curl -X POST "https://friendbot.stellar.org?addr=${NEW_PUBLIC}"

   # Mainnet — transfer from cold wallet to NEW_PUBLIC
   ```

3. Authorize the new key on the agent registry contract:

   ```bash
   stellar contract invoke \
     --id $REGISTRY_CONTRACT_ID \
     --source $STELLAR_COORDINATOR_SECRET \
     --network testnet \
     -- update_authorized_node \
     --new_public_key $NEW_PUBLIC
   ```

4. Update `STELLAR_COORDINATOR_SECRET` in your secrets manager to the new key's secret value. Never write the value to disk.

   ```bash
   # AWS Secrets Manager
   aws secretsmanager put-secret-value \
     --secret-id "ai-net/production/stellar_coordinator_secret" \
     --secret-string "$(stellar keys show new-operator-key)"

   # HashiCorp Vault
   vault kv put secret/ai-net/stellar coordinator_secret="$(stellar keys show new-operator-key)"
   ```

5. Rolling restart: bring up one node instance with the new key and verify it registers successfully:

   ```bash
   curl -s http://localhost:3001/api/v1/health | jq '.stellar.connected'
   ```

6. Deregister the old key on the registry contract to revoke it:

   ```bash
   stellar contract invoke \
     --id $REGISTRY_CONTRACT_ID \
     --source $NEW_OPERATOR_SECRET \
     --network testnet \
     -- deregister_node \
     --public_key $OLD_PUBLIC_KEY
   ```

7. Wait one full epoch and confirm no pending tasks reference the old key.

8. Archive the old private key to cold storage. Do not delete it — it may be required for audit purposes.

### Secrets Storage Requirement

> ⚠️ **Never** store `STELLAR_SECRET_KEY` or `STELLAR_COORDINATOR_SECRET` in `.env` files on disk in production. Use AWS Secrets Manager, HashiCorp Vault, or an equivalent secrets manager. Reference secrets by ARN or path in your environment configuration, not by value.

---

## 3. API Security

### JWT Signing Key Rotation

Rotate JWT signing keys every 90 days. Use `RS256` (asymmetric RSA) so the private signing key never needs to leave the secrets manager.

**Rotation procedure:**

1. Generate a new RSA keypair:

   ```bash
   openssl genrsa -out jwt-private.pem 4096
   openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem
   ```

2. Store the private key in your secrets manager:

   ```bash
   aws secretsmanager put-secret-value \
     --secret-id "ai-net/production/jwt_private_key" \
     --secret-string "$(cat jwt-private.pem)"
   ```

3. Restart the backend to load the new key.

4. Revoke existing sessions by incrementing the JWT generation counter in the database:

   ```sql
   UPDATE node_config SET jwt_generation = jwt_generation + 1 WHERE id = 1;
   ```

5. Delete the local PEM files:

   ```bash
   rm -f jwt-private.pem jwt-public.pem
   ```

### Rate Limit Tuning

Default rate limits in production are `RATE_LIMIT_MAX_REQUESTS=20` per 60 seconds per IP. Adjust based on deployment type:

| Node Type                 | Recommended `RATE_LIMIT_MAX_REQUESTS` |
| ------------------------- | ------------------------------------- |
| Public node               | 20 or lower                           |
| Dedicated enterprise node | 100                                   |

### TLS 1.3

Disable TLS 1.2. Configure nginx or Caddy to accept TLS 1.3 connections only.

**nginx:**

```nginx
ssl_protocols TLSv1.3;
ssl_ciphers TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256;
```

**Caddy** enforces TLS 1.2+ by default. Set the minimum explicitly:

```
tls {
  protocols tls1.3
}
```

### HSTS

Add a Strict-Transport-Security header to prevent protocol downgrade attacks:

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

> ⚠️ **Warning**: The `preload` directive submits your domain to browsers' built-in HSTS preload lists. This is effectively permanent. Only add `preload` once you are certain you will serve HTTPS on all subdomains indefinitely.

### Certificate Renewal

Use certbot with a deploy hook to reload nginx automatically on renewal:

```bash
sudo certbot certonly --nginx -d your-domain.com \
  --deploy-hook "systemctl reload nginx"
```

Set up a monitoring alert if the certificate expires in fewer than 30 days:

```bash
# Check expiry (run from cron)
openssl s_client -connect your-domain.com:443 -servername your-domain.com \
  </dev/null 2>/dev/null | openssl x509 -noout -enddate
```

Caddy handles ACME renewal automatically with no additional configuration.

---

## 4. Docker Security

### Run as Non-Root User

Add a dedicated non-root user to your Dockerfile. This limits the blast radius if the container process is compromised.

```dockerfile
# Add to your Dockerfile:
RUN groupadd --gid 1001 ainetuser && \
    useradd --uid 1001 --gid ainetuser --shell /bin/bash --create-home ainetuser
USER ainetuser
```

### Image Scanning with Trivy

Run Trivy on every build and weekly against images in your registry. Fail the build on HIGH or CRITICAL findings:

```bash
trivy image --exit-code 1 --severity HIGH,CRITICAL your-image:tag
```

Add this to your CI pipeline after `docker build`.

### Private Registry

Pull images only from AWS ECR or GitHub Container Registry in production. If you must use Docker Hub, pin images by digest:

```
image: your-org/ai-net-backend@sha256:abc123...
```

Never pull `latest` or unversioned tags in production.

### Docker Socket Mount Prohibition

> ⚠️ **Never** mount `/var/run/docker.sock` into a container. Any process inside the container gains full control of the Docker daemon and can escape to the host. Remove this volume mount from all container definitions if present.

### Docker Bench for Security

Run Docker Bench for Security monthly to audit your Docker host configuration:

```bash
docker run --net host --pid host --userns host --cap-add audit_control \
  docker/docker-bench-security
```

Review and remediate any WARN findings.

### Read-Only Root Filesystem

Where the application allows it, run containers with a read-only root filesystem:

```bash
# Docker CLI
docker run --read-only your-image:tag

# Docker Compose
services:
  ainet-node:
    read_only: true

# Kubernetes
securityContext:
  readOnlyRootFilesystem: true
```

---

## 5. Network Security

### VPC and Subnet Isolation

The backend service must not be directly reachable from the internet. Use a reverse proxy or load balancer as the sole internet-facing component.

**AWS:**

- Place backend EC2 or ECS tasks in a **private subnet**.
- Use an **Application Load Balancer** in the public subnet to terminate TLS and forward traffic to the private subnet on port 3001.

**Self-hosted:**

- Use UFW to block port 3001 from external IPs.
- Expose the service externally only through nginx or Caddy on port 443.

```bash
# Block direct external access to backend port
sudo ufw deny from any to any port 3001
# Then allow only from localhost (nginx proxy)
sudo ufw allow from 127.0.0.1 to any port 3001
```

### Stellar RPC Node Selection

Choose your `STELLAR_HORIZON_URL` and `STELLAR_SOROBAN_RPC_URL` carefully:

| Criterion          | Guidance                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| **Latency**        | Prefer nodes with < 200ms response time. Measure: `time curl https://soroban-testnet.stellar.org` |
| **Reliability**    | Use the official Stellar Foundation RPC endpoints as primary; configure a fallback endpoint       |
| **Operator trust** | For mainnet, consider running your own Stellar Core node or using SDF's trusted public endpoints  |

### Private Networking for Internal Services

The following services must never be exposed to the internet. Bind them to localhost or a private network interface only:

| Service    | Port   | Binding                       |
| ---------- | ------ | ----------------------------- |
| PostgreSQL | `5432` | `127.0.0.1` or private subnet |
| Prometheus | `9090` | `127.0.0.1` or private subnet |
| Redis      | `6379` | `127.0.0.1` or private subnet |

### Secrets in Orchestration

Do not put secrets as plaintext environment variables in `docker-compose.yml` or Kubernetes manifests.

**Docker Compose:**

```yaml
# Use Docker Secrets instead of plain env vars
secrets:
  stellar_coordinator_secret:
    external: true

services:
  ainet-node:
    secrets:
      - stellar_coordinator_secret
```

**Kubernetes:** Use `sealed-secrets` or `external-secrets-operator` to sync secrets from AWS Secrets Manager or HashiCorp Vault into Kubernetes Secret objects. Never commit plaintext secrets to your GitOps repository.

### Zero-Trust Networking for Multi-Node Deployments

For deployments spanning multiple nodes, use **WireGuard VPN** to create an encrypted private mesh network between nodes. This eliminates reliance on network-level trust between VMs or bare-metal hosts.

---

## 6. Incident Response

### Indicators of Unauthorized Contract Calls

Monitor Horizon for unexpected calls to the agent registry from unknown public keys.

**Horizon query** — fetch recent transactions for the registry contract:

```bash
curl "https://horizon-testnet.stellar.org/accounts/${REGISTRY_CONTRACT_ID}/transactions?limit=200&order=desc" \
  | jq '.["_embedded"].records[] | {hash, created_at, source_account}'
```

Watch for unexpected invocations of:

- `deregister_node` — could indicate an attacker revoking legitimate nodes
- `update_authorized_node` — could indicate key substitution
- `claim_balance` — could indicate unauthorized fund extraction

**Prometheus alert** — trigger on unexpected `deregister_node` calls:

```yaml
# prometheus/alerts.yml
- alert: UnexpectedDeregisterNode
  expr: increase(stellar_contract_call_total{method="deregister_node"}[5m]) > 0
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: "Unexpected deregister_node contract call detected"
```

### Emergency Pause Procedure

The `pause_node` function on the agent registry contract halts all new task assignments to your node. Only the account holding `STELLAR_COORDINATOR_SECRET` can call it.

1. Invoke the pause:

   ```bash
   stellar contract invoke \
     --id $REGISTRY_CONTRACT_ID \
     --source $STELLAR_COORDINATOR_SECRET \
     --network testnet \
     -- pause_node
   ```

2. Verify the pause succeeded:

   ```bash
   stellar contract invoke \
     --id $REGISTRY_CONTRACT_ID \
     --source $STELLAR_COORDINATOR_SECRET \
     --network testnet \
     -- get_node_status \
     --public_key $YOUR_PUBLIC_KEY
   ```

   Expected response: `{ "status": "paused" }`

3. After the pause takes effect, in-flight tasks complete normally. No new tasks are assigned until you explicitly resume the node.

### Evidence Preservation

Capture evidence before any remediation steps. Restarting containers or modifying files can destroy forensic data.

```bash
# 1. Snapshot the database
pg_dump ai_net > pre-incident-$(date +%Y%m%d).sql

# 2. Export container logs
docker logs ai-net-backend > backend-$(date +%Y%m%d).log
docker logs ai-net-postgres > postgres-$(date +%Y%m%d).log

# 3. Export Horizon transaction history for the coordinator key (last 7 days)
curl "https://horizon-testnet.stellar.org/accounts/${COORDINATOR_PUBLIC_KEY}/transactions?limit=200&order=desc" \
  > horizon-transactions-$(date +%Y%m%d).json
```

> ⚠️ **Do not restart containers until logs are captured.** Container restarts flush log buffers and may overwrite evidence needed for forensic analysis.

### Recovery Steps

After evidence is preserved and the incident is contained:

1. Rotate all keys: Stellar keypair, JWT signing key, database password, Redis password.
2. Audit all contract authorizations — confirm no unknown keys have `authorized_node` status.
3. Re-run Docker Bench for Security to detect configuration drift.
4. Review all environment variables in the running container against expected values.
5. Resume the node only after the above steps are complete and verified.

---

## 7. Compliance Checklist

The table below maps SOC 2 Type II relevant controls to specific actions for ai-net node operators.

| SOC 2 Control | Description                  | Node Operator Action                                                                                     |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| **CC6.1**     | Logical access controls      | Disable root SSH; SSH key-only auth configured; fail2ban active                                          |
| **CC6.2**     | New user access provisioning | Key rotation procedure followed for all new operators                                                    |
| **CC6.3**     | Access removal               | Old Stellar key deregistered via `deregister_node()` within 1 day of rotation                            |
| **CC6.6**     | Logical access from outside  | TLS 1.3 only; HSTS enabled; no direct DB internet exposure                                               |
| **CC6.7**     | Transmission of data         | All traffic over HTTPS/WSS; no plaintext HTTP in production                                              |
| **CC7.1**     | System monitoring            | Prometheus + alerting configured; Horizon event monitoring active                                        |
| **CC7.2**     | Anomaly detection            | fail2ban for SSH; Prometheus alerts on unexpected contract calls                                         |
| **CC8.1**     | Change management            | Key rotation procedure documented and followed; Docker image scanning on every deploy                    |
| **A1.1**      | Availability monitoring      | Uptime monitoring configured per [UPTIME_MONITORING.md](./UPTIME_MONITORING.md); health endpoint checked |
| **A1.2**      | Availability recovery        | Disaster recovery runbook followed per [DATABASE_BACKUP_DR.md](./DATABASE_BACKUP_DR.md)                  |

---

## Related Documentation

- [Node Operators Guide](./NODE_OPERATORS_GUIDE.md)
- [Uptime Monitoring](./UPTIME_MONITORING.md)
- [Database Backup & Disaster Recovery](./DATABASE_BACKUP_DR.md)
- [Threat Model](./THREAT_MODEL.md)
- [Security Checklist](./SECURITY_CHECKLIST.md)
