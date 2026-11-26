#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
fixture=${1:?Absolute fixture directory required}
[[ $fixture == /* && ! -e $fixture ]]
mkdir -p "$fixture"
legacy=5a6bf7ab17ac96611c45375777cf39a4d0320cba
candidate=$(git rev-parse HEAD)
export VITE_SUPABASE_URL=https://security-rollout-fixture.supabase.co
export VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_security_fixture
export VITE_ACCOUNT_DELETION=true VITE_SYNC_DIAGNOSTICS=true

build() {
  local label=$1 sha=$2 email_codes=$3
  local source="$fixture/source-$label"
  mkdir "$source"
  git archive "$sha" | tar -x -C "$source"
  cd "$source"
  python3 - "$label" <<'PY'
from pathlib import Path
import sys
config = Path('vite.config.ts')
config.write_text(config.read_text().replace('/shopping-app/', '/shopping-app-preview/integration/'))
page = Path('index.html')
page.write_text(page.read_text().replace('<html ', f'<html data-rehearsal-revision="{sys.argv[1]}" ', 1))
PY
  if [[ $label == legacy ]]; then npm ci --no-audit --no-fund; else ln -s "$root/node_modules" node_modules; fi
  VITE_ACCOUNT_EMAIL_CODES="$email_codes" npm run build
  printf '%s\n' "$sha" > dist/revision.txt
  mv dist "$fixture/$label"
  cd "$root"
}

build legacy "$legacy" true
build candidate "$candidate" true
build paused "$candidate" false
