# TANTRA deployment

The workspace runs in the k3s cluster at `192.168.0.100` and is published on the public
internet through a Cloudflare Tunnel. State lives outside the pods: PostgreSQL for
relational data and vectors, MinIO for documents and generated bundles. Only the pod
scratch cache is local, so a restart never loses data.

## Shape

| Piece | Where | Notes |
| --- | --- | --- |
| Backend API | Deployment `tantara-backend`, port 8010 | one worker; `/readyz` gates traffic |
| Frontend | Deployment `tantara-frontend`, port 3000 | Next.js standalone server |
| Public route | Deployment `tantara-tunnel` (2 cloudflared connectors) | ingress rules come from the rendered `config.yml` |
| LAN route | Ingress `tantara` (Traefik class) | host `tantra.local`, Traefik port 8082 |
| Data | PostgreSQL `tantra` + MinIO bucket `tantara` | addressed by `DATABASE_URL` / `OBJECT_STORAGE=s3` |

Path rules are identical at both edges: `/api/v1`, `/health`, `/readyz` go to the
backend, everything else to the frontend.

## Build and roll out

```bash
deploy/build.sh                 # podman build + push to 192.168.0.100:5000, records the tag
deploy/apply.sh --seed --dns    # secrets, workloads, rollouts, demo data, public DNS
```

`build.sh` bakes the FastEmbed and OCR model caches into the backend image, so a
starting pod makes no model-hub calls. `apply.sh` reads the authorized local
credentials file through `deploy/render-config.py`, creates the `tantara-secrets`,
`tantara-registry` and `tantara-cloudflared` Secrets, and only substitutes the pushed
image tag into the manifests — no secret value is ever written into Git or an image.

Useful flags: `--tag TAG` to roll out a specific build, `--seed` to reload the demo
workspace, `--dns` to create or update the proxied `CNAME` for the tunnel.

## Verifying a rollout

```bash
export KUBECONFIG=sensitive/kubeconfig
kubectl -n tantara get pods,deploy,ingress
curl -fsS https://tantra.theessencetimes.com/readyz
curl -fsS https://tantra.theessencetimes.com/api/v1/health
cd backend && TANTARA_E2E_BASE=https://tantra.theessencetimes.com/api/v1 \
  TANTARA_ADMIN_PASSWORD="$(cat ~/.config/tantara/tantara-admin-password)" \
  .venv/bin/python tests/e2e_flows.py
```

The generated advocate password is stored once in `~/.config/tantara/tantara-admin-password`
(mode 600) and reused on later runs.

## Operational notes

- Migrations run at backend startup (`init_db` → `alembic upgrade head`); the seed Job is
  applied only after the backend rollout is ready so Alembic runs once.
- `sensitive/` stays out of the build context (`.containerignore`) and out of Git.
- Rollback is `deploy/apply.sh --tag <previous-tag>`; images are immutable by tag.
- The tunnel credentials in `sensitive/creds.yaml` carry a mistyped `tunnel_id`; the
  renderer uses the id decoded from the tunnel token and reports the mismatch.
