# Per-invocation override only. Never edits Codex config or Coucou hooks.
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'start-codex.cjs') @args
exit $LASTEXITCODE
