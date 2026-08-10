---
name: local-kb
description: "Use this skill when the user wants to create, maintain, ingest, or search a local knowledge base using unstructured document parsing, jieba Chinese tokenization, SQLite, and FTS5. Trigger for local document corpus indexing, incremental reindexing, keyword retrieval, project knowledge search, or troubleshooting the local-kb Python environment."
---

# Local KB

This skill manages a local-first document knowledge base backed by SQLite FTS5. Runtime resources are intentionally limited to `scripts/kb.py` and `assets/kb-info-template.html`. Use `kb.py` for deterministic knowledge base work; do not reimplement ingestion or search logic in the conversation.

When this skill is injected, the message begins with `Base directory for this skill: ...`. Treat that directory as `SKILL_DIR` and run the script from that directory, not from the conversation workspace. In examples below, replace `/path/to/local-kb` with the injected base directory, normally `/Users/bgd/.moss/skills/local-kb`.

Default to the smallest command set that satisfies the user's request. Treat user requests such as "add/import this document/folder to the knowledge base" as add-and-index requests: register the path, run `refresh`, and update the same status HTML page. Only stop after `add-path` when the user explicitly says to only register the path or not index yet. Maintain exactly one local-kb status HTML page per session: open it once by default, then update the same HTML artifact after create, path, ingest, refresh, or other data-changing actions without opening another page.

## Storage

Default root:

```text
~/.moss/local-kb/
├── env/          # Optional prepared venv; not bundled with the skill
├── local-kb.db   # SQLite database, created on first use
└── logs/
```

Set `LOCAL_KB_HOME=/custom/path` to override the root.

## Python Environment

The skill package does not include a Python virtual environment. It only includes runtime files: `scripts/kb.py` and `assets/kb-info-template.html`.

Use the current available Python for metadata-only commands such as `overview`, `dashboard-data`, `render-html`, `list`, `init`, `add-path`, `paths`, `scan`, `stats`, and `docs`; those only need the Python standard library and SQLite FTS5.

Prepare and use `~/.moss/local-kb/env/bin/python` only before commands that need external parser/tokenizer packages, mainly `ingest` and `search`, or after a command fails with a concrete missing dependency error.

## Common Commands

Use these commands directly according to intent. Do not execute the whole list as a workflow.

Status of all knowledge bases:

```bash
python /path/to/local-kb/scripts/kb.py overview
python /path/to/local-kb/scripts/kb.py render-html --all --stdout
```

Status of one knowledge base:

```bash
python /path/to/local-kb/scripts/kb.py dashboard-data --kb project-docs
```

List knowledge bases:

```bash
python /path/to/local-kb/scripts/kb.py list
```

Create a knowledge base:

```bash
python /path/to/local-kb/scripts/kb.py init --name project-docs
python /path/to/local-kb/scripts/kb.py add-path --kb project-docs /path/to/docs
```

Create and register paths in one command when the corpus is already known:

```bash
python /path/to/local-kb/scripts/kb.py init --name project-docs --path /path/to/docs --max-depth 2 --ext md,pdf
```

Knowledge base name is required at creation time. If the user has not provided a name, choose a short descriptive slug from the corpus or project context instead of creating an unnamed library.

Pass corpus roots to `add-path`, not every discovered file. If the user gives a folder, add the folder once. If the user gives multiple explicit files, pass them in one `add-path` command instead of running one command per file.

Add documents to an existing knowledge base and index them by default:

```bash
python /path/to/local-kb/scripts/kb.py add-path --kb project-docs /path/to/new.docx
~/.moss/local-kb/env/bin/python /path/to/local-kb/scripts/kb.py refresh --kb project-docs
python /path/to/local-kb/scripts/kb.py render-html --all --stdout
```

Use only `add-path` without `refresh` when the user explicitly asks to register paths without indexing.

Use script parameters for scan scope instead of shell-side file enumeration:

```bash
python /path/to/local-kb/scripts/kb.py add-path --kb project-docs --max-depth 2 --include "**/*.md" --exclude "**/drafts/**" --ext md /path/to/docs
python /path/to/local-kb/scripts/kb.py scan --kb project-docs --summary
python /path/to/local-kb/scripts/kb.py scan --max-depth 1 --ext md,txt /path/to/docs
```

Rules for scan parameters:

