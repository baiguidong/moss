# Local Knowledge Base Plan: Unstructured + SQLite FTS5

## Goal

Build a lightweight local knowledge base for this project using:

- `unstructured` for document parsing
- `SQLite` for storage
- `FTS5` for full-text search
- `jieba` for Chinese tokenization

The system should stay local-first, avoid heavy infrastructure, and be easy to maintain.

---

## Why this stack

### Benefits

- No external database service
- Easy local setup and backup
- Good fit for keyword-based search
- Works well for mixed project documents
- Can later be extended with LLM answering

### Tradeoffs

- `FTS5` is keyword search, not true semantic retrieval
- Chinese search quality depends on custom tokenization
- `unstructured` is broad and practical, but not the strongest option for complex scanned PDFs, formulas, or dense tables

---

## Scope for v1

### Supported file types

Start with these formats only:

- `.md`
- `.txt`
- `.html`
- `.docx`
- `.pdf`

Optional later:

- `.pptx`
- `.xlsx`
- `.eml`
- `.xml`

### Features

- Initialize local database
- Scan a local corpus directory
- Incrementally ingest changed files
- Parse files with `unstructured`
- Split content into chunks
- Build FTS5 index with Chinese tokenization support
- Run local search from CLI
- Return matching chunk with title, path, and nearby context

### Explicitly out of scope for v1

- Vector database
- Semantic retrieval
- OCR-heavy optimization
- Online sync
- Web UI
- Multi-user access

---

## Recommended project layout

```text
kb/
├── corpus/                # source files for the knowledge base
├── data/
│   └── kb.db              # SQLite database
├── app/
│   ├── cli.py             # CLI entrypoint
│   ├── ingest.py          # scan, parse, store
│   ├── parsers.py         # unstructured wrapper
│   ├── chunking.py        # chunk splitting
│   ├── indexing.py        # jieba + FTS preparation
│   ├── search.py          # query logic
│   └── schema.sql         # database schema
└── config.py              # defaults and path config
```

If desired, the first iteration can be collapsed into a single script before refactoring.

---

## Dependencies

### Python packages

```bash
pip install "unstructured[pdf,docx,pptx,xlsx]" jieba
```

If only text-like formats are needed at first, we can reduce extras.

### System dependencies

For local PDF and image handling on macOS:

```bash
brew install poppler tesseract libreoffice
```

If v1 only targets `md`, `txt`, `html`, and `docx`, we can postpone some of these.

---

## Architecture

```text
Local files
  -> file scan
  -> unstructured parse
  -> normalize text
  -> chunk splitting
  -> jieba tokenization
  -> SQLite tables
  -> FTS5 index
  -> MATCH search + bm25 ranking
```

---

## Database design

### `documents`

Store document metadata.

```sql
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT,
  ext TEXT,
  file_size INTEGER,
  mtime REAL,
  file_hash TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### `chunks`

Store original chunk content and retrieval metadata.

```sql
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  page_start INTEGER,
  page_end INTEGER,
  content TEXT NOT NULL,
  indexed_content TEXT NOT NULL,
  char_count INTEGER,
  token_count INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
);
```

### `chunks_fts`

Use FTS5 as an external content table.

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  indexed_content,
  content='chunks',
  content_rowid='id',
  tokenize='unicode61'
);
```

### Triggers

Keep `chunks` and `chunks_fts` synchronized.

```sql
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
```

---

## Parsing strategy

### Default parser

Use `unstructured.partition.auto.partition` so file routing stays simple.

### Parsing priorities

Best-supported starting set:

1. Markdown
2. Plain text
3. HTML
4. DOCX
5. PDF

### Expectations

- Good fit for project notes, docs, tickets, specs, and exported files
- Reasonable for normal PDFs
- Not ideal for complex scanned PDFs or formula-heavy papers

If PDF quality later becomes the bottleneck, only the PDF parser can be swapped to MinerU while keeping SQLite and FTS5 unchanged.

---

## Chunking strategy

### Principles

- Split by document structure first
- Then split by length as fallback
- Keep small overlap between chunks

### Defaults for Chinese-heavy content

- `target_size = 600` characters
- `overlap = 100` characters
- `min_size = 200` characters

### Rules

1. Prefer heading-based sections
2. Merge short adjacent paragraphs
3. If a block is too long, split by sentence/newline before hard length split
4. Carry the last `80-120` characters into the next chunk

