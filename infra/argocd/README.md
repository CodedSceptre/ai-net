# GitOps with ArgoCD

This directory contains ArgoCD Application CRDs and configuration for the ai-net GitOps continuous deployment pipeline.

---

## How it works

```
Code merged to main
       │
       ▼
   CI passes
       │
       ▼
update-manifests.yml
  bumps image.tag in
  infra/k8s/helm/charts/*/values.yaml
  and commits to main
       │
       ▼
  ArgoCD detects
  values file change
       │
       ▼
  ArgoCD syncs
  cluster to git state
       │
       ├── health check passes → ✅ done
       └── health check fails for 5 min → 🔄 auto-rollback
```

Merging to `main` triggers a full deploy in under 2 minutes (CI) + sync time (< 5 minutes for an image-tag-only update). No manual steps required.

---

## Applications

| Application | File | Helm chart |
|-------------|------|------------|
| `ai-net-backend` | `backend-app.yaml` | `infra/k8s/helm/charts/backend/` |
| `ai-net-frontend` | `frontend-app.yaml` | `infra/k8s/helm/charts/frontend/` |

Both applications have `syncPolicy.automated` enabled with:
- `prune: true` — removes Kubernetes resources deleted from git
- `selfHeal: true` — reverts manual `kubectl` changes back to git state within ~3 minutes

---

## Triggering a deployment

Deployments are fully automatic. Every push to `main` that passes CI will:

1. Have its image tag committed to `infra/k8s/helm/charts/*/values.yaml` by `update-manifests.yml`
2. Be detected by ArgoCD, which starts a sync automatically

To trigger a manual sync (e.g. to re-apply the current desired state):

```bash
# Sync backend
argocd app sync ai-net-backend

# Sync frontend
argocd app sync ai-net-frontend
```

---

## Manual rollback

ArgoCD rolls back automatically when a deployment fails its health check for 5 minutes. To perform a manual rollback to a specific previous revision:

```bash
# List recent history
argocd app history ai-net-backend

# Roll back to revision N
argocd app rollback ai-net-backend <revision-id>
```

Alternatively, revert the image tag commit in git — ArgoCD will detect the change and re-sync:

```bash
git revert HEAD   # reverts the manifest bump commit
git push origin main
```

---

## Handling a sync conflict

A sync conflict occurs when the live cluster state diverges from git in a way ArgoCD cannot automatically reconcile.

1. Check the application status:
   ```bash
   argocd app get ai-net-backend
   ```
2. View the diff between desired and live state:
   ```bash
   argocd app diff ai-net-backend
   ```
3. If the conflict is from a manual change you want to keep, update the git values file to match, then commit.
4. If the conflict is from a manual change you want to discard, run:
   ```bash
   argocd app sync ai-net-backend --force
   ```

`selfHeal: true` will also automatically resolve manual `kubectl` mutations within ~3 minutes without any intervention.

---

## GitHub OAuth (admin UI)

The ArgoCD admin UI requires GitHub OAuth login. Only members of the **CodedSceptre** GitHub organization can authenticate. Unauthenticated access returns a login prompt.

Configuration is in `argocd-cm.yaml` (Dex connector) and `argocd-rbac-cm.yaml` (RBAC policy).

**Secrets required** (stored as a Kubernetes secret in the `argocd` namespace):

| Key | Description |
|-----|-------------|
| `dex.github.clientID` | GitHub OAuth App Client ID |
| `dex.github.clientSecret` | GitHub OAuth App Client Secret |
| `slack-token` | Slack Bot Token for ArgoCD Notifications |

Create the GitHub OAuth App at: **GitHub → Organization Settings → Developer Settings → OAuth Apps**

Callback URL: `https://argocd.ai-net.example.com/api/dex/callback`

---

## Slack notifications

Notifications are sent to `#deployments` on:
- Sync succeeded ✅
- Sync failed ❌
- Health degraded (triggers rollback) ⚠️

Configuration is in `notifications-cm.yaml`. The Slack bot token is stored in the `argocd-notifications-secret` Kubernetes secret.

---

## Installing ArgoCD

```bash
# Install ArgoCD into the cluster
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Apply configuration
kubectl apply -f infra/argocd/argocd-cm.yaml
kubectl apply -f infra/argocd/argocd-rbac-cm.yaml
kubectl apply -f infra/argocd/notifications-cm.yaml

# Register the applications
kubectl apply -f infra/argocd/backend-app.yaml
kubectl apply -f infra/argocd/frontend-app.yaml
```
