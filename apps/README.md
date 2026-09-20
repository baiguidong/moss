# Bundled Apps

Place built-in Moss App source directories here. The desktop packager copies
this directory into application resources; the directory is intentionally empty
until a bundled App is ready for release.

Persistent external-message integrations should be packaged as App Backends
using `moss.channel/v1`; see `ui/docs/channel-host-api.md` for the contract.
