# Container Image Signing

All production container images for ai-net are signed with [cosign](https://github.com/sigstore/cosign) using keyless OIDC mode (Sigstore / Fulcio / Rekor). No long-lived private signing key is stored anywhere — the signature is cryptographically tied to the GitHub Actions workflow run that produced the image via GitHub's OIDC token.

An SBOM in SPDX JSON format is generated for every image with [syft](https://github.com/anchore/syft) and attached as a cosign OCI attestation alongside the image in the registry.

---

## Verifying an image signature

```bash
cosign verify \
  --certificate-identity-regexp '.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  <IMAGE>
```

Replace `<IMAGE>` with the full ECR URI including tag or digest, for example:

```bash
cosign verify \
  --certificate-identity-regexp '.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  123456789.dkr.ecr.us-east-1.amazonaws.com/ai-net-backend:sha-a1b2c3d
```

A successful verification prints the certificate details and exits 0. A non-zero exit means the image is unsigned or the signature cannot be verified — the deployment workflows treat this as a hard failure and abort.

---

## Downloading the SBOM attestation

```bash
cosign download attestation <IMAGE> | jq -r '.payload' | base64 -d | jq .
```

The decoded payload is a SPDX JSON document listing every package in the image. You can convert or query it with syft:

```bash
# Save the raw SPDX JSON
cosign download attestation <IMAGE> \
  | jq -r '.payload' | base64 -d \
  | jq -r '.predicate' > sbom.spdx.json

# Validate / convert with syft
syft convert sbom.spdx.json -o table
```

---

## Image tagging convention

| Scenario | Tags applied |
|---|---|
| Push to `main` | `sha-<7-char-sha>`, `latest` |
| Push of a version tag (`v*.*.*`) | `sha-<7-char-sha>`, `latest`, `<semver>` |

---

## Workflow overview

| Workflow | Trigger | What it does |
|---|---|---|
| `build-push.yml` | Push to `main` or version tag | Builds backend + frontend, pushes to ECR, signs with cosign, attaches SBOM attestation |
| `deploy-backend.yml` | `workflow_dispatch` | Verifies signature before deploying; runs full canary promotion flow |
| `staging-deploy.yml` | `workflow_dispatch` | Verifies signature before deploying to staging |

---

## Security model

- **No stored private key.** Signing uses GitHub OIDC → Fulcio CA → short-lived certificate. The certificate embeds the workflow URL as the subject, binding each signature to a specific repository and workflow.
- **Transparency log.** Every signature is recorded in the Rekor transparency log, making it auditable and tamper-evident.
- **Deployment gate.** `cosign verify` runs before any `docker pull` or ECS task definition update. A non-zero exit aborts the deployment.
