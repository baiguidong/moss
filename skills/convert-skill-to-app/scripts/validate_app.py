#!/usr/bin/env python3
"""Validate a self-contained Moss App V2 source or build artifact."""
import argparse, base64, hashlib, json, re
from pathlib import Path

ID = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$")
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
ACTION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
DANGEROUS = {
    "shell execution": re.compile(r"(?:exec|spawn)\s*\([^\n]*(?:input|args)\.(?:command|executable|cwd)"),
    "shell true": re.compile(r"shell\s*:\s*true"),
    "dynamic evaluation": re.compile(r"\b(?:eval|Function)\s*\("),
}

def read_json(path, errors, label):
    try:
        value = json.loads(path.read_text("utf-8"))
        if not isinstance(value, dict): raise ValueError("root must be an object")
        return value
    except Exception as exc:
        errors.append(f"{label} is invalid: {exc}")
        return {}

def safe_file(root, value, field, errors):
    if not value: return None
    candidate = (root / str(value)).resolve()
    try: candidate.relative_to(root.resolve())
    except ValueError:
        errors.append(f"{field} escapes the App root: {value}"); return None
    if not candidate.is_file(): errors.append(f"{field} does not exist: {value}")
    return candidate

def package_fingerprint(root):
    digest = hashlib.sha256()
    for item in sorted(root.rglob("*")):
        rel = item.relative_to(root).as_posix()
        if any(part in {"node_modules", ".git", "build"} for part in item.relative_to(root).parts): continue
        if item.is_symlink(): raise ValueError(f"symbolic link is not allowed: {rel}")
        if item.is_file() and not rel.startswith("generated/"):
            digest.update(rel.encode()); digest.update(b"\0"); digest.update(item.read_bytes()); digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"

def validate(root, phase, report_root):
    errors, warnings = [], []
    app = read_json(root / "app.moss.json", errors, "app.moss.json")
    if app.get("schemaVersion") != 2: errors.append("schemaVersion must be 2")
    if not ID.fullmatch(str(app.get("id") or "")): errors.append("id must be a lowercase Moss identifier")
    if not SEMVER.fullmatch(str(app.get("version") or "")): errors.append("version must be semantic versioning")
    if not isinstance(app.get("hostApi"), str) or not app.get("hostApi"): errors.append("hostApi is required")
    if not isinstance(app.get("permissions"), list): errors.append("permissions must be an array")
    ui, backend = app.get("ui"), app.get("backend")
    if not isinstance(ui, dict) and not isinstance(backend, dict): errors.append("at least one of ui or backend is required")
    if isinstance(ui, dict): safe_file(root, ui.get("entry"), "ui.entry", errors)
    declared = set()
    if isinstance(backend, dict):
        if backend.get("runtime") != "node" or backend.get("apiVersion") != 1: errors.append("Backend must use node API version 1")
        if backend.get("lifecycle") not in {"on-demand", "persistent"}: errors.append("Backend lifecycle is invalid")
        if backend.get("instanceMode") not in {"single", "multiple"}: errors.append("Backend instanceMode is invalid")
        targets = backend.get("targets")
        if not isinstance(targets, list) or not targets or any(item not in {"desktop", "server"} for item in targets): errors.append("Backend targets are invalid")
        entry = safe_file(root, backend.get("entry"), "backend.entry", errors)
        actions = backend.get("actions")
        if not isinstance(actions, list): errors.append("Backend actions must be an array"); actions = []
        for index, action in enumerate(actions):
            name = str(action.get("name") or "") if isinstance(action, dict) else ""
            if not ACTION.fullmatch(name): errors.append(f"backend.actions[{index}].name is invalid")
            if name in declared: errors.append(f"duplicate Backend action: {name}")
            declared.add(name)
            if isinstance(action, dict):
                for key in ("inputSchema", "outputSchema"):
                    schema_path = safe_file(root, action.get(key), f"{name}.{key}", errors)
                    if schema_path: read_json(schema_path, errors, f"{name}.{key}")
        config = backend.get("configuration") or {}
        if isinstance(config, dict):
            for key in ("schema", "secrets"):
                schema_path = safe_file(root, config.get(key), f"backend.configuration.{key}", errors)
                if schema_path: read_json(schema_path, errors, f"backend.configuration.{key}")
        if entry:
            code = entry.read_text("utf-8", errors="replace")
            for label, pattern in DANGEROUS.items():
                if pattern.search(code): errors.append(f"dangerous Backend pattern: {label}")
    ui_calls = set()
    for source in list(root.rglob("*.js")) + list(root.rglob("*.ts")) + list(root.rglob("*.tsx")):
        if any(part in {"node_modules", "dist", "build"} for part in source.relative_to(root).parts): continue
        text = source.read_text("utf-8", errors="replace")
        ui_calls.update(re.findall(r"actions\.invoke\s*\(\s*[^,]+,\s*['\"]([^'\"]+)", text))
    for action in sorted(ui_calls - declared): errors.append(f"UI calls undeclared Backend action: {action}")
    try: fingerprint = package_fingerprint(root)
    except ValueError as exc: errors.append(str(exc)); fingerprint = None
    if phase == "release":
        checksums = read_json(root / "checksums.json", errors, "checksums.json")
        actual = {}
        for item in sorted(root.rglob("*")):
            if item.is_file() and item.name != "checksums.json":
                actual[item.relative_to(root).as_posix()] = "sha256-" + base64.b64encode(hashlib.sha256(item.read_bytes()).digest()).decode()
        if checksums != actual: errors.append("checksums.json does not match all packaged files")
        report = read_json(report_root / "backend-test-report.json", errors, "Backend test report")
        plan_path = report_root / "backend-tests.json"
        if report.get("ok") is not True or report.get("appId") != app.get("id") or report.get("appVersion") != app.get("version"): errors.append("Backend test report identity or result is invalid")
        if report.get("appFingerprint") != fingerprint: errors.append("Backend test report is stale: App package changed")
        if plan_path.is_file() and report.get("planFingerprint") != "sha256:" + hashlib.sha256(plan_path.read_bytes()).hexdigest(): errors.append("Backend test report is stale: plan changed")
    return {"ok": not errors, "phase": phase, "appId": app.get("id"), "appVersion": app.get("version"), "appFingerprint": fingerprint, "declaredActions": sorted(declared), "errors": errors, "warnings": warnings}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app_dir"); parser.add_argument("--phase", choices=("static", "release"), default="static")
    parser.add_argument("--report-root"); parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args(); root = Path(args.app_dir).expanduser().resolve()
    report_root = Path(args.report_root).expanduser().resolve() if args.report_root else root / "generated"
    result = validate(root, args.phase, report_root)
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0 if result["ok"] else 1
if __name__ == "__main__": raise SystemExit(main())
