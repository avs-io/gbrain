#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[release-gate] typecheck"
bun run typecheck

echo "[release-gate] build"
bun run build

echo "[release-gate] workflow evals"
bun run scripts/eval-recall.ts
bun run scripts/eval-topic-tracks.ts
bun run scripts/eval-context-packs.ts
bun run scripts/eval-radar.ts
bun run scripts/eval-privacy.ts

echo "[release-gate] doctor"
bun run src/cli.ts doctor --fast --json >/tmp/gbrain-release-gate-doctor.json
node -e "const r=require('/tmp/gbrain-release-gate-doctor.json'); if(r.status==='unhealthy'){ console.error(JSON.stringify(r,null,2)); process.exit(1); } console.log(JSON.stringify({status:r.status, health_score:r.health_score, checks:r.checks.length}))"

echo "[release-gate] ok"
