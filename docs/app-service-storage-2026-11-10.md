# App service storage

Online service Apps no longer execute from `~/.moss/connectors`. Their existing
`connectorApp` manifest contract and IPC names remain compatible with released
App packages; the installed App, active version and grants remain authoritative.

## Layout

| Content | Location |
| --- | --- |
| Immutable metadata, default MCP/CLI definitions, schemas, scripts and skills | `apps/<appId>/versions/<version>/connector/` |
| Service activation reference and connection state | `apps-data/<appId>/service/{activation,state}.json` |
| User configuration overrides | `apps-data/<appId>/service/config/` |
| CLI working directory and local mutable files | `apps-data/<appId>/service/workspace/` |
| Encrypted service credentials | `apps-data/<appId>/service/credentials.v3.json` |
| Core search and enterprise account credentials | `credentials/core.v3.json` |
| One-time import markers | `credentials/app-service-upgrades/` and `credentials/legacy-service-upgrade.json` |

Activation references the validated package instead of copying it. Skills and
relative CLI script entrypoints resolve directly to package resources. CLI and
stdio MCP processes receive `MOSS_APP_ID`, `MOSS_APP_PACKAGE_DIR`,
`MOSS_APP_SERVICE_DIR` and `MOSS_APP_DATA_DIR`; their default working directory is
App data. Existing `MOSS_CONNECTOR_HOME` and vendor resource aliases point to the
package's service resource directory, not a shared mutable installation.

App credentials use a distinct encryption identity per App. Core credentials are
separate. Explicit uninstall options for deleting data and clearing credentials
remain independent. Import markers survive data deletion so cleared credentials
cannot be resurrected from legacy data.

## Upgrade

Only an already installed App with matching legacy `appId` can import state.
Uninstalled legacy services never become installed Apps. The importer preserves
connection state, encrypted credentials, edited CLI/MCP configuration and files
created by the CLI. Identical package resources are not copied; edited or obsolete
package files are preserved under `legacy-package-edits` for review, not executed
instead of the current package. Changed catalog overrides are folded into the
App's configuration once. Runtime configuration never reads the old catalog.

After all registered service Apps complete import and Core credentials are saved,
startup renames the old root into `backups/connectors-before-app-services-<id>`.
The backup preserves orphaned services, old credential formats and catalog files;
it is never used for runtime fallback. A failed or incomplete import leaves the
original directory in place for retry. New profiles never create `connectors`.
The retired root appears under Other while pending, and the archive belongs to
History in storage settings.

The old catalog ZIP export helpers accept explicit source paths only, for fixture
and package export tooling. They do not populate a user catalog or install services.
Old install IPC directs users to the App marketplace.

## Validation

- Focused service, credential, lifecycle, authorization and uninstall tests.
- Storage tests cover upgrades, restart, rollback, encrypted isolation, retries,
  credential clearing, path validation and retirement of orphaned data.
- Desktop prepare/restart smoke tests preserve sessions, workspace operations,
  project data and the exclusion of uninstalled legacy services.
- UI contract/type/syntax checks and all 115 legacy package export fixtures.
- `node ui/scripts/verify-app-service-upgrade.mjs [profile]` validates installed
  packages against a private copy of a profile, removes the copied legacy root
  and backup, then verifies skills/configuration and package integrity. It does
  not mutate the source profile or execute installed service commands.

Local verification on 2026-11-10 covered 105 Apps, 327 skills and 53 MCP definitions
(52 unique server names after aggregation). Moss was gracefully restarted and
completed the real upgrade. App and Core credentials were compared in memory
without printing secrets. The active service data occupies about 0.9 MiB; the old
80 MiB directory is retained in the history backup, so this is not a claim of
80 MiB of reclaimed disk space.
