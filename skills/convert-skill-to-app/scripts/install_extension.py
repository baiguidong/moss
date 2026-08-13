#!/usr/bin/env python3
"""Preview or install a generated Moss Extension into the local development store."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path


RUNTIME_SKIP_DIRS = {"node_modules", "src", ".git"}


def fail(message: str) -> int:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False), file=sys.stderr)
    return 1


def load_manifest(root: Path) -> dict:
    path = root / "extension.moss.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("extension.moss.json root must be an object")
    return value


def is_inside(root: Path, target: Path) -> bool:
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


def runtime_files(root: Path) -> list[Path]:
    files = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(part in RUNTIME_SKIP_DIRS for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f"Generated Extension must not contain symbolic links: {path}")
        if path.is_file() and not path.name.endswith(".log"):
            files.append(path)
    return files


def package_fingerprint(root: Path) -> str:
    digest = hashlib.sha256()
    for path in runtime_files(root):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extension_dir")
    parser.add_argument("--apply", action="store_true", help="Write the Extension to the Moss store")
    parser.add_argument("--force", action="store_true", help="Replace an existing ID/version build")
    parser.add_argument("--moss-home", help="Override Moss home for tests or development")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    root = Path(args.extension_dir).expanduser().resolve()
    try:
        manifest = load_manifest(root)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return fail(f"Invalid generated Extension: {error}")

    extension_id = str(manifest.get("id") or "")
    version = str(manifest.get("version") or "")
    main_file = (root / str(manifest.get("main") or "dist/extension.js")).resolve()
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", extension_id):
        return fail("Extension id must be a lowercase Moss identifier")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", version):
        return fail("Extension version must be semver-like")
    if not is_inside(root, main_file):
        return fail("Extension main file must stay inside the generated Extension directory")
    main_relative = main_file.relative_to(root)
    if any(part in RUNTIME_SKIP_DIRS for part in main_relative.parts):
        return fail(f"Extension main is excluded from the installable package: {main_relative.as_posix()}")
    if not main_file.is_file():
        return fail(f"Extension main file does not exist: {main_file}")
    try:
        source_fingerprint = package_fingerprint(root)
    except ValueError as error:
        return fail(str(error))

    moss_home = Path(args.moss_home).expanduser().resolve() if args.moss_home else Path.home() / ".moss"
    target = moss_home / "extensions" / extension_id / version
    result = {
        "ok": True,
        "applied": False,
        "source": str(root),
        "target": str(target),
        "extensionId": extension_id,
        "version": version,
        "sourceFingerprint": source_fingerprint,
    }

    if target.is_symlink():
        return fail(f"Installed Extension target must not be a symbolic link: {target}")
    try:
        target_fingerprint = package_fingerprint(target) if target.exists() else None
    except ValueError as error:
        return fail(f"Installed Extension cannot be safely inspected: {error}")
    result["targetFingerprint"] = target_fingerprint

    if not args.apply:
        result["preview"] = True
        result["message"] = "No files were written. Re-run with --apply after approval."
        print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
        return 0

    if target.exists() and target_fingerprint == source_fingerprint:
        result["applied"] = False
        result["unchanged"] = True
        result["preview"] = False
        result["message"] = "The identical generated Extension build is already installed."
        print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
        return 0
    if target.exists() and not args.force:
        return fail(
            f"Extension {extension_id}@{version} is already installed with different code. "
            "Increment the Extension patch version and update app.moss.json before installing. "
            "Use --force only for an explicitly approved temporary replacement."
        )
    if target.exists():
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(root, target, ignore=shutil.ignore_patterns("node_modules", "src", ".git", "*.log"))
    installed_main = target / main_relative
    if not installed_main.is_file():
        shutil.rmtree(target)
        return fail(f"Installed Extension main file is missing after copy: {installed_main}")
    result["applied"] = True
    result["forcedReplacement"] = bool(args.force and target_fingerprint)
    result["preview"] = False
    result["message"] = "Generated Extension installed."
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
