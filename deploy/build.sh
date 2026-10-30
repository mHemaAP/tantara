#!/usr/bin/env bash
# Build and push the TANTRA images to the local registry, then record the tag for
# deploy/apply.sh. Run from anywhere; paths are resolved from the repository root.
#
# Usage: deploy/build.sh [image-tag]     (default: UTC timestamp)
set -euo pipefail

REGISTRY="192.168.0.100:5000"
TAG="${1:-$(date -u +%Y%m%d-%H%M%S)}"
AUTHFILE="${TANTARA_REGISTRY_AUTHFILE:-$HOME/.config/tantara/registry-auth.json}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAST_TAG_FILE="$REPO_ROOT/deploy/.last-tag"

cd "$REPO_ROOT"

if [ ! -f "$AUTHFILE" ]; then
  echo "registry auth file not found: $AUTHFILE" >&2
  echo "create it with: kubectl -n the-essence-times get secret essence-times-registry -o jsonpath='{.data.dockerconfigjson}' | base64 -d > $AUTHFILE" >&2
  exit 1
fi

for component in backend frontend; do
  image="$REGISTRY/tantara-$component:$TAG"
  echo "==> build $image"
  podman build --network=host --userns=host --isolation=chroot \
    -t "$image" -f "deploy/Containerfile.$component" .
  echo "==> push $image"
  podman push --authfile "$AUTHFILE" --tls-verify=false "$image"
done

printf '%s\n' "$TAG" > "$LAST_TAG_FILE"
echo "==> tag recorded in deploy/.last-tag: $TAG"
