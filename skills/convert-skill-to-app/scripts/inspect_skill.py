#!/usr/bin/env python3
"""Statically inventory a Skill without importing or executing its code."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
from pathlib import Path


SKIP_DIRS = {".git", "__pycache__", "node_modules", "dist", "build", ".venv", "venv"}
TEXT_SUFFIXES = {
    ".md", ".txt", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".json", ".yaml", ".yml", ".toml", ".sh", ".ps1", ".html", ".css",
}
RESOURCE_PATTERN = re.compile(
    r"(?<![\w/.-])((?:scripts|references?|assets)/[A-Za-z0-9_./@+ -]+\.[A-Za-z0-9]+)"
)
CODE_FENCE_PATTERN = re.compile(r"```[^\n]*\n(?P<body>.*?)```", re.DOTALL)
RISK_PATTERNS = {
    "network": re.compile(r"\b(?:curl|wget|fetch\s*\(|requests\.|https?://|upload|download)\b", re.I),
    "install": re.compile(r"\b(?:pip\s+install|npm\s+install|bun\s+add|brew\s+install|apt-get\s+install)\b", re.I),
    "destructive": re.compile(r"\b(?:delete|remove|prune|overwrite|truncate|drop\s+table|rm\s+-r)\b", re.I),
    "credential": re.compile(r"\b(?:api[_ -]?key|secret|token|password|credential|oauth)\b", re.I),
    "shell": re.compile(r"\b(?:bash|zsh|powershell|cmd\.exe|subprocess|child_process|spawn\s*\()\b", re.I),
}
JS_IMPORT_PATTERN = re.compile(
    r"(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\()\s*['\"](?P<path>\.{1,2}/[^'\"]+)['\"]"
)
JS_SOURCE_SUFFIXES = (".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx")
JS_RESOLVE_SUFFIXES = (*JS_SOURCE_SUFFIXES, ".json")


def parse_frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    values: dict[str, str] = {}
    for raw_line in parts[1].splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text_for(path: Path, limit: int = 1_000_000) -> str:
    if path.suffix.lower() not in TEXT_SUFFIXES or path.stat().st_size > limit:
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return ""


def iter_files(root: Path):
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        yield path


def resolve_existing(root: Path, candidate: Path, suffixes: tuple[str, ...]) -> str | None:
    choices = [candidate]
    if not candidate.suffix:
        choices.extend(candidate.with_suffix(suffix) for suffix in suffixes)
        choices.extend(candidate / f"index{suffix}" for suffix in suffixes)
    for choice in choices:
        try:
            resolved = choice.resolve()
            resolved.relative_to(root)
        except (OSError, ValueError):
            continue
        if resolved.is_file() and not resolved.is_symlink():
            return resolved.relative_to(root).as_posix()
    return None


def python_module_parts(path: Path, root: Path) -> list[str]:
    relative = path.relative_to(root).with_suffix("")
    parts = list(relative.parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    return parts


def resolve_python_import(
    root: Path,
    source: Path,
    module: str | None,
    level: int,
) -> str | None:
    current = python_module_parts(source, root)
    if source.name != "__init__.py" and current:
        current.pop()
    if level:
        ascend = level - 1
        if ascend > len(current):
            return None
        base = current[: len(current) - ascend]
        parts = base + ([part for part in (module or "").split(".") if part])
    else:
        parts = [part for part in (module or "").split(".") if part]
    if not parts:
        return None
    candidate = root.joinpath(*parts)
    resolved = resolve_existing(root, candidate, (".py",))
    if resolved or level:
        return resolved
    # Some script-oriented Skills import a sibling as a top-level module because
    # the script directory is placed on sys.path when the entry point runs.
    return resolve_existing(root, source.parent.joinpath(*parts), (".py",))


def build_local_dependency_graph(root: Path, text_files: dict[str, str]) -> tuple[dict[str, list[str]], list[dict]]:
    graph: dict[str, list[str]] = {}
    unresolved: list[dict] = []
    for relative, content in sorted(text_files.items()):
        path = root / relative
        dependencies: set[str] = set()
        if path.suffix == ".py":
            try:
                tree = ast.parse(content, filename=relative)
            except SyntaxError as error:
                unresolved.append({"source": relative, "import": "<parse>", "reason": str(error)})
                graph[relative] = []
                continue
            for node in ast.walk(tree):
                modules: list[tuple[str | None, int]] = []
                if isinstance(node, ast.ImportFrom):
                    if node.module is not None:
                        modules.append((node.module, node.level))
                    else:
                        modules.extend((alias.name, node.level) for alias in node.names)
                elif isinstance(node, ast.Import):
                    modules.extend((alias.name, 0) for alias in node.names)
                for module, level in modules:
                    resolved = resolve_python_import(root, path, module, level)
                    if resolved:
                        dependencies.add(resolved)
                    elif level:
                        unresolved.append({
                            "source": relative,
                            "import": "." * level + (module or ""),
                            "reason": "relative import did not resolve inside the Skill",
                        })
        elif path.suffix.lower() in JS_SOURCE_SUFFIXES:
            for match in JS_IMPORT_PATTERN.finditer(content):
                specifier = match.group("path")
                resolved = resolve_existing(root, path.parent / specifier, JS_RESOLVE_SUFFIXES)
                if resolved:
                    dependencies.add(resolved)
                else:
                    unresolved.append({
                        "source": relative,
                        "import": specifier,
                        "reason": "relative import did not resolve inside the Skill",
                    })
        if path.suffix.lower() in {".py", *JS_SOURCE_SUFFIXES}:
            graph[relative] = sorted(dependencies)
    return graph, unresolved


def transitive_dependencies(graph: dict[str, list[str]]) -> dict[str, list[str]]:
    closure: dict[str, list[str]] = {}
    for source in graph:
        seen: set[str] = set()
        pending = list(graph.get(source, []))
        while pending:
            dependency = pending.pop()
            if dependency in seen:
                continue
            seen.add(dependency)
            pending.extend(graph.get(dependency, []))
        closure[source] = sorted(seen)
    return closure


def inspect(root: Path) -> dict:
    skill_md = root / "SKILL.md"
    if not skill_md.is_file():
        raise ValueError(f"SKILL.md not found: {skill_md}")

    skill_text = skill_md.read_text(encoding="utf-8")
    metadata = parse_frontmatter(skill_text)
    files = []
    text_files: dict[str, str] = {}
    aggregate = hashlib.sha256()
    risk_hits: dict[str, list[str]] = {name: [] for name in RISK_PATTERNS}
    skipped_symlinks = [
        path.relative_to(root).as_posix()
        for path in sorted(root.rglob("*"))
        if path.is_symlink()
    ]

    for path in iter_files(root):
        relative = path.relative_to(root).as_posix()
        digest = sha256_file(path)
        aggregate.update(relative.encode("utf-8"))
        aggregate.update(digest.encode("ascii"))
        content = text_for(path)
        if content:
            text_files[relative] = content
        for name, pattern in RISK_PATTERNS.items():
            if content and pattern.search(content):
                risk_hits[name].append(relative)
        files.append({
            "path": relative,
            "size": path.stat().st_size,
            "sha256": digest,
            "kind": path.parent.relative_to(root).parts[0] if path.parent != root else "root",
            "text": bool(content),
        })

    references = sorted({
        match.group(1).strip().rstrip(".,;:)")
        for match in RESOURCE_PATTERN.finditer(skill_text)
    })
    fenced_commands = []
    for match in CODE_FENCE_PATTERN.finditer(skill_text):
        for line in match.group("body").splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                fenced_commands.append(stripped[:500])

    missing_references = [item for item in references if not (root / item).exists()]
    dependency_graph, unresolved_imports = build_local_dependency_graph(root, text_files)
    return {
        "schemaVersion": 1,
        "root": str(root),
        "name": metadata.get("name") or root.name,
        "description": metadata.get("description", ""),
        "fingerprint": f"sha256:{aggregate.hexdigest()}",
        "skillMd": {
            "lines": len(skill_text.splitlines()),
            "bytes": len(skill_text.encode("utf-8")),
        },
        "files": files,
        "directResourceReferences": references,
        "missingResourceReferences": missing_references,
        "localDependencyGraph": dependency_graph,
        "localDependencyClosure": transitive_dependencies(dependency_graph),
        "unresolvedLocalImports": unresolved_imports,
        "documentedCommandLines": fenced_commands,
        "riskSignals": {name: paths for name, paths in risk_hits.items() if paths},
        "skippedSymlinks": skipped_symlinks,
        "notes": [
            "Static inventory only; no target code or commands were executed.",
            "Symbolic links were inventoried by path but not followed.",
            "Risk signals identify files for review and are not vulnerability findings.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill_dir", help="Path to a Skill directory containing SKILL.md")
    parser.add_argument("--out", help="Optional JSON output path")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    args = parser.parse_args()

    root = Path(args.skill_dir).expanduser().resolve()
    try:
        result = inspect(root)
    except (OSError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1

    rendered = json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None)
    if args.out:
        output = Path(args.out).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
