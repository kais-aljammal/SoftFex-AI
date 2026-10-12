# SoftFex AI

A Windows desktop island that watches a selected source folder, independently reviews real changes, and shows evidence you can inspect and correct. Electron main owns file access, Anthropic requests and Deepgram requests; the sandboxed React renderer receives typed reports and generated audio only.

## Run locally

Requires Windows, Node.js 24+, and VS Code for source navigation.

```powershell
npm ci
npm run setup:key
npm run setup:voice
npm run build
npm test
npm start
```

The setup commands open masked terminal prompts and preserve other settings in the ignored local `.env`. `.env.example` contains blank variable names only. Never paste keys into chat. The app reads credentials only in main. Choose a project folder, then open Review settings and explicitly enable AI review if you want filtered source and available task context sent to Anthropic. Local checks work without AI. Configured key values and recognizable credential patterns are filtered before model requests, renderer reports and copied prompts. Secret filtering remains best-effort.

The sole review model is Claude Sonnet 5.5 (`claude-sonnet-5-5`), using the official Anthropic SDK with structured JSON and Zod/source-evidence validation. Voice uses Deepgram Aura 2 (`aura-2-thalia-en`), with browser/Windows speech fallback. Mute and Test voice are in the expanded island. Source navigation opens a dedicated visible VS Code window at the validated file and line.

Every AI review evaluates correctness, plus at most two relevant engineering disciplines: integration, data flow, security, frontend or reliability. Supporting context follows static relative imports and a bounded nearby-caller search: at most four files and 8,000 characters. Context-only files do not count as reviewed coverage or resolve old findings. Validated CLI task context is limited to the latest supplied task string, up to 1,600 characters; no private reasoning or assistant transcript is collected.

`npm run api:check` and `npm run voice:check` make minimal live connectivity requests; the latter verifies audio generation, not speaker audibility.

## Codex completion integration

Start SoftFex, choose the same workspace, and run the wrapper from your VS Code terminal:

```powershell
node C:\path\to\SoftFex-AI\scripts\start-codex.cjs -C C:\path\to\your\project
```

The wrapper inspects the existing Codex `notify` array, preserves it in ignored local runtime storage, and overrides `notify` only for that CLI invocation. The relay chains the existing notification command and posts a reduced, authenticated completion event to SoftFex on loopback. Global Codex settings and Coucou hooks are never rewritten. Existing Codex desktop conversations do not automatically adopt the wrapper. If completion integration is unavailable, use Review Now; filesystem observation still works.

## Windows portable beta

Download the Windows x64 beta ZIP, extract **all** files to a writable local folder, and run `SoftFex AI.exe` from that folder. Keep its `resources`, `locales`, DLLs and other companion files together. This beta is unsigned; Windows may show an unknown-publisher warning. It includes Electron and does not require this repository or `npm install` to launch. VS Code is required for Open in VS Code. The separate Codex completion launcher requires installed Node.js 24+, Python 3.11+ (with `tomllib`), and an authenticated Codex CLI available on PATH.

`SoftFex-AI-0.1.0-windows-x64.zip` is 168,215,229 bytes. SHA-256: `1F0C1B503BA93FE1CE70B8816BA14A2113CF0484A06D227D984474527B1F55A4`.

Open SoftFex, choose Configure Anthropic key, and enter the key in the separate masked Windows PowerShell prompt. Configure Deepgram voice is optional; browser/Windows speech is the fallback. Keys never pass through the renderer or command-line arguments. They are stored in `%APPDATA%\SoftFex AI\credentials.env` with inheritance disabled and access restricted to the current Windows user. This is a private local file, not an encrypted vault. The development `.env` remains unchanged and is excluded from the package. Close setup and return to SoftFex; key presence refreshes automatically. Enable AI review separately to consent to sending filtered source/context.

After starting the packaged app and selecting your project, launch the supported Codex session from a terminal:

```powershell
node "$env:APPDATA\SoftFex AI\runtime\scripts\start-codex.cjs" -C "C:\path\to\your\project"
```

