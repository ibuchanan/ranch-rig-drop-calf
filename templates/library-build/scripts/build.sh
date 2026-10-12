#!/usr/bin/env sh
set -eu

tsdown --no-dts
tsc -p tsconfig.declarations.json

find dist -type f -name '*.d.ts' -exec sh -c '
  for file do
    cp "$file" "${file%.d.ts}.d.cts"
  done
' sh {} +