- `--max-depth 0` means files directly inside the root only; `--max-depth 2` allows two directory levels below the root.
- `--include` and `--exclude` are repeatable glob patterns relative to each root, and also match the filename.
- `--ext` is repeatable and also accepts comma-separated values such as `md,pdf,docx`.
- `scan` needs only the standard library. It previews selected files without parsing or writing documents.
- Use `ingest --dry-run --limit N` before indexing broad or unfamiliar directories.

Default supported extensions include documents (`md`, `txt`, `html`, `docx`, `pdf`, `pptx`, `xlsx`), structured text (`csv`, `json`, `yaml`, `xml`), and common source files (`py`, `js`, `ts`, `tsx`, `go`, `rs`, `java`, `c/cpp`, `sh`, `css`).

Ingest changed documents after preparing the venv:

```bash
~/.moss/local-kb/env/bin/python /path/to/local-kb/scripts/kb.py ingest --kb project-docs
~/.moss/local-kb/env/bin/python /path/to/local-kb/scripts/kb.py ingest --kb project-docs --dry-run --limit 20
```

For one-shot ingest without registering a corpus path, pass explicit files or directories to `ingest`:

```bash
~/.moss/local-kb/env/bin/python /path/to/local-kb/scripts/kb.py ingest --kb project-docs --max-depth 1 --ext md,txt /path/to/docs /path/to/file.pdf
```

Search after preparing the venv:

```bash
~/.moss/local-kb/env/bin/python /path/to/local-kb/scripts/kb.py search --kb project-docs "sqlite 全文检索"
~/.moss/local-kb/env/bin/python /path/to/local-kb/scripts/kb.py search --kb project-docs --ext md --path docs "sqlite 全文检索"
~/.moss/local-kb/env/bin/python /path/to/local-kb/scripts/kb.py search --kb project-docs --mode any --context 1 "SQLite FTS5"
~/.moss/local-kb/env/bin/python /path/to/local-kb/scripts/kb.py search --kb project-docs --mode any --context 1 --out /path/in/current/workspace/local-kb-search.json "SQLite FTS5"
```

Refresh the KB and update the same status page in one command:

```bash
~/.moss/local-kb/env/bin/python /path/to/local-kb/scripts/kb.py refresh --kb project-docs
python /path/to/local-kb/scripts/kb.py render-html --all --stdout
```

In Moss desktop, pass the `render-html --all --stdout` HTML to Moss `app_build` rather than writing a normal file with `--out`.

Maintenance and inspection:

```bash
python /path/to/local-kb/scripts/kb.py config --kb project-docs
python /path/to/local-kb/scripts/kb.py update-config --kb project-docs --target-size 800 --overlap 120 --ext md,txt,pdf
python /path/to/local-kb/scripts/kb.py remove-path --kb project-docs /path/to/docs
python /path/to/local-kb/scripts/kb.py docs --kb project-docs --status error
python /path/to/local-kb/scripts/kb.py errors --kb project-docs
python /path/to/local-kb/scripts/kb.py prune --kb project-docs --dry-run
python /path/to/local-kb/scripts/kb.py prune --kb project-docs --apply
python /path/to/local-kb/scripts/kb.py rebuild-fts --kb project-docs
python /path/to/local-kb/scripts/kb.py export --kb project-docs --kind dashboard --out /path/to/kb-dashboard.json
python /path/to/local-kb/scripts/kb.py doctor --kb project-docs
```

Knowledge base lifecycle:

```bash
python /path/to/local-kb/scripts/kb.py rename-kb --kb project-docs --name project-reference
python /path/to/local-kb/scripts/kb.py delete-kb --kb project-reference
python /path/to/local-kb/scripts/kb.py delete-kb --kb project-reference --yes
```

Deletion commands are preview-first. `delete-kb` and `remove-doc` require `--yes` to apply. `prune` requires `--apply` to delete missing indexed documents.

## Environment Preparation

Only do this before `ingest`/`refresh`/`search`, when the user asks to prepare the local-kb environment, or when `kb.py` fails with import/parser dependency errors. Do not run these commands before simple status, list, dashboard, create-only, or register-only path-management requests.

Ensure the venv exists:

```bash
mkdir -p ~/.moss/local-kb
python -m venv ~/.moss/local-kb/env
~/.moss/local-kb/env/bin/python -m pip install --upgrade pip setuptools wheel
```

Check Python dependencies in the venv. Use direct import probes and inspect errors instead of relying on a setup script:

```bash
~/.moss/local-kb/env/bin/python -c "import sqlite3; con=sqlite3.connect(':memory:'); con.execute('CREATE VIRTUAL TABLE t USING fts5(x)'); import jieba, unstructured; print('ok')"
```

