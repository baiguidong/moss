#!/usr/bin/env python3
import argparse
import fnmatch
import hashlib
import importlib.util
import json
import os
import platform
import re
import shutil
import sqlite3
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path


SUPPORTED_EXTS = {
    ".md",
    ".markdown",
    ".txt",
    ".rst",
    ".html",
    ".htm",
    ".csv",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".xml",
    ".docx",
    ".pdf",
    ".pptx",
    ".xlsx",
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".go",
    ".rs",
    ".java",
    ".c",
    ".cc",
    ".cpp",
    ".h",
    ".hpp",
    ".sh",
    ".css",
    ".scss",
}
DEFAULT_CONFIG = {
    "supported_exts": sorted(SUPPORTED_EXTS),
    "target_size": 600,
    "overlap": 100,
    "min_size": 200,
    "max_file_bytes": 100 * 1024 * 1024,
    "ignore_dirs": [".git", "node_modules", "dist", "build", ".venv", "venv", "env", "__pycache__", "coverage", ".next"],
}

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS corpus_paths (
  id INTEGER PRIMARY KEY,
  kb_id TEXT NOT NULL,
  path TEXT NOT NULL,
  recursive INTEGER NOT NULL DEFAULT 1,
  max_depth INTEGER,
  include_globs TEXT NOT NULL DEFAULT '[]',
  exclude_globs TEXT NOT NULL DEFAULT '[]',
  exts TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(kb_id, path),
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  kb_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  ext TEXT,
  file_size INTEGER,
  mtime REAL,
  file_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  indexed_at TEXT,
  UNIQUE(kb_id, path),
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  kb_id TEXT NOT NULL,
  doc_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  page_start INTEGER,
  page_end INTEGER,
  content TEXT NOT NULL,
  indexed_content TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doc_id, chunk_index),
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  indexed_content,
  content='chunks',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, indexed_content)
  VALUES (new.id, new.indexed_content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, indexed_content)
  VALUES('delete', old.id, old.indexed_content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, indexed_content)
  VALUES('delete', old.id, old.indexed_content);
  INSERT INTO chunks_fts(rowid, indexed_content)
  VALUES (new.id, new.indexed_content);
END;

