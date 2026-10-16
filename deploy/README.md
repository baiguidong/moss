# Deployment

All deployable Moss services and offline prerequisites live under this directory:

- [`server/`](server/README.md): Moss Server Docker Compose installation, release packaging, and an optional shared WebUI portal with one persistent Linux container per user.
- [`webui/`](webui/README.md): GitHub CLI-triggered Linux AMD64 image/packages, single-user local execution, and optional integration with the Server installer.
- [`im/`](im/README.md): OpenIM installation and configuration.
- [`rag/`](rag/README.md): RAGFlow and MCP installation and configuration.
- [`docker/`](docker/README.md): offline Docker Engine and Compose installer.

Generated archives are written to each component's ignored `dist/` directory unless an
explicit output directory is supplied.