If dependencies are missing, install them directly:

```bash
~/.moss/local-kb/env/bin/python -m pip install "unstructured[all-docs]" jieba markdown python-magic
```

Use smaller package sets only when the user explicitly wants a minimal install.

If an ingest or import fails, diagnose the concrete missing dependency from the exception and the file type:

- `markdown missing` or `ModuleNotFoundError: markdown`: run `~/.moss/local-kb/env/bin/python -m pip install markdown`.
- `No module named jieba`: run `~/.moss/local-kb/env/bin/python -m pip install jieba`.
- `No module named unstructured` or parser extras missing: run `~/.moss/local-kb/env/bin/python -m pip install "unstructured[all-docs]"`.
- `No module named magic`: run `~/.moss/local-kb/env/bin/python -m pip install python-magic`.
- `libmagic is unavailable`, `failed to find libmagic`, or `MagicException`: install native `libmagic`; installing only `python-magic` is not enough on macOS/Linux.

For native `libmagic`, choose the host-specific package manager. Request approval when sandboxing or permissions block the install:

Common commands:

```bash
brew install libmagic
sudo apt-get update && sudo apt-get install -y libmagic1 file
sudo dnf install -y file-libs file
```

On Windows, try `~/.moss/local-kb/env/bin/python -m pip install python-magic-bin`, or install `libmagic` through the available package manager.

For PDF, OCR, and office documents, also check parser tools and install only what the failing corpus needs:

```bash
brew install poppler tesseract libreoffice
sudo apt-get install -y poppler-utils tesseract-ocr libreoffice
```

Check tools with `command -v pdftotext`, `command -v tesseract`, and `command -v libreoffice` when PDF/OCR/office parsing fails.

## HTML Status Pages

Generate and open exactly one knowledge base status HTML page by default. The user should not need to explicitly ask to open it. For status, create, ingest, and refresh tasks, return a concise text summary and keep that same HTML status page in sync without reopening it.

Use `render-html` to build the status page from actual database data and the bundled `assets/kb-info-template.html`. In Moss desktop, the status page must be written through Moss `app_build` so it appears in the right-side workspace. Prefer `render-html --all --stdout` for the session status page so the user can switch between knowledge bases in one window.

```bash
python /path/to/local-kb/scripts/kb.py render-html --all --stdout
```

Moss desktop flow:

1. Run `render-html --all --stdout` to get the complete HTML.
2. Call Moss `app_build` with `name: "local-kb-status"` and that HTML. The returned `filePath` is inside the current session workspace and should appear in the right-side workspace.
3. Call Moss `app_preview` only the first time this status page is created in the session.

In Moss desktop, never answer a status-page location from a guessed `~/.moss/workspace/...` path and never use `render-html --out` for the normal status page. The only authoritative current-session page path is the `filePath` returned by Moss `app_build`.

The generated status page auto-refreshes every 5 seconds, so rebuilding the same app is enough for an already-open window to show new data. Do not open a separate page for a different knowledge base; update the existing page instead. Do not publish it or write directly to `~/.moss/generated-apps` unless the user explicitly asks to save it as a reusable app.

When data changes, run `refresh --kb <name>` for indexing, then rebuild the right-workspace status page using `render-html --all --stdout` + Moss `app_build`. If a recent search should be shown, pass `--search-results` with a JSON file produced by `search --out`. Do one HTML update after each user-requested data-changing action; do not enter a polling loop and do not call `app_preview` again for an already-open status page.

Live progress preview:

```bash
~/.moss/local-kb/env/bin/python /path/to/local-kb/scripts/kb.py ingest --kb project-docs --verbose --progress-html /path/in/current/workspace/local-kb-progress.html
```

After starting the command, use Moss `app_preview` on the `--progress-html` path only if that progress page is not already open. The file refreshes itself every few seconds and is rewritten by the ingest script, so the user can watch discovered/indexed/skipped/failed counts, current file, recent file events, and failure messages.

## Rules