Runtime helpers and the authenticated loopback descriptor live under the current user's application data, outside the executable. Global Codex/Coucou configuration stays unchanged. Review Now works without the Codex launcher. `npm run package:windows` also builds a portable single executable, but the release ZIP is the artifact verified outside the repository. Inspect its actual contents with `node scripts/verify-package.mjs --zip`. Signing, cross-machine installation behavior and human speaker audibility remain beta/manual gates.

## Three-minute demo

1. Run `node scripts/demo-fixture.mjs safe`, start SoftFex, and choose the printed demo folder. Enable AI review and click Test voice.
2. Run `node scripts/demo-fixture.mjs unsafe`, or ask the wrapped Codex CLI to make that controlled fixture change. The pending counter updates; a CLI completion triggers review, or click Review Now.
3. Open the potential SQL-injection finding, inspect its source evidence, open the exact line in VS Code, and copy the fix prompt. SoftFex never edits code or runs the fix itself.
4. Have Codex apply the correction, or honestly demonstrate the prepared correction with `node scripts/demo-fixture.mjs safe`. Review Again shows whether this specific finding is no longer detected.

Do not edit report data or present the controlled example as a real database/server. API failures preserve local checks and explicit incomplete coverage; voice failures preserve visible findings.

## Checks and limits

```powershell
npm run build
npm test
node scripts/smoke-shell.mjs
node scripts/smoke-watcher.mjs
node scripts/smoke-reviewer.mjs
node scripts/smoke-workflow.mjs
node scripts/smoke-voice.mjs
node scripts/smoke-completion.mjs
node scripts/smoke-security.mjs
node scripts/smoke-workspace-recovery.mjs
node scripts/smoke-voice-failure.mjs
node scripts/smoke-auto-voice.mjs
node scripts/smoke-private-evidence.mjs
node scripts/smoke-review-failure.mjs
node scripts/smoke-live-scenarios.mjs
npm run secrets:check
```

Run Electron smoke scripts sequentially. Reviewer/voice/completion and live-scenario scripts use real providers or the installed Codex CLI, may consume credits, and need network access. Controlled Codex test turns use medium reasoning effort per invocation; the installed model and global configuration are preserved. The live-scenario check has Codex actually write and correct controlled SQL, arithmetic and HTTP-contract defects, then reviews the clean implementation. It checks real clipboard content, source-bound findings and playback events, and writes sanitized timings to ignored `artifacts/live-scenarios.json`. Folder-picker responses in automated scripts are supplied by tests; native picker and mouse checks are separate. Recovery and corrupt-audio checks use synthetic failure injection. The workflow checks open controlled temporary files in VS Code. Screenshots stay in ignored `artifacts/`.

Reviews are bounded to 12 source files, 12,000 characters per file and 45,000 context characters; batches contain at most three files and results at most 12 findings. Supported source types are TS/TSX/JS/JSX/JSON. Secrets, dependencies, generated files and symlink escapes are excluded. No automatic tests or arbitrary project commands run. AI requests have a 30-second request timeout, one retry across transient failures and a 90-second review deadline. Skipped, failed or outdated coverage cannot establish a clean project. Findings remain potential issues, not proof of exploitability or security certification.

This MVP has source and portable beta builds, with no installer, telemetry, database, accounts or automatic code modification. On Windows it uses an opaque black frameless window with a rounded native region and tight bounds: transparent compositing failed native input checks on the demo machine. Native folder selection, source observation, mouse interaction, collapse/reopen and review playback were exercised at the current 119% display scaling; the product's source action was independently observed in VS Code at the actual file and line. Speaker audibility, subjective visual quality and other display scaling still need manual confirmation.

Before every push, stage only intended files and run `npm run secrets:check`. The repository's `.githooks/pre-push` runs the same check when `git config core.hooksPath .githooks` is configured locally. Never force-push or commit `.env`, runtime notification descriptors, dependencies or build output.
