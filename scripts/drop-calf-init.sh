#!/usr/bin/env bash
set -euo pipefail

# Run from the project directory to initialize, not from this script's directory.
# Set DROP_CALF_MODULE to a local checkout path to avoid fetching from GitHub.
module="${DROP_CALF_MODULE:-github.com/ibuchanan/ranch-rig-drop-calf}"
owner="${DROP_CALF_OWNER:-$(id -un)}"
kind="${1:-forge-app}"

dagger call \
  -m "$module" init-changes \
  --directory . \
  --kind "$kind" \
  --owner "$owner" \
  export --path .