- Do not use setup or check scripts as the primary environment repair path. Keep environment handling in the conversation: inspect the error, test imports or tools directly, then run the smallest appropriate `pip` or system package command.
- Do not assume `~/.moss/local-kb/env` exists. It is prepared external state, not part of the skill runtime.
- For status questions, run at most one read command first with the current Python: `overview`, `dashboard-data --kb`, `list`, `stats`, `docs`, or `paths`. Do not prepare the venv, ingest, or repair the environment for a status answer unless the user asks. Keep or update the HTML status page from that same read result.
- For create-only or register-only requests, run only `init` and/or `add-path` with the current Python, then update the HTML status page once through `render-html --all --stdout` + Moss `app_build`. For add/import/create-and-index requests, prepare the venv if needed, run `refresh` after path registration, rebuild the status page through Moss `app_build`, then summarize indexed/skipped/failed counts.
- Always provide `--name` for `init`. Use a short slug such as `project-docs`, `design-notes`, or `<repo>-docs` when the user gives documents but no explicit name.
- Do not enumerate a directory and call `add-path` once per file. Add the directory once, or pass explicit file paths together in a single `add-path` command.
- Use `kb.py scan` to inspect what the script will select. Do not use shell `find`, `ls`, or custom Python snippets as the primary scan path when `scan` parameters can express the task.
- Use `add-path --max-depth/--include/--exclude/--ext` for persistent corpus rules. Use `ingest --max-depth/--include/--exclude/--ext <paths...>` only for one-shot additions.
- Use `--verbose` only when debugging a failure, investigating a suspected hang, or when the user asks for progress details.
- Prefer `~/.moss/local-kb/env/bin/python -m pip install "unstructured[all-docs]" jieba markdown python-magic` for full document support.
- If `libmagic is unavailable`, `failed to find libmagic`, or `MagicException` appears, fix native `libmagic`; installing only `python-magic` is not enough on macOS/Linux.
- If `markdown missing` appears, install `markdown` and keep Markdown ingestion on `unstructured.partition.md.partition_md`; do not route `.md` through `partition.auto`.
- Use `refresh` as the default after adding/importing documents or folders, then rebuild the right-workspace status app with `render-html --all --stdout` + Moss `app_build`. Use `kb.py ingest` only when indexing is requested without a status page update.
- Use incremental ingestion by default. Use `--full` only when the user asks to rebuild.
- For search, start with default `--mode all`; use `--mode any` when the user's query is broad or exact all-term matching returns too little. Use `--context 1` or `--context 2` when the agent needs enough surrounding text to answer.
- Use preview mode before destructive cleanup. `delete-kb` and `remove-doc` require `--yes`; `prune` requires `--apply`.
- Use `doctor` for environment diagnosis before broad installation attempts.
- Use `export --kind dashboard|paths|docs|chunks` when the user asks to save, inspect, or pass KB state to another process.
- For Chinese search, both ingestion and query tokenization must use jieba.
- If PDF/OCR quality is poor or parsing fails, inspect whether `pdftotext`, `tesseract`, or `libreoffice` is missing. Install the needed system tool when appropriate; do not silently switch to a different parser.
- If a command fails, inspect the script output and make at most one targeted repair attempt for the concrete missing package, shared library, or executable. If the second attempt fails, stop and report the blocker instead of trying alternative installs or unrelated commands.
- `assets/kb-info-template.html` is a starting point for AI-generated knowledge base pages, not a fixed product UI. You may adjust the generated HTML layout, copy, colors, or sections based on the actual knowledge base and the user's request.
- Prefer one current-session preview: build the status page through Moss `app_build`, then use one initial `app_preview` by default for the knowledge base status page. For later updates, call `app_build` again with the same app name but do not call `app_preview` again, even when switching between knowledge bases, unless the user explicitly asks to reopen. Do not use a command that turns the page into a persistent standalone app unless the user explicitly requests persistence.
- For the generated info page, use `render-html` so displayed content comes from actual `dashboard-data`, `stats`, `docs`, and `paths` data.
- The user can ask to refresh the view at any time. Refresh by running one relevant command (`overview`, `stats`, `docs`, `search`, or `dashboard-data`) if needed, then rerun `render-html --all --stdout` and rebuild through Moss `app_build` once. Do not reopen the page.
- For scan/index progress, run `kb.py ingest --verbose` only when progress details are requested or a hang is suspected. After completion, summarize counts and regenerate HTML once.
- When using `--progress-html`, open the page with Moss `app_preview` only once. The page must include an auto-refresh tag and show failure details as they appear. It is a current-session artifact and can be regenerated or restyled through the conversation.

## Script Reference

- `scripts/kb.py`: manages knowledge bases, corpus paths, config, scan, ingestion, search, document listing, errors, cleanup, export, doctor checks, FTS rebuild, stats, and dashboard/HTML output.
- `assets/kb-info-template.html`: bundled static dashboard template. `render-html` replaces its JSON placeholders with current KB data.