### Why this works

- Keeps chunks semantically coherent
- Improves retrieval quality
- Avoids cutting useful context at boundaries

---

## Chinese indexing strategy

SQLite FTS5 does not tokenize Chinese well by default.

### Approach

- Store original text in `content`
- Store tokenized text in `indexed_content`

Example:

```python
import jieba

def to_index_text(text: str) -> str:
    return " ".join(jieba.cut(text))
```

Both ingestion and search must use the same tokenization rule.

---

## Ingestion flow

1. Scan the corpus directory
2. Collect `path`, `ext`, `mtime`, `size`
3. Detect whether the file is new or changed
4. Parse file with `unstructured`
5. Normalize extracted text
6. Split into chunks
7. Generate `indexed_content` with `jieba`
8. Upsert document metadata
9. Replace prior chunks for that document
10. Let FTS triggers keep the search index updated

### Change detection

Re-index when any of the following changes:

- file not seen before
- `mtime` changed
- `file_size` changed
- optional `file_hash` changed

---

## Search flow

### Query processing

1. Accept raw user query
2. Tokenize with `jieba`
3. Search with `MATCH`
4. Rank with `bm25`
5. Return top chunks and optionally neighboring chunks

### Core SQL

```sql
SELECT
  c.id,
  c.doc_id,
  c.chunk_index,
  d.path,
  d.title,
  c.heading,
  c.content,
  bm25(chunks_fts) AS score
FROM chunks_fts
JOIN chunks c ON c.id = chunks_fts.rowid
JOIN documents d ON d.id = c.doc_id
WHERE chunks_fts MATCH ?
ORDER BY score
LIMIT 10;
```

### Recommended improvements

- return previous/next chunk for context
- prepend headings into indexed text for simple weighting
- allow filtering by file type or directory later

---

## CLI design

A minimal CLI is enough for v1.

### Initialize database

```bash
python -m app.cli init
```

### Ingest directory

```bash
python -m app.cli ingest ./corpus
```

### Search

```bash
python -m app.cli search "sqlite 全文检索"
```

### Optional future command

```bash
python -m app.cli ask "这个项目里 SQLite FTS5 怎么用？"
```

That future `ask` command can do retrieval first, then pass results to an LLM.

---

## SQLite runtime settings

Recommended initialization pragmas:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA foreign_keys=ON;
```

These keep the local experience responsive without adding infrastructure.

---

## Performance expectations

This setup should be fine for:

- personal local knowledge bases
- project docs and notes
- thousands of files
- tens of thousands of chunks

Likely bottlenecks:

- PDF parsing speed
- OCR
- full reindexing of large corpora

SQLite itself is usually not the first bottleneck at this scale.

---

## Risks and limitations

### Known limitations

- FTS5 is not semantic search
- Chinese quality depends on tokenization rules
- local PDF parsing quality may vary by document type
- scanned/complex scientific PDFs may need a stronger parser later

### Mitigations

- keep parser abstraction isolated
- keep chunking configurable
- keep schema simple so upgrades are easy

---

## Upgrade path

### Phase 1

- Unstructured
- SQLite
- FTS5
- jieba
- CLI only

### Phase 2

- Replace only PDF parsing with MinerU if needed
- Keep storage and search unchanged

### Phase 3

- Add reranking or embeddings if semantic retrieval becomes necessary
- Keep FTS5 as first-stage recall to stay lightweight

---

## Recommended v1 implementation checklist

- [ ] Create `kb/` working directory
- [ ] Add `schema.sql`
- [ ] Implement database initialization
- [ ] Implement corpus scan and incremental detection
- [ ] Wrap `unstructured` parsing
- [ ] Implement chunk splitting
- [ ] Implement `jieba` indexing conversion
- [ ] Implement SQLite write path
- [ ] Implement FTS5 search path
- [ ] Add CLI commands: `init`, `ingest`, `search`
- [ ] Test with a small mixed corpus

---

## Suggested first corpus

Use a small and realistic sample set:

- project docs in `docs/`
- Markdown notes
- a few exported PDFs
- one DOCX file
- a few HTML pages or saved references

This keeps v1 validation cheap and shows where parsing quality actually matters.

---

## Summary

This plan keeps the local knowledge base:

- lightweight
- local-first
- easy to run
- easy to upgrade later

The design intentionally optimizes for fast implementation and low operational overhead, not maximum parsing sophistication.
