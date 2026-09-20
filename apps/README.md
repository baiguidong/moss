# Bundled Apps

Built-in Moss App source directories live here. The desktop packager copies
this directory into application resources. Each App owns its source, schemas,
assets, tests and generated `dist/` output so it can later move to a separate
repository without depending on Desktop implementation modules.

Persistent external-message integrations should be packaged as App Backends
using `moss.channel/v1`; see `ui/docs/channel-host-api.md` for the contract.