CREATE INDEX IF NOT EXISTS idx_documents_kb_status ON documents(kb_id, status);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_index ON chunks(doc_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_kb ON chunks(kb_id);
"""


def kb_home() -> Path:
    return Path(os.environ.get("LOCAL_KB_HOME", "~/.moss/local-kb")).expanduser()


def db_path() -> Path:
    return kb_home() / "local-kb.db"


def template_path() -> Path:
    return Path(__file__).resolve().parents[1] / "assets" / "kb-info-template.html"


def connect() -> sqlite3.Connection:
    home = kb_home()
    home.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path())
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA_SQL)
    return con


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def output(data):
    print(json.dumps(data, ensure_ascii=False, indent=2))


def write_records(path_value: str, data):
    out = Path(path_value).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix.lower() == ".jsonl" and isinstance(data, list):
        out.write_text("\n".join(json.dumps(item, ensure_ascii=False) for item in data) + "\n", encoding="utf-8")
    else:
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(out.resolve())


def escape_html(value) -> str:
    return (
        str(value if value is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def write_progress_html(path_value: str, kb: sqlite3.Row, counts: dict, status: str, phase: str, current_file: str = "", message: str = "", events=None, errors=None):
    if not path_value:
        return
    events = list(events or [])[-12:]
    errors = list(errors or [])[-8:]
    out = Path(path_value).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    generated_at = now()
    cards = [
        ("发现", counts.get("discovered", 0)),
        ("已索引", counts.get("indexed", 0)),
        ("跳过", counts.get("skipped", 0)),
        ("失败", counts.get("failed", 0)),
    ]
    card_html = "\n".join(
        f'<div class="card"><div class="label">{escape_html(label)}</div><div class="value">{escape_html(value)}</div></div>'
        for label, value in cards
    )
    event_rows = "\n".join(
        "<tr>"
        f"<td>{escape_html(item.get('status', ''))}</td>"
        f"<td class=\"mono\">{escape_html(item.get('file', ''))}</td>"
        "</tr>"
        for item in events
    ) or '<tr><td colspan="2" class="muted">暂无文件事件</td></tr>'
    error_rows = "\n".join(
        "<tr>"
        f"<td class=\"mono\">{escape_html(item.get('file', ''))}</td>"
        f"<td class=\"error\">{escape_html(item.get('error', ''))}</td>"
        "</tr>"
        for item in errors
    ) or '<tr><td colspan="2" class="muted">暂无失败信息</td></tr>'
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="2">
  <title>Local KB Progress - {escape_html(kb['name'])}</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      background: #f6f7f9;
      color: #1f2933;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }}
    header {{
      background: #fff;
      border-bottom: 1px solid #d9dee7;
      padding: 18px 24px;
    }}
    main {{
      max-width: 1080px;
      margin: 0 auto;
      padding: 22px 24px 30px;
    }}
    h1 {{ margin: 0; font-size: 22px; line-height: 1.25; }}
    .sub {{ margin-top: 6px; color: #667085; font-size: 13px; }}
    .status {{
      display: inline-flex;
      margin-top: 14px;
      border: 1px solid #9bd4cd;
      background: #d9f3ef;
      color: #075e58;
      border-radius: 999px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 700;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin: 18px 0;
    }}
    .card, .panel {{
      background: #fff;
      border: 1px solid #d9dee7;
      border-radius: 8px;
    }}
    .card {{ padding: 16px; min-height: 96px; }}
    .label {{ color: #667085; font-size: 12px; margin-bottom: 8px; }}
    .value {{ font-size: 30px; font-weight: 760; line-height: 1; }}
    .panel {{ padding: 16px; margin-top: 14px; }}
    .mono {{
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      word-break: break-all;
      line-height: 1.65;
    }}
    .hint {{ color: #667085; font-size: 12px; margin-top: 10px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
    th, td {{ text-align: left; border-bottom: 1px solid #edf0f5; padding: 8px 6px; vertical-align: top; }}
    th {{ color: #667085; font-weight: 700; }}
    tr:last-child td {{ border-bottom: 0; }}
    .muted {{ color: #667085; }}
    .error {{ color: #b42318; }}
    @media (max-width: 760px) {{ .grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }} }}
  </style>
</head>
<body>
  <header>
    <h1>Local KB: {escape_html(kb['name'])}</h1>
    <div class="sub">实时索引进度，页面每 2 秒自动刷新</div>
    <div class="status">{escape_html(status)} / {escape_html(phase)}</div>
  </header>
  <main>
    <div class="grid">{card_html}</div>
    <div class="panel">
      <div class="label">当前文件</div>
      <div class="mono">{escape_html(current_file) or "--"}</div>
    </div>
    <div class="panel">
      <div class="label">消息</div>
      <div class="mono">{escape_html(message) or "--"}</div>
      <div class="hint">最后更新: {escape_html(generated_at)}</div>
    </div>
    <div class="panel">
      <div class="label">最近文件事件</div>
      <table>
        <thead><tr><th style="width:120px;">状态</th><th>文件</th></tr></thead>
        <tbody>{event_rows}</tbody>
      </table>
    </div>
    <div class="panel">
      <div class="label">失败信息</div>
      <table>
        <thead><tr><th>文件</th><th>错误</th></tr></thead>
        <tbody>{error_rows}</tbody>
      </table>
    </div>
  </main>
</body>
</html>
"""
    out.write_text(html, encoding="utf-8")


def script_json(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2).replace("</", "<\\/")


def render_html(data: dict, app_metadata: dict | None = None) -> str:
    template = template_path().read_text(encoding="utf-8")
    metadata = app_metadata or data.get("suggestedApp") or {"name": "local-kb", "title": "Local KB"}
    html = template.replace("__APP_METADATA_JSON__", script_json(metadata))
    html = html.replace(
        "const DATA = typeof __KB_DATA_JSON__ === 'undefined' ? FALLBACK_DATA : __KB_DATA_JSON__;",
        f"const DATA = {script_json(data)};",
    )
    html = html.replace("__KB_DATA_JSON__", script_json(data))
    return html


def require_deps():
    missing = []
    try:
        import jieba  # noqa: F401
    except Exception:
        missing.append("jieba")
    try:
        import unstructured  # noqa: F401
    except Exception:
        missing.append("unstructured")
    if missing:
        raise SystemExit(
            "Missing Python packages: "
            + ", ".join(missing)
            + '. Run: ~/.moss/local-kb/env/bin/python -m pip install "unstructured[all-docs]" jieba markdown python-magic'
        )


def kb_by_name_or_id(con: sqlite3.Connection, value: str) -> sqlite3.Row:
    row = con.execute(
        "SELECT * FROM knowledge_bases WHERE id = ? OR name = ?",
        (value, value),
    ).fetchone()
    if not row:
        raise SystemExit(f"Knowledge base not found: {value}")
    return row


def normalize_kb_name(value: str) -> str:
    name = str(value or "").strip()
    if not name:
        raise SystemExit("Knowledge base name is required. Use --name <name>.")
    return name


def load_config(kb: sqlite3.Row) -> dict:
    try:
        raw = json.loads(kb["config_json"] or "{}")
    except Exception:
        raw = {}
    return {**DEFAULT_CONFIG, **raw}


def parse_json_list(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    try:
        decoded = json.loads(value)
        if isinstance(decoded, list):
            return [str(item) for item in decoded if str(item)]
    except Exception:
        pass
    return []


def normalize_exts(values) -> list[str]:
    exts = []
    for value in values or []:
        for part in str(value).split(","):
            item = part.strip().lower()
            if not item:
                continue
            exts.append(item if item.startswith(".") else f".{item}")
    return sorted(set(exts))


def path_depth(root: Path, path: Path) -> int:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return 0
    return max(len(rel.parts) - 1, 0)


def matches_any(path: Path, root: Path, patterns: list[str]) -> bool:
    if not patterns:
        return False
    try:
        rel = path.relative_to(root).as_posix()
    except ValueError:
        rel = path.as_posix()
    return any(fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(path.name, pattern) for pattern in patterns)


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def to_index_text(text: str) -> str:
    import jieba

    return " ".join(tok.strip() for tok in jieba.cut(text or "") if tok.strip())


def query_terms(text: str) -> list[str]:
    import jieba

    terms = []
    for token in jieba.cut(text or ""):
        token = token.strip()
        if not token or re.fullmatch(r"[\W_]+", token, flags=re.UNICODE):
            continue
        terms.append(token)
    return terms


def quote_fts_term(term: str) -> str:
    return f'"{term.replace(chr(34), chr(34) + chr(34))}"'


def to_fts_query(text: str, mode: str = "all") -> str:
    terms = query_terms(text)
    if not terms:
        return ""
    if mode == "phrase":
        return quote_fts_term(" ".join(terms))
    quoted = [quote_fts_term(term) for term in terms]
    if mode == "any":
        return " OR ".join(quoted)
    return " ".join(quoted)


def normalize_text(text: str) -> str:
    lines = [line.rstrip() for line in str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    cleaned = []
    blank = False
    for line in lines:
        if not line.strip():
            if not blank:
                cleaned.append("")
            blank = True
            continue
        cleaned.append(line)
        blank = False
    return "\n".join(cleaned).strip()


def split_sentences(text: str, max_len: int) -> list[str]:
    parts = []
    start = 0
    breaks = set("\n。！？!?；;")
    for i, ch in enumerate(text):
        if ch in breaks and i + 1 - start >= max_len * 0.45:
            parts.append(text[start : i + 1].strip())
            start = i + 1
    tail = text[start:].strip()
    if tail:
        parts.append(tail)
    if not parts:
        return [text[i : i + max_len] for i in range(0, len(text), max_len)]
    return parts


def chunk_text(text: str, target_size: int, overlap: int, min_size: int) -> list[str]:
    text = normalize_text(text)
    if not text:
        return []
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks = []
    current = ""

    def push_current():
        nonlocal current
        c = current.strip()
        if c:
            chunks.append(c)
        current = ""

    for para in paragraphs:
        if len(para) > target_size:
            push_current()
            for part in split_sentences(para, target_size):
                if len(part) <= target_size:
                    chunks.append(part)
                else:
                    chunks.extend(part[i : i + target_size] for i in range(0, len(part), target_size))
            continue
        candidate = f"{current}\n\n{para}".strip() if current else para
        if len(candidate) <= target_size or len(current) < min_size:
            current = candidate
        else:
            push_current()
            prefix = chunks[-1][-overlap:] if overlap > 0 and chunks else ""
            current = f"{prefix}\n\n{para}".strip() if prefix else para
    push_current()
    return [c for c in chunks if c.strip()]


TEXT_EXTS = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".go",
    ".rs",
    ".java",
    ".c",
    ".cc",
    ".cpp",
    ".h",
    ".hpp",
    ".sh",
    ".css",
    ".scss",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".xml",
    ".csv",
    ".rst",
}


def parse_document(path: Path) -> tuple[str, list[dict]]:
    ext = path.suffix.lower()
    if ext == ".md":
        from unstructured.partition.md import partition_md

        elements = partition_md(filename=str(path))
    elif ext == ".txt" or ext in TEXT_EXTS:
        from unstructured.partition.text import partition_text

        elements = partition_text(filename=str(path))
    elif ext in {".html", ".htm"}:
        from unstructured.partition.html import partition_html

        elements = partition_html(filename=str(path))
    elif ext == ".docx":
        from unstructured.partition.docx import partition_docx

        elements = partition_docx(filename=str(path))
    elif ext == ".pptx":
        from unstructured.partition.pptx import partition_pptx

        elements = partition_pptx(filename=str(path))
    elif ext == ".xlsx":
        from unstructured.partition.xlsx import partition_xlsx

        elements = partition_xlsx(filename=str(path))
    elif ext == ".pdf":
        from unstructured.partition.pdf import partition_pdf

        elements = partition_pdf(filename=str(path))
    else:
        from unstructured.partition.auto import partition

        elements = partition(filename=str(path))

    blocks = []
    for element in elements:
        text = normalize_text(str(element))
        if not text:
            continue
        metadata = getattr(element, "metadata", None)
        page_number = getattr(metadata, "page_number", None) if metadata else None
        category = getattr(element, "category", None) or element.__class__.__name__
        blocks.append({"text": text, "page": page_number, "category": category})
    title = path.stem
    for block in blocks[:10]:
        if block["category"].lower() in {"title", "header"} and len(block["text"]) <= 120:
            title = block["text"]
            break
    return title, blocks


def iter_files(
    root: Path,
    config: dict,
    recursive: bool = True,
    max_depth: int | None = None,
    include_globs: list[str] | None = None,
    exclude_globs: list[str] | None = None,
    exts: list[str] | None = None,
):
    ignore_dirs = set(config.get("ignore_dirs") or [])
    supported_exts = set(normalize_exts(exts)) or {str(ext).lower() for ext in config.get("supported_exts") or SUPPORTED_EXTS}
    max_file_bytes = int(config.get("max_file_bytes") or 0)
    include_globs = include_globs or []
    exclude_globs = exclude_globs or []

    if root.is_file():
        candidates = [root]
    elif recursive:
        candidates = root.rglob("*")
    else:
        candidates = root.glob("*")

    for path in candidates:
        try:
            if any(part in ignore_dirs for part in path.parts):
                continue
            if not path.is_file():
                continue
            if max_depth is not None and root.is_dir() and path_depth(root, path) > max_depth:
                continue
            if path.name.startswith("."):
                continue
            if path.suffix.lower() not in supported_exts:
                continue
            if include_globs and not matches_any(path, root, include_globs):
                continue
            if matches_any(path, root, exclude_globs):
                continue
            stat = path.stat()
            if max_file_bytes and stat.st_size > max_file_bytes:
                continue
            yield path
        except OSError:
            continue


def add_paths(con: sqlite3.Connection, kb: sqlite3.Row, paths: list[str], recursive: bool, max_depth: int | None, include: list[str] | None, exclude: list[str] | None, ext: list[str] | None) -> dict:
    added = []
    include_globs = json.dumps(include or [], ensure_ascii=False)
    exclude_globs = json.dumps(exclude or [], ensure_ascii=False)
    exts = json.dumps(normalize_exts(ext), ensure_ascii=False)
    for raw in paths:
        path = str(Path(raw).expanduser().resolve())
        con.execute(
            """
            INSERT INTO corpus_paths
              (kb_id, path, recursive, max_depth, include_globs, exclude_globs, exts)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(kb_id, path) DO UPDATE SET
              recursive = excluded.recursive,
              max_depth = excluded.max_depth,
              include_globs = excluded.include_globs,
              exclude_globs = excluded.exclude_globs,
              exts = excluded.exts
            """,
            (kb["id"], path, 1 if recursive else 0, max_depth, include_globs, exclude_globs, exts),
        )
        added.append(path)
    return {
        "added": added,
        "recursive": recursive,
        "max_depth": max_depth,
        "include": include or [],
        "exclude": exclude or [],
        "ext": normalize_exts(ext),
    }


def command_init(args):
    con = connect()
    kb_id = str(uuid.uuid4())
    name = normalize_kb_name(args.name)
    config = {**DEFAULT_CONFIG}
    if args.config:
        config.update(json.loads(Path(args.config).read_text(encoding="utf-8")))
    con.execute(
        "INSERT INTO knowledge_bases (id, name, description, config_json) VALUES (?, ?, ?, ?)",
        (kb_id, name, args.description or "", json.dumps(config, ensure_ascii=False)),
    )
    row = kb_by_name_or_id(con, kb_id)
    path_result = None
    if args.path:
        path_result = add_paths(con, row, args.path, not args.no_recursive, args.max_depth, args.include, args.exclude, args.ext)
    con.commit()
    row = kb_by_name_or_id(con, kb_id)
    data = dict(row)
    if path_result:
        data["paths"] = path_result
    output(data)


def command_list(args):
    con = connect()
    rows = con.execute(
        """
        SELECT
          kb.*,
          (SELECT COUNT(*) FROM documents d WHERE d.kb_id = kb.id) AS document_count,
          (SELECT COUNT(*) FROM chunks c WHERE c.kb_id = kb.id) AS chunk_count,
          (SELECT COUNT(*) FROM documents d WHERE d.kb_id = kb.id AND d.status = 'error') AS error_count
        FROM knowledge_bases kb
        ORDER BY kb.updated_at DESC
        """
    ).fetchall()
    output([dict(row) for row in rows])


def command_rename_kb(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    new_name = normalize_kb_name(args.name)
    con.execute(
        "UPDATE knowledge_bases SET name = ?, updated_at = ? WHERE id = ?",
        (new_name, now(), kb["id"]),
    )
    con.commit()
    output({"id": kb["id"], "old_name": kb["name"], "name": new_name})


def command_delete_kb(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    counts = con.execute(
        """
        SELECT
          (SELECT COUNT(*) FROM corpus_paths WHERE kb_id = ?) AS paths,
          (SELECT COUNT(*) FROM documents WHERE kb_id = ?) AS documents,
          (SELECT COUNT(*) FROM chunks WHERE kb_id = ?) AS chunks
        """,
        (kb["id"], kb["id"], kb["id"]),
    ).fetchone()
    if args.yes:
        con.execute("DELETE FROM knowledge_bases WHERE id = ?", (kb["id"],))
        con.commit()
    output({"kb": kb["name"], "deleted": bool(args.yes), "requires_yes": not args.yes, **dict(counts)})


def command_config(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    config = load_config(kb)
    output({"kb": kb["name"], "config": config})


def command_update_config(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    config = load_config(kb)
    if args.config:
        config.update(json.loads(Path(args.config).read_text(encoding="utf-8")))
    if args.target_size is not None:
        config["target_size"] = args.target_size
    if args.overlap is not None:
        config["overlap"] = args.overlap
    if args.min_size is not None:
        config["min_size"] = args.min_size
    if args.max_file_bytes is not None:
        config["max_file_bytes"] = args.max_file_bytes
    if args.ext:
        config["supported_exts"] = normalize_exts(args.ext)
    if args.ignore_dir:
        config["ignore_dirs"] = sorted(set(str(item) for item in args.ignore_dir if item))
    con.execute(
        "UPDATE knowledge_bases SET description = COALESCE(?, description), config_json = ?, updated_at = ? WHERE id = ?",
        (args.description, json.dumps(config, ensure_ascii=False), now(), kb["id"]),
    )
    con.commit()
    output({"kb": kb["name"], "config": config})


def command_add_path(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    result = add_paths(con, kb, args.paths, not args.no_recursive, args.max_depth, args.include, args.exclude, args.ext)
    con.commit()
    output({"kb": kb["name"], **result})


def command_paths(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    rows = con.execute("SELECT * FROM corpus_paths WHERE kb_id = ? ORDER BY path", (kb["id"],)).fetchall()
    output([dict(row) for row in rows])


def command_remove_path(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    removed = []
    for raw in args.paths:
        path = str(Path(raw).expanduser().resolve())
        cur = con.execute("DELETE FROM corpus_paths WHERE kb_id = ? AND path = ?", (kb["id"], path))
        removed.append({"path": path, "removed": cur.rowcount})
    con.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (now(), kb["id"]))
    con.commit()
    output({"kb": kb["name"], "removed": removed})


def scan_sources(config: dict, source_rows) -> tuple[list[dict], dict]:
    files = []
    skipped_roots = []
    total_bytes = 0
    seen = set()
    for row in source_rows:
        root = Path(row["path"]).expanduser()
        if not root.exists():
            skipped_roots.append({"path": str(root), "reason": "not_found"})
            continue
        for path in iter_files(
            root,
            config,
            bool(row.get("recursive", 1)),
            row.get("max_depth"),
            parse_json_list(row.get("include_globs")),
            parse_json_list(row.get("exclude_globs")),
            parse_json_list(row.get("exts")),
        ):
            resolved = str(path.resolve())
            if resolved in seen:
                continue
            seen.add(resolved)
            stat = path.stat()
            total_bytes += stat.st_size
            files.append(
                {
                    "path": resolved,
                    "ext": path.suffix.lower(),
                    "file_size": stat.st_size,
                    "mtime": stat.st_mtime,
                }
            )
    summary = {
        "file_count": len(files),
        "total_bytes": total_bytes,
        "skipped_roots": skipped_roots,
    }
    return files, summary


def source_row(path: str, recursive: bool, max_depth: int | None, include: list[str], exclude: list[str], exts: list[str]) -> dict:
    return {
        "path": str(Path(path).expanduser()),
        "recursive": 1 if recursive else 0,
        "max_depth": max_depth,
        "include_globs": json.dumps(include or [], ensure_ascii=False),
        "exclude_globs": json.dumps(exclude or [], ensure_ascii=False),
        "exts": json.dumps(normalize_exts(exts), ensure_ascii=False),
    }


def command_scan(args):
    con = connect()
    if args.kb:
        kb = kb_by_name_or_id(con, args.kb)
        config = load_config(kb)
        rows = [dict(row) for row in con.execute("SELECT * FROM corpus_paths WHERE kb_id = ?", (kb["id"],)).fetchall()]
    else:
        kb = None
        config = DEFAULT_CONFIG
        rows = []
    for path in args.paths or []:
        rows.append(source_row(path, not args.no_recursive, args.max_depth, args.include or [], args.exclude or [], args.ext or []))
    if not rows:
        raise SystemExit("No scan sources. Pass --kb with saved paths or provide paths.")
    files, summary = scan_sources(config, rows)
    output(
        {
            "kb": kb["name"] if kb else None,
            **summary,
            "files": [] if args.summary else files[: args.limit],
            "truncated": False if args.summary else len(files) > args.limit,
        }
    )


def upsert_document(con, kb_id, path: Path, stat, digest: str):
    existing = con.execute("SELECT * FROM documents WHERE kb_id = ? AND path = ?", (kb_id, str(path))).fetchone()
    if existing:
        con.execute(
            "UPDATE documents SET file_size = ?, mtime = ?, file_hash = ?, updated_at = ? WHERE id = ?",
            (stat.st_size, stat.st_mtime, digest, now(), existing["id"]),
        )
        return existing["id"], existing
    cur = con.execute(
        "INSERT INTO documents (kb_id, path, title, ext, file_size, mtime, file_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
        (kb_id, str(path), path.stem, path.suffix.lower(), stat.st_size, stat.st_mtime, digest),
    )
    return cur.lastrowid, None


def ingest_one(con, kb: sqlite3.Row, path: Path, full: bool) -> tuple[str, str]:
    config = load_config(kb)
    stat = path.stat()
    existing = con.execute("SELECT * FROM documents WHERE kb_id = ? AND path = ?", (kb["id"], str(path))).fetchone()
    if existing and not full and existing["mtime"] == stat.st_mtime and existing["file_size"] == stat.st_size and existing["status"] == "active":
        return "skipped", ""
    digest = file_hash(path)
    if existing and not full and existing["file_hash"] == digest and existing["status"] == "active":
        return "skipped", ""

    doc_id, _ = upsert_document(con, kb["id"], path, stat, digest)
    try:
        title, blocks = parse_document(path)
        combined = "\n\n".join(block["text"] for block in blocks)
        chunks = chunk_text(
            combined,
            int(config.get("target_size", 600)),
            int(config.get("overlap", 100)),
            int(config.get("min_size", 200)),
        )
        con.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        for index, content in enumerate(chunks):
            indexed = to_index_text(f"{title}\n{content}")
            con.execute(
                """
                INSERT INTO chunks
                  (kb_id, doc_id, chunk_index, heading, content, indexed_content, char_count, token_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (kb["id"], doc_id, index, title, content, indexed, len(content), len(indexed.split())),
            )
        con.execute(
            "UPDATE documents SET title = ?, status = 'active', error = '', indexed_at = ?, updated_at = ? WHERE id = ?",
            (title, now(), now(), doc_id),
        )
        return "indexed", ""
    except Exception as exc:
        error = str(exc)
        con.execute(
            "UPDATE documents SET status = 'error', error = ?, updated_at = ? WHERE id = ?",
            (error, now(), doc_id),
        )
        return "failed", error


def pending_status(con: sqlite3.Connection, kb: sqlite3.Row, path: Path, full: bool) -> str:
    stat = path.stat()
    existing = con.execute("SELECT * FROM documents WHERE kb_id = ? AND path = ?", (kb["id"], str(path))).fetchone()
    if not existing:
        return "pending"
    if full:
        return "would_index"
    if existing["mtime"] == stat.st_mtime and existing["file_size"] == stat.st_size and existing["status"] == "active":
        return "would_skip"
    digest = file_hash(path)
    if existing["file_hash"] == digest and existing["status"] == "active":
        return "would_skip"
    return "would_index"


def ingest_sources(con: sqlite3.Connection, kb: sqlite3.Row, args) -> dict:
    config = load_config(kb)
    paths = [dict(row) for row in con.execute("SELECT * FROM corpus_paths WHERE kb_id = ?", (kb["id"],)).fetchall()]
    for path in args.paths or []:
        paths.append(source_row(path, not args.no_recursive, args.max_depth, args.include or [], args.exclude or [], args.ext or []))
    counts = {"discovered": 0, "indexed": 0, "skipped": 0, "failed": 0, "pending": 0, "would_index": 0, "would_skip": 0}
    recent_events = []
    recent_errors = []
    write_progress_html(args.progress_html, kb, counts, "running", "start", message="准备扫描语料路径", events=recent_events, errors=recent_errors)
    stopped_by_limit = False
    for row in paths:
        root = Path(row["path"]).expanduser()
        for path in iter_files(
            root,
            config,
            bool(row.get("recursive", 1)),
            row.get("max_depth"),
            parse_json_list(row.get("include_globs")),
                parse_json_list(row.get("exclude_globs")),
                parse_json_list(row.get("exts")),
        ):
            if args.limit is not None and counts["discovered"] >= args.limit:
                stopped_by_limit = True
                break
            counts["discovered"] += 1
            write_progress_html(args.progress_html, kb, counts, "running", "parse-index", current_file=str(path), message="正在解析并写入 FTS5", events=recent_events, errors=recent_errors)
            if args.verbose:
                print(json.dumps({"type": "progress", "phase": "parse-index", "file": str(path), **counts}, ensure_ascii=False), flush=True)
            if args.dry_run:
                status, error = pending_status(con, kb, path, args.full), ""
            else:
                status, error = ingest_one(con, kb, path, args.full)
            counts[status] = counts.get(status, 0) + 1
            recent_events.append({"file": str(path), "status": status})
            if error:
                recent_errors.append({"file": str(path), "error": error})
            if args.verbose:
                print(json.dumps({"type": "file", "file": str(path), "status": status, "error": error, **counts}, ensure_ascii=False), flush=True)
            if not args.dry_run:
                con.commit()
            message = f"文件完成: {status}" + (f" / {error}" if error else "")
            write_progress_html(args.progress_html, kb, counts, "running", "parse-index", current_file=str(path), message=message, events=recent_events, errors=recent_errors)
        if stopped_by_limit:
            break
    if not args.dry_run:
        con.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (now(), kb["id"]))
        con.commit()
    write_progress_html(args.progress_html, kb, counts, "completed", "done", message="索引任务完成", events=recent_events, errors=recent_errors)
    return {"kb": kb["name"], **counts, "dry_run": args.dry_run, "limit": args.limit, "stopped_by_limit": stopped_by_limit}


def command_ingest(args):
    require_deps()
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    output(ingest_sources(con, kb, args))


def command_search(args):
    require_deps()
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    tokenized = to_index_text(args.query)
    fts_query = to_fts_query(args.query, args.mode)
    if not fts_query:
        data = {"kb": kb["name"], "query": args.query, "mode": args.mode, "tokenized_query": tokenized, "fts_query": fts_query, "fallback": False, "results": []}
        if args.out:
            data["out"] = write_records(args.out, data)
        output(data)
        return
    clauses = ["c.kb_id = ?", "chunks_fts MATCH ?"]
    params = [kb["id"], fts_query]
    if args.ext:
        exts = normalize_exts(args.ext)
        clauses.append(f"d.ext IN ({','.join('?' for _ in exts)})")
        params.extend(exts)
    if args.path:
        clauses.append("d.path LIKE ?")
        params.append(f"%{args.path}%")
    sql = f"""
        SELECT
          c.id AS chunk_id,
          c.doc_id AS document_id,
          c.chunk_index,
          d.title,
          d.path,
          d.ext,
          c.heading,
          c.content,
          bm25(chunks_fts) AS score
        FROM chunks_fts
        JOIN chunks c ON c.id = chunks_fts.rowid
        JOIN documents d ON d.id = c.doc_id
        WHERE {' AND '.join(clauses)}
        ORDER BY score
        LIMIT ?
        """
    params.append(args.limit)
    rows = con.execute(sql, params).fetchall()
    fallback = False
    if not rows and not args.no_fallback:
        like_clauses = ["c.kb_id = ?", "c.content LIKE ?"]
        like_params = [kb["id"], f"%{args.query}%"]
        if args.ext:
            exts = normalize_exts(args.ext)
            like_clauses.append(f"d.ext IN ({','.join('?' for _ in exts)})")
            like_params.extend(exts)
        if args.path:
            like_clauses.append("d.path LIKE ?")
            like_params.append(f"%{args.path}%")
        like_params.append(args.limit)
        rows = con.execute(
            f"""
            SELECT
              c.id AS chunk_id,
              c.doc_id AS document_id,
              c.chunk_index,
              d.title,
              d.path,
              d.ext,
              c.heading,
              c.content,
              0.0 AS score
            FROM chunks c
            JOIN documents d ON d.id = c.doc_id
            WHERE {' AND '.join(like_clauses)}
            ORDER BY d.updated_at DESC, c.chunk_index
            LIMIT ?
            """,
            like_params,
        ).fetchall()
        fallback = True
    results = []
    for row in rows:
        item = dict(row)
        snippet = item["content"].replace("\n", " ")
        item["snippet"] = snippet[:360] + ("..." if len(snippet) > 360 else "")
        if args.context > 0:
            before = con.execute(
                """
                SELECT chunk_index, heading, content
                FROM chunks
                WHERE doc_id = ? AND chunk_index >= ? AND chunk_index < ?
                ORDER BY chunk_index
                """,
                (item["document_id"], max(0, item["chunk_index"] - args.context), item["chunk_index"]),
            ).fetchall()
            after = con.execute(
                """
                SELECT chunk_index, heading, content
                FROM chunks
                WHERE doc_id = ? AND chunk_index > ? AND chunk_index <= ?
                ORDER BY chunk_index
                """,
                (item["document_id"], item["chunk_index"], item["chunk_index"] + args.context),
            ).fetchall()
            item["context_before"] = [dict(chunk) for chunk in before]
            item["context_after"] = [dict(chunk) for chunk in after]
        results.append(item)
    data = {"kb": kb["name"], "query": args.query, "mode": args.mode, "tokenized_query": tokenized, "fts_query": fts_query, "fallback": fallback, "results": results}
    if args.out:
        data["out"] = write_records(args.out, data)
    output(data)


def command_stats(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    stats = con.execute(
        """
        SELECT
          COUNT(DISTINCT d.id) AS documents,
          COUNT(c.id) AS chunks,
          COALESCE(SUM(CASE WHEN d.status = 'error' THEN 1 ELSE 0 END), 0) AS errors
        FROM documents d
        LEFT JOIN chunks c ON c.doc_id = d.id
        WHERE d.kb_id = ?
        """,
        (kb["id"],),
    ).fetchone()
    by_ext = con.execute(
        "SELECT ext, COUNT(*) AS count FROM documents WHERE kb_id = ? GROUP BY ext ORDER BY count DESC",
        (kb["id"],),
    ).fetchall()
    output({"kb": kb["name"], **dict(stats), "by_ext": [dict(row) for row in by_ext]})


def command_docs(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    clauses = ["kb_id = ?"]
    params = [kb["id"]]
    if args.status:
        clauses.append("status = ?")
        params.append(args.status)
    if args.ext:
        exts = normalize_exts(args.ext)
        clauses.append(f"ext IN ({','.join('?' for _ in exts)})")
        params.extend(exts)
    if args.path:
        clauses.append("path LIKE ?")
        params.append(f"%{args.path}%")
    params.append(args.limit)
    rows = con.execute(
        f"SELECT id, title, path, ext, file_size, status, error, indexed_at FROM documents WHERE {' AND '.join(clauses)} ORDER BY updated_at DESC LIMIT ?",
        params,
    ).fetchall()
    output([dict(row) for row in rows])


def command_errors(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    rows = con.execute(
        """
        SELECT id, title, path, ext, file_size, error, updated_at
        FROM documents
        WHERE kb_id = ? AND status = 'error'
        ORDER BY updated_at DESC
        LIMIT ?
        """,
        (kb["id"], args.limit),
    ).fetchall()
    output([dict(row) for row in rows])


def command_remove_doc(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    removed = []
    for raw in args.paths:
        path = str(Path(raw).expanduser().resolve())
        count = con.execute("SELECT COUNT(*) AS count FROM documents WHERE kb_id = ? AND path = ?", (kb["id"], path)).fetchone()["count"]
        if args.yes:
            cur = con.execute("DELETE FROM documents WHERE kb_id = ? AND path = ?", (kb["id"], path))
            count = cur.rowcount
        removed.append({"path": path, "matched": count, "removed": count if args.yes else 0})
    if args.yes:
        con.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (now(), kb["id"]))
        con.commit()
    output({"kb": kb["name"], "applied": bool(args.yes), "requires_yes": not args.yes, "removed": removed})


def command_prune(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    rows = con.execute("SELECT id, path FROM documents WHERE kb_id = ?", (kb["id"],)).fetchall()
    missing = [row for row in rows if not Path(row["path"]).exists()]
    if args.apply:
        for row in missing:
            con.execute("DELETE FROM documents WHERE id = ?", (row["id"],))
        con.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (now(), kb["id"]))
        con.commit()
    output({"kb": kb["name"], "missing": len(missing), "deleted": len(missing) if args.apply else 0, "applied": bool(args.apply), "paths": [row["path"] for row in missing]})


def command_rebuild_fts(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    con.execute("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')")
    count = con.execute("SELECT COUNT(*) AS count FROM chunks WHERE kb_id = ?", (kb["id"],)).fetchone()["count"]
    con.commit()
    output({"kb": kb["name"], "rebuilt_chunks": count, "scope": "all_fts_rows"})


def collect_dashboard_data(con: sqlite3.Connection, kb: sqlite3.Row, docs_limit: int = 12) -> dict:
    stats = con.execute(
        """
        SELECT
          COUNT(DISTINCT d.id) AS documents,
          COUNT(c.id) AS chunks,
          COALESCE(SUM(CASE WHEN d.status = 'error' THEN 1 ELSE 0 END), 0) AS errors
        FROM documents d
        LEFT JOIN chunks c ON c.doc_id = d.id
        WHERE d.kb_id = ?
        """,
        (kb["id"],),
    ).fetchone()
    by_ext = con.execute(
        "SELECT ext, COUNT(*) AS count FROM documents WHERE kb_id = ? GROUP BY ext ORDER BY count DESC",
        (kb["id"],),
    ).fetchall()
    paths = con.execute(
        "SELECT path, recursive, max_depth, include_globs, exclude_globs, exts FROM corpus_paths WHERE kb_id = ? ORDER BY path",
        (kb["id"],),
    ).fetchall()
    docs = con.execute(
        "SELECT title, path, ext, status, error, indexed_at FROM documents WHERE kb_id = ? ORDER BY updated_at DESC LIMIT ?",
        (kb["id"], docs_limit),
    ).fetchall()
    generated_at = now()
    return {
        "kb": {key: kb[key] for key in kb.keys()},
        "stats": dict(stats),
        "byExt": [dict(row) for row in by_ext],
        "paths": [dict(row) for row in paths],
        "recentDocs": [dict(row) for row in docs],
        "dbPath": str(db_path()),
        "generatedAt": generated_at,
        "updatedShort": generated_at[5:10],
    }


def command_dashboard_data(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    data = collect_dashboard_data(con, kb)
    data["templatePath"] = str(template_path())
    data["suggestedApp"] = {
        "name": f"local-kb-{kb['name']}",
        "title": f"Local KB - {kb['name']}",
        "description": f"Local knowledge base dashboard for {kb['name']}",
        "width": 1100,
        "height": 760,
        "resizable": True,
    }
    output(data)


def command_render_html(args):
    if not args.all and not args.kb:
        raise SystemExit("render-html requires --kb <name> or --all.")
    con = connect()
    if args.all:
        rows = con.execute("SELECT * FROM knowledge_bases ORDER BY updated_at DESC").fetchall()
        knowledge_bases = [collect_dashboard_data(con, kb, args.docs_limit) for kb in rows]
        data = {
            "dbPath": str(db_path()),
            "templatePath": str(template_path()),
            "generatedAt": now(),
            "knowledgeBases": knowledge_bases,
            "summary": {
                "knowledgeBaseCount": len(knowledge_bases),
                "documentCount": sum(int(item["stats"].get("documents") or 0) for item in knowledge_bases),
                "chunkCount": sum(int(item["stats"].get("chunks") or 0) for item in knowledge_bases),
                "errorCount": sum(int(item["stats"].get("errors") or 0) for item in knowledge_bases),
            },
            "suggestedApp": {
                "name": "local-kb-overview",
                "title": "Local KB Overview",
                "description": "Overview dashboard for local knowledge bases",
                "width": 1180,
                "height": 780,
                "resizable": True,
            },
        }
    else:
        kb = kb_by_name_or_id(con, args.kb)
        data = collect_dashboard_data(con, kb, args.docs_limit)
        data["templatePath"] = str(template_path())
        data["agentContent"] = {
            "summary": args.summary
            or f"{kb['name']} 当前包含 {data['stats'].get('documents') or 0} 个文档、{data['stats'].get('chunks') or 0} 个检索片段。",
            "sections": [
                {
                    "title": "当前状态",
                    "items": [
                        f"语料路径: {len(data['paths'])}",
                        f"解析错误: {data['stats'].get('errors') or 0}",
                        f"数据库: {db_path()}",
                    ],
                }
            ],
        }
        data["suggestedApp"] = {
            "name": f"local-kb-{kb['name']}",
            "title": f"Local KB - {kb['name']}",
            "description": f"Local knowledge base dashboard for {kb['name']}",
            "width": 1100,
            "height": 760,
            "resizable": True,
        }
    if args.search_results:
        data["recentSearch"] = json.loads(Path(args.search_results).expanduser().read_text(encoding="utf-8"))
    html = render_html(data)
    if args.stdout:
        print(html)
        return
    if not args.out:
        raise SystemExit("render-html requires --out <path> unless --stdout is used.")
    out = Path(args.out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    output({"kb": "all" if args.all else data["kb"]["name"], "html": str(out.resolve()), "generatedAt": data["generatedAt"]})


def command_refresh(args):
    require_deps()
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    ingest_result = ingest_sources(con, kb, args)
    html_result = None
    if args.out:
        if args.all:
            rows = con.execute("SELECT * FROM knowledge_bases ORDER BY updated_at DESC").fetchall()
            knowledge_bases = [collect_dashboard_data(con, row, args.docs_limit) for row in rows]
            data = {
                "dbPath": str(db_path()),
                "templatePath": str(template_path()),
                "generatedAt": now(),
                "knowledgeBases": knowledge_bases,
                "summary": {
                    "knowledgeBaseCount": len(knowledge_bases),
                    "documentCount": sum(int(item["stats"].get("documents") or 0) for item in knowledge_bases),
                    "chunkCount": sum(int(item["stats"].get("chunks") or 0) for item in knowledge_bases),
                    "errorCount": sum(int(item["stats"].get("errors") or 0) for item in knowledge_bases),
                },
                "suggestedApp": {
                    "name": "local-kb-overview",
                    "title": "Local KB Overview",
                    "description": "Overview dashboard for local knowledge bases",
                    "width": 1180,
                    "height": 780,
                    "resizable": True,
                },
            }
        else:
            kb = kb_by_name_or_id(con, args.kb)
            data = collect_dashboard_data(con, kb, args.docs_limit)
            data["templatePath"] = str(template_path())
            data["agentContent"] = {
                "summary": f"{kb['name']} 当前包含 {data['stats'].get('documents') or 0} 个文档、{data['stats'].get('chunks') or 0} 个检索片段。最近刷新 indexed={ingest_result.get('indexed', 0)} skipped={ingest_result.get('skipped', 0)} failed={ingest_result.get('failed', 0)}。",
                "sections": [
                    {
                        "title": "刷新结果",
                        "items": [
                            f"发现: {ingest_result.get('discovered', 0)}",
                            f"索引: {ingest_result.get('indexed', 0)}",
                            f"跳过: {ingest_result.get('skipped', 0)}",
                            f"失败: {ingest_result.get('failed', 0)}",
                        ],
                    }
                ],
            }
            data["suggestedApp"] = {
                "name": f"local-kb-{kb['name']}",
                "title": f"Local KB - {kb['name']}",
                "description": f"Local knowledge base dashboard for {kb['name']}",
                "width": 1100,
                "height": 760,
                "resizable": True,
            }
        if args.search_results:
            data["recentSearch"] = json.loads(Path(args.search_results).expanduser().read_text(encoding="utf-8"))
        out = Path(args.out).expanduser()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render_html(data), encoding="utf-8")
        html_result = {"html": str(out.resolve()), "generatedAt": data["generatedAt"]}
    output({"kb": kb["name"], "ingest": ingest_result, "html": html_result})


def command_export(args):
    con = connect()
    kb = kb_by_name_or_id(con, args.kb)
    if args.kind == "dashboard":
        data = collect_dashboard_data(con, kb, args.limit)
    elif args.kind == "paths":
        data = [dict(row) for row in con.execute("SELECT * FROM corpus_paths WHERE kb_id = ? ORDER BY path", (kb["id"],)).fetchall()]
    elif args.kind == "docs":
        data = [
            dict(row)
            for row in con.execute(
                "SELECT id, title, path, ext, file_size, status, error, indexed_at FROM documents WHERE kb_id = ? ORDER BY updated_at DESC LIMIT ?",
                (kb["id"], args.limit),
            ).fetchall()
        ]
    elif args.kind == "chunks":
        data = [
            dict(row)
            for row in con.execute(
                """
                SELECT c.id, c.doc_id, d.title, d.path, c.chunk_index, c.heading, c.content, c.char_count, c.token_count
                FROM chunks c
                JOIN documents d ON d.id = c.doc_id
                WHERE c.kb_id = ?
                ORDER BY d.path, c.chunk_index
                LIMIT ?
                """,
                (kb["id"], args.limit),
            ).fetchall()
        ]
    else:
        raise SystemExit(f"Unknown export kind: {args.kind}")
    if args.out:
        output({"kb": kb["name"], "kind": args.kind, "out": write_records(args.out, data)})
    else:
        output(data)


def probe_import(name: str) -> dict:
    spec = importlib.util.find_spec(name)
    return {"name": name, "available": spec is not None, "origin": getattr(spec, "origin", None) if spec else None}


def command_doctor(args):
    checks = {
        "python": {
            "executable": sys.executable,
            "version": sys.version.split()[0],
            "platform": platform.platform(),
        },
        "sqlite": {
            "version": sqlite3.sqlite_version,
            "fts5": False,
        },
        "packages": [probe_import(name) for name in ["jieba", "unstructured", "markdown", "magic"]],
        "tools": {name: shutil.which(name) for name in ["pdftotext", "tesseract", "libreoffice", "soffice", "file"]},
        "home": str(kb_home()),
        "dbPath": str(db_path()),
    }
    try:
        con = sqlite3.connect(":memory:")
        con.execute("CREATE VIRTUAL TABLE t USING fts5(x)")
        checks["sqlite"]["fts5"] = True
    except Exception as exc:
        checks["sqlite"]["fts5_error"] = str(exc)
    if args.kb:
        con = connect()
        kb = kb_by_name_or_id(con, args.kb)
        checks["kb"] = collect_dashboard_data(con, kb, args.docs_limit)
    output(checks)


def command_overview(args):
    con = connect()
    rows = con.execute("SELECT * FROM knowledge_bases ORDER BY updated_at DESC").fetchall()
    knowledge_bases = []
    for kb in rows:
        knowledge_bases.append(collect_dashboard_data(con, kb, args.docs_limit))
    output(
        {
            "dbPath": str(db_path()),
            "templatePath": str(template_path()),
            "generatedAt": now(),
            "knowledgeBases": knowledge_bases,
            "summary": {
                "knowledgeBaseCount": len(knowledge_bases),
                "documentCount": sum(int(item["stats"].get("documents") or 0) for item in knowledge_bases),
                "chunkCount": sum(int(item["stats"].get("chunks") or 0) for item in knowledge_bases),
                "errorCount": sum(int(item["stats"].get("errors") or 0) for item in knowledge_bases),
            },
            "suggestedApp": {
                "name": "local-kb-overview",
                "title": "Local KB Overview",
                "description": "Overview dashboard for local knowledge bases",
                "width": 1180,
                "height": 780,
                "resizable": True,
            },
        }
    )


def main():
    parser = argparse.ArgumentParser(description="Local knowledge base manager.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="Create a knowledge base.")
    p.add_argument("--name", required=True, help="Knowledge base name. Required.")
    p.add_argument("--description", default="")
    p.add_argument("--config")
    p.add_argument("--path", action="append", help="Optional corpus path to add during creation. Repeatable.")
    p.add_argument("--no-recursive", action="store_true", help="Only applies to paths passed during creation.")
    p.add_argument("--max-depth", type=int, help="Maximum directory depth for paths passed during creation.")
    p.add_argument("--include", action="append", help="Include glob for paths passed during creation. Repeatable.")
    p.add_argument("--exclude", action="append", help="Exclude glob for paths passed during creation. Repeatable.")
    p.add_argument("--ext", action="append", help="Allowed extension for paths passed during creation. Repeatable or comma-separated.")
    p.set_defaults(func=command_init)

    p = sub.add_parser("list", help="List knowledge bases.")
    p.set_defaults(func=command_list)

    p = sub.add_parser("rename-kb", help="Rename a knowledge base.")
    p.add_argument("--kb", required=True)
    p.add_argument("--name", required=True, help="New knowledge base name. Required.")
    p.set_defaults(func=command_rename_kb)

    p = sub.add_parser("delete-kb", help="Delete a knowledge base and its indexed data.")
    p.add_argument("--kb", required=True)
    p.add_argument("--yes", action="store_true", help="Actually delete. Without this flag, only prints what would be deleted.")
    p.set_defaults(func=command_delete_kb)

    p = sub.add_parser("config", help="Show knowledge base config.")
    p.add_argument("--kb", required=True)
    p.set_defaults(func=command_config)

    p = sub.add_parser("update-config", help="Update knowledge base config.")
    p.add_argument("--kb", required=True)
    p.add_argument("--description")
    p.add_argument("--config", help="JSON file whose keys override current config.")
    p.add_argument("--target-size", type=int)
    p.add_argument("--overlap", type=int)
    p.add_argument("--min-size", type=int)
    p.add_argument("--max-file-bytes", type=int)
    p.add_argument("--ext", action="append", help="Supported extension. Repeatable or comma-separated.")
    p.add_argument("--ignore-dir", action="append", help="Directory name to ignore. Repeatable.")
    p.set_defaults(func=command_update_config)

    p = sub.add_parser("add-path", help="Add corpus paths.")
    p.add_argument("--kb", required=True)
    p.add_argument("--no-recursive", action="store_true")
    p.add_argument("--max-depth", type=int, help="Maximum directory depth below each root. 0 means only files directly in the root.")
    p.add_argument("--include", action="append", help="Include glob relative to each root. Repeatable, for example '**/*.md'.")
    p.add_argument("--exclude", action="append", help="Exclude glob relative to each root. Repeatable, for example '**/drafts/**'.")
    p.add_argument("--ext", action="append", help="Allowed extension. Repeatable or comma-separated, for example md,pdf.")
    p.add_argument("paths", nargs="+")
    p.set_defaults(func=command_add_path)

    p = sub.add_parser("paths", help="List corpus paths.")
    p.add_argument("--kb", required=True)
    p.set_defaults(func=command_paths)

    p = sub.add_parser("remove-path", help="Remove corpus paths.")
    p.add_argument("--kb", required=True)
    p.add_argument("paths", nargs="+")
    p.set_defaults(func=command_remove_path)

    p = sub.add_parser("scan", help="Preview files selected by saved paths or explicit paths.")
    p.add_argument("--kb", help="Knowledge base whose saved corpus paths should be scanned.")
    p.add_argument("--no-recursive", action="store_true")
    p.add_argument("--max-depth", type=int, help="Maximum directory depth below each explicit root.")
    p.add_argument("--include", action="append", help="Include glob for explicit paths. Repeatable.")
    p.add_argument("--exclude", action="append", help="Exclude glob for explicit paths. Repeatable.")
    p.add_argument("--ext", action="append", help="Allowed extension for explicit paths. Repeatable or comma-separated.")
    p.add_argument("--limit", type=int, default=200)
    p.add_argument("--summary", action="store_true", help="Only print counts and skipped roots.")
    p.add_argument("paths", nargs="*")
    p.set_defaults(func=command_scan)

    p = sub.add_parser("ingest", help="Ingest changed documents.")
    p.add_argument("--kb", required=True)
    p.add_argument("--full", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="Scan and classify files without parsing or writing the index.")
    p.add_argument("--limit", type=int, help="Stop after discovering this many files.")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--progress-html", help="Write an auto-refreshing current-session HTML progress page.")
    p.add_argument("--no-recursive", action="store_true", help="Only applies to explicit paths passed to this command.")
    p.add_argument("--max-depth", type=int, help="Maximum directory depth for explicit paths passed to this command.")
    p.add_argument("--include", action="append", help="Include glob for explicit paths. Repeatable.")
    p.add_argument("--exclude", action="append", help="Exclude glob for explicit paths. Repeatable.")
    p.add_argument("--ext", action="append", help="Allowed extension for explicit paths. Repeatable or comma-separated.")
    p.add_argument("paths", nargs="*", help="Optional one-shot files or directories to ingest in addition to saved corpus paths.")
    p.set_defaults(func=command_ingest)

    p = sub.add_parser("search", help="Search indexed chunks.")
    p.add_argument("--kb", required=True)
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--mode", choices=["all", "any", "phrase"], default="all", help="How query terms are matched.")
    p.add_argument("--context", type=int, default=0, help="Include N chunks before and after each hit.")
    p.add_argument("--ext", action="append", help="Filter by extension. Repeatable or comma-separated.")
    p.add_argument("--path", help="Filter documents whose path contains this text.")
    p.add_argument("--no-fallback", action="store_true", help="Disable LIKE fallback when FTS returns no results.")
    p.add_argument("--out", help="Write the full search result JSON to this file.")
    p.add_argument("query")
    p.set_defaults(func=command_search)

    p = sub.add_parser("stats", help="Show knowledge base stats.")
    p.add_argument("--kb", required=True)
    p.set_defaults(func=command_stats)

    p = sub.add_parser("docs", help="List indexed documents.")
    p.add_argument("--kb", required=True)
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--status", choices=["active", "pending", "error"])
    p.add_argument("--ext", action="append", help="Filter by extension. Repeatable or comma-separated.")
    p.add_argument("--path", help="Filter documents whose path contains this text.")
    p.set_defaults(func=command_docs)

    p = sub.add_parser("errors", help="List documents that failed parsing.")
    p.add_argument("--kb", required=True)
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=command_errors)

    p = sub.add_parser("remove-doc", help="Remove indexed documents by path.")
    p.add_argument("--kb", required=True)
    p.add_argument("--yes", action="store_true", help="Actually remove. Without this flag, only prints matches.")
    p.add_argument("paths", nargs="+")
    p.set_defaults(func=command_remove_doc)

    p = sub.add_parser("prune", help="Remove indexed documents whose source files no longer exist.")
    p.add_argument("--kb", required=True)
    p.add_argument("--apply", action="store_true", help="Actually delete missing documents. Default is preview only.")
    p.add_argument("--dry-run", action="store_true", help="Deprecated no-op; prune previews by default.")
    p.set_defaults(func=command_prune)

    p = sub.add_parser("rebuild-fts", help="Rebuild the SQLite FTS5 index from stored chunks.")
    p.add_argument("--kb", required=True)
    p.set_defaults(func=command_rebuild_fts)

    p = sub.add_parser("dashboard-data", help="Print JSON for an AI-authored current-session dashboard.")
    p.add_argument("--kb", required=True)
    p.set_defaults(func=command_dashboard_data)

    p = sub.add_parser("render-html", help="Render a static HTML dashboard from the bundled template and current KB data.")
    p.add_argument("--kb", help="Knowledge base to render. Omit when using --all.")
    p.add_argument("--all", action="store_true", help="Render all knowledge bases with a switcher.")
    p.add_argument("--out", help="Output HTML file. Not required with --stdout.")
    p.add_argument("--stdout", action="store_true", help="Print only the full HTML document to stdout for Moss app_build.")
    p.add_argument("--docs-limit", type=int, default=12)
    p.add_argument("--summary", help="Optional summary text for the dashboard.")
    p.add_argument("--search-results", help="Optional JSON file from search --out to embed in the dashboard.")
    p.set_defaults(func=command_render_html)

    p = sub.add_parser("refresh", help="Ingest changed documents and optionally refresh the static HTML dashboard.")
    p.add_argument("--kb", required=True)
    p.add_argument("--out", help="Optional HTML file to regenerate after ingest.")
    p.add_argument("--all", action="store_true", help="When --out is set, render all knowledge bases with a switcher.")
    p.add_argument("--search-results", help="Optional JSON file from search --out to embed in the dashboard.")
    p.add_argument("--docs-limit", type=int, default=12)
    p.add_argument("--full", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="Scan and classify files without parsing or writing the index.")
    p.add_argument("--limit", type=int, help="Stop after discovering this many files.")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--progress-html", help="Write an auto-refreshing current-session HTML progress page.")
    p.add_argument("--no-recursive", action="store_true", help="Only applies to explicit paths passed to this command.")
    p.add_argument("--max-depth", type=int, help="Maximum directory depth for explicit paths passed to this command.")
    p.add_argument("--include", action="append", help="Include glob for explicit paths. Repeatable.")
    p.add_argument("--exclude", action="append", help="Exclude glob for explicit paths. Repeatable.")
    p.add_argument("--ext", action="append", help="Allowed extension for explicit paths. Repeatable or comma-separated.")
    p.add_argument("paths", nargs="*", help="Optional one-shot files or directories to refresh in addition to saved corpus paths.")
    p.set_defaults(func=command_refresh)

    p = sub.add_parser("export", help="Export KB data as JSON or JSONL.")
    p.add_argument("--kb", required=True)
    p.add_argument("--kind", choices=["dashboard", "paths", "docs", "chunks"], default="dashboard")
    p.add_argument("--limit", type=int, default=1000)
    p.add_argument("--out", help="Output file. Use .jsonl for line-delimited records when exporting lists.")
    p.set_defaults(func=command_export)

    p = sub.add_parser("doctor", help="Check local-kb Python, SQLite, package, and parser tool environment.")
    p.add_argument("--kb")
    p.add_argument("--docs-limit", type=int, default=12)
    p.set_defaults(func=command_doctor)

    p = sub.add_parser("overview", help="Print JSON for an AI-authored dashboard covering all knowledge bases.")
    p.add_argument("--docs-limit", type=int, default=12)
    p.set_defaults(func=command_overview)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
