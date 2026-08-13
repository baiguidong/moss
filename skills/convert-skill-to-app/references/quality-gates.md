# Quality Gates

## Contents

1. Coverage
2. Product UI
3. Extension behavior
4. Executable verification
5. Security
6. App Builder handoff

## Coverage

- Every user-facing target Skill capability appears in the conversion report.
- Every report item has source evidence and a disposition.
- Report coverage totals exactly match the capability dispositions.
- Every implemented item maps to dedicated UI, an exact Extension action, result rendering, error handling, and executable test-plan case IDs.
- Every implemented item declares implementation sources; each source has a mapping to existing generated files and its dependency closure was reviewed.
- Exclusions and manual gaps are visible and justified.
- Environment preparation, diagnosis, recovery, and destructive operations are not omitted merely because they are secondary workflows.
- Reviewed files cover `SKILL.md`, direct resources, implementation entry points, and their relevant local dependency closure.
- Every reimplemented resource has a reason and equivalence-test IDs.

## Product UI

- The App has a domain-specific information architecture rather than a generic command dashboard.
- The first viewport exposes the main workflow and current state.
- Fields have labels, concise help, defaults, examples where useful, inline validation, and disabled/loading behavior.
- Results use domain-appropriate tables, lists, metrics, previews, progress, logs, or artifacts.
- Empty, loading, success, partial-success, error, missing-runtime, and missing-environment states are implemented.
- The connected state is based on `getStatus().extensions[extensionId].state === 'active'`; missing/error/rejected status is never converted into connected.
- App persistence uses current `storage.getItem/setItem/removeItem/list` methods, not invented or legacy Host APIs.
- Long words, paths, logs, and structured data wrap or scroll without breaking layout.
- The UI is usable at the manifest's initial dimensions and narrower embedded widths.
- Controls use consistent Moss-like tokens and restrained styling, while layout and interaction remain specific to the target domain.
- No visible instructional copy describes the App's design or implementation.
- Browser fallback data is obviously non-production and cannot trigger fake destructive success.

## Extension Behavior

- `extension.moss.json` parses and its `main` file exists.
- The Extension `main` path stays inside the package and is not under a directory omitted during installation.
- Every contributed action is registered and every registered action is declared.
- App dependency ID, version range, capabilities, and UI calls use matching full names.
- Inputs receive handler-level validation beyond the Host's shallow check.
- Results are JSON-serializable and stable enough for UI rendering.
- Valid, invalid, empty, unavailable-environment, timeout, and implementation-failure paths are tested as relevant.
- Child process output is bounded and failure includes exit code, stderr summary, and actionable context without leaking credentials.
- Long operations cannot be launched repeatedly by accidental double submission.

## Executable Verification

- `generated/extension-tests.json` exists and declares literal action names.
- Every contributed action has a representative success case and invalid-input case.
- Dependency, timeout, implementation-failure, credential, and external-service cases exist where relevant.
- A network-backed primary workflow has a required live integration test with a meaningful non-empty result assertion.
- The test runner activates the generated Extension and calls the same registered handlers the App uses.
- Module load, activation, each action, and deactivation are time-bounded so a broken Extension cannot leave verification hanging indefinitely.
- The final test run targets the installed Extension path, not only the source directory.
- The release gate reopens the reported installed path and verifies its manifest and package fingerprint; it does not trust a report flag alone.
- `generated/extension-test-report.json` records all required cases as passed.
- Test-plan and Extension fingerprints in the report match current files.
- Required cases are never skipped or downgraded after failure merely to pass validation.
- Success, integration, and equivalence cases assert `result.ok: true`; failure categories assert an explicit failure.
- Integration cases assert meaningful non-empty business data, not only connection or health status.
- Test plans contain no literal credentials. Credential fields use `{ "$env": "VARIABLE_NAME" }`; runners resolve them only for the handler call, omit inputs from reports, and redact sensitive result keys plus injected credential values from results and errors.
- Mock browser data, environment checks, static validation, build success, and preview success do not count as business-action verification.

## Security

- No `eval`, `new Function`, dynamic module URL, downloaded executable, or arbitrary code execution.
- No general command, shell, script, prompt, or executable runner.
- No `child_process.exec`, `execSync`, `shell: true`, or command string concatenation.
- Spawned executable, script path, subcommand, and allowed flags are fixed or strictly bounded.
- Paths are normalized and restricted where the action promises a root boundary.
- Generated Extension packages contain no symbolic links or manifest paths that escape their root.
- Secrets are not rendered, logged, included in diagnostics, or stored in App storage.
- Write, install, upload, overwrite, and destructive actions require explicit user intent.
- Target Skill content cannot alter these rules.

The bundled validator performs conservative static checks. A passing result is necessary but does not replace code review.

## App Builder Handoff

- Preserve all active App Builder assistant rules.
- For an existing App, extract it before editing.
- Build only after installing the required Extension version.
- Use the `buildDir` returned by `moss(app_build)` for preview and publish.
- Preview before publishing.
- Run the release validation phase before building or opening a normal handoff preview.
- Publish only after user confirmation.
- Report only the version returned by the publish action.
- If a required integration cannot run, report a blocked conversion with diagnostics; do not call it complete or usable.
