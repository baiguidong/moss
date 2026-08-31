# Quality Gates

## Coverage

- Every user-facing Skill capability has evidence and a disposition.
- Every implemented capability maps to purpose-specific UI, one declared Backend action, result/error states, and required tests.
- Reviewed files include the complete relevant dependency closure.
- Reimplementation has a concrete reason and executable equivalence cases.

## App V2

- `app.moss.json` is schema version 2 with valid semantic version and Host API range.
- At least one of `ui` or `backend` exists; all declared paths stay inside the package.
- Backend action names are unique and referenced JSON Schemas compile.
- Backend-only Apps have enough configuration schema for generic App Center UI.
- UI calls only declared actions through `window.mossApp.actions`.
- UI-only Apps have no Backend runtime assumptions.

## Backend

- Backend entry is a bundled Node module with no runtime dependency installation.
- Every action validates input, observes cancellation, bounds external work, and returns serializable values.
- Persistent and multi-instance modes are justified by actual product requirements.
- No general shell, code runner, arbitrary executable, arbitrary arguments, or arbitrary working-directory interface exists.
- Paths, subprocess environment, network retries, output sizes, errors, and secrets are bounded and sanitized.

## Verification

- `generated/backend-tests.json` covers success and invalid input for every action.
- Required dependency, failure, timeout, integration, and equivalence cases exist where applicable.
- Live network primary workflows return meaningful business data.
- Required cases pass against the built App artifact.
- Plan and package fingerprints in `backend-test-report.json` match current files.
- Crashes, timeouts, and cancellation do not leave child processes.

## Release

- Package checksum coverage is complete and no symbolic links exist.
- No package code is imported into Electron Main or Moss Server.
- App Center is the installation and management surface.
- The final handoff reports App ID/version, actions, schemas, lifecycle, instance mode, targets, permissions, tests, and remaining manual gaps.
