#!/usr/bin/env python3
"""Validate a generated Moss App/Extension pair at static or release phase."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


CALL_PATTERNS = {
    "commands": re.compile(r"\.commands\.execute\(\s*['\"]([^'\"]+)['\"]"),
    "tools": re.compile(r"\.tools\.call\(\s*['\"]([^'\"]+)['\"]"),
}
REGISTER_PATTERNS = {
    "commands": re.compile(r"registerCommand\(\s*['\"]([^'\"]+)['\"]"),
    "tools": re.compile(r"registerTool\(\s*['\"]([^'\"]+)['\"]"),
}
DANGEROUS_PATTERNS = {
    "eval": re.compile(r"\beval\s*\("),
    "new Function": re.compile(r"\bnew\s+Function\s*\("),
    "child_process.exec": re.compile(r"\b(?:exec|execSync)\s*\("),
    "shell true": re.compile(r"\bshell\s*:\s*true\b"),
    "generic runner name": re.compile(
        r"(?:registerCommand|registerTool)\(\s*['\"](?:runShell|executeCode|runScript|executeCommand)['\"]",
        re.I,
    ),
}
CODE_SUFFIXES = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html"}
TEST_CATEGORIES = {
    "success", "invalid-input", "dependency", "failure", "timeout", "integration", "equivalence"
}
TEST_OPERATORS = {"exists", "equals", "type", "nonEmpty", "minItems"}
RUNTIME_SKIP_DIRS = {"node_modules", "src", ".git"}
SENSITIVE_KEY = re.compile(
    r"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|credential|authorization)",
    re.I,
)
HOST_API_METHOD_PATTERN = re.compile(
    r"(?:window\.)?mossApp\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\("
)
HOST_API_METHODS = {
    "app": {"getInfo", "getVersions"},
    "extensions": {"getStatus"},
    "storage": {"getItem", "setItem", "removeItem", "list"},
    "commands": {"execute"},
    "tools": {"call"},
    "events": {"on"},
}


def read_json(path: Path, errors: list[str], label: str | None = None) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("root value must be an object")
        return value
    except (OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"Invalid {label or 'JSON'} {path}: {error}")
        return {}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def runtime_files(root: Path, errors: list[str]) -> list[Path]:
    files = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(part in RUNTIME_SKIP_DIRS for part in relative.parts):
            continue
        if path.is_symlink():
            errors.append(f"Generated Extension package contains a symbolic link: {relative.as_posix()}")
            continue
        if path.is_file() and not path.name.endswith(".log"):
            files.append(path)
    return files


def extension_fingerprint(root: Path, errors: list[str]) -> str:
    digest = hashlib.sha256()
    for path in runtime_files(root, errors):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def read_code(root: Path) -> list[tuple[Path, str]]:
    code = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in CODE_SUFFIXES:
            continue
        if any(part in {"node_modules", "build"} for part in path.relative_to(root).parts):
            continue
        try:
            code.append((path, path.read_text(encoding="utf-8")))
        except UnicodeDecodeError:
            continue
    return code


def normalize_action(extension_id: str, action: str) -> str:
    action = str(action or "").strip()
    return action if action.startswith(f"{extension_id}.") else f"{extension_id}.{action}"


def is_env_reference(value) -> bool:
    return (
        isinstance(value, dict) and
        set(value) == {"$env"} and
        isinstance(value["$env"], str) and
        bool(re.fullmatch(r"[A-Z_][A-Z0-9_]*", value["$env"]))
    )


def sensitive_paths(value, prefix: str = "$") -> list[str]:
    if isinstance(value, list):
        found = []
        for index, child in enumerate(value):
            found.extend(sensitive_paths(child, f"{prefix}[{index}]"))
        return found
    if not isinstance(value, dict):
        return []
    found = []
    for key, child in value.items():
        next_path = f"{prefix}.{key}"
        if SENSITIVE_KEY.search(str(key)) and not is_env_reference(child):
            found.append(next_path)
        elif isinstance(child, (dict, list)):
            found.extend(sensitive_paths(child, next_path))
    return found


def assertion_signature(assertion: dict) -> dict:
    return {
        key: assertion[key]
        for key in ("path", "operator", "value")
        if key in assertion
    }


def resolve_assertion_path(root, expression: str) -> tuple[bool, object]:
    if expression in {"", "$"}:
        return True, root
    value = root
    for part in re.sub(r"^\$\.?", "", expression).split("."):
        if not part:
            continue
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return False, None
    return True, value


def json_type(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (int, float)):
        return "number"
    return "unsupported"


def evaluate_report_assertion(outcome, assertion: dict) -> bool:
    found, actual = resolve_assertion_path(outcome, str(assertion.get("path") or ""))
    operator = assertion.get("operator")
    if operator == "exists":
        return found
    if operator == "equals":
        if not found:
            return False
        return json.dumps(actual, ensure_ascii=False, sort_keys=True, separators=(",", ":")) == json.dumps(
            assertion.get("value"), ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
    if operator == "type":
        return found and json_type(actual) == assertion.get("value")
    if operator == "nonEmpty":
        return found and isinstance(actual, (str, list, dict)) and len(actual) > 0
    if operator == "minItems":
        return found and isinstance(actual, list) and len(actual) >= assertion.get("value", 0)
    return False


def full_names(extension_id: str, entries: list[dict], kind: str, errors: list[str]) -> set[str]:
    names = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f"Extension contributes.{kind}[{index}] must be an object")
            continue
        name = str(entry.get("name") or entry.get("command") or "").strip()
        if not name:
            errors.append(f"Extension contributes.{kind}[{index}] has no name")
            continue
        names.add(normalize_action(extension_id, name))
    return names


def resolve_app_file(app_dir: Path, relative: str, errors: list[str], label: str) -> Path | None:
    try:
        path = (app_dir / relative).resolve()
        path.relative_to(app_dir)
    except (OSError, ValueError):
        errors.append(f"{label} must stay inside the App directory: {relative}")
        return None
    if not path.is_file():
        errors.append(f"{label} does not exist: {relative}")
        return None
    return path


def validate_source_review(
    app_dir: Path,
    analysis: dict,
    implemented: list[dict],
    errors: list[str],
) -> tuple[dict, set[str], list[dict]]:
    review = analysis.get("sourceReview")
    if not isinstance(review, dict):
        errors.append("skill-app-analysis.json sourceReview must be an object")
        return {}, set(), []
    inspection_file = str(review.get("inspectionFile") or "").strip()
    inspection_path = resolve_app_file(app_dir, inspection_file, errors, "sourceReview.inspectionFile") if inspection_file else None
    if not inspection_file:
        errors.append("sourceReview.inspectionFile is required")
    inspection = read_json(inspection_path, errors, "Skill inspection") if inspection_path else {}
    reviewed = review.get("reviewedFiles")
    if not isinstance(reviewed, list) or not reviewed:
        errors.append("sourceReview.reviewedFiles must be a non-empty array")
        reviewed_set: set[str] = set()
    else:
        reviewed_set = {str(item) for item in reviewed}
        if len(reviewed_set) != len(reviewed):
            errors.append("sourceReview.reviewedFiles contains duplicates")

    available = {
        str(item.get("path"))
        for item in inspection.get("files", [])
        if isinstance(item, dict) and item.get("path")
    }
    for required in {"SKILL.md", *inspection.get("directResourceReferences", [])}:
        if required not in reviewed_set:
            errors.append(f"Required target Skill source was not reviewed: {required}")
    for reviewed_file in reviewed_set - available:
        errors.append(f"sourceReview references a file absent from the inspection: {reviewed_file}")
    target = analysis.get("targetSkill") or {}
    if inspection and target.get("fingerprint") != inspection.get("fingerprint"):
        errors.append("targetSkill.fingerprint does not match the saved Skill inspection")
    documented_unresolved = review.get("unresolvedImports")
    if not isinstance(documented_unresolved, list):
        errors.append("sourceReview.unresolvedImports must be an array")
        documented_unresolved = []
    documented_keys = {
        (str(item.get("source") or ""), str(item.get("import") or ""))
        for item in documented_unresolved
        if isinstance(item, dict) and str(item.get("resolution") or item.get("reason") or "").strip()
    }
    for item in inspection.get("unresolvedLocalImports", []):
        if not isinstance(item, dict) or item.get("source") not in reviewed_set:
            continue
        key = (str(item.get("source") or ""), str(item.get("import") or ""))
        if key not in documented_keys:
            errors.append(f"Reviewed source has an unresolved import without a documented resolution: {key[0]} -> {key[1]}")

    mappings = analysis.get("resourceMappings")
    if not isinstance(mappings, list) or not mappings:
        errors.append("skill-app-analysis.json resourceMappings must be a non-empty array")
        mappings = []
    mapped_sources: set[str] = set()
    graph = inspection.get("localDependencyClosure") or {}
    for index, mapping in enumerate(mappings):
        if not isinstance(mapping, dict):
            errors.append(f"resourceMappings[{index}] must be an object")
            continue
        source = str(mapping.get("source") or "").strip()
        strategy = mapping.get("strategy")
        mapped_sources.add(source)
        if source not in available:
            errors.append(f"resourceMappings[{index}].source is absent from the inspection: {source}")
        if source not in reviewed_set:
            errors.append(f"Mapped source was not reviewed: {source}")
        if strategy not in {"reuse", "bundle", "adapter", "reimplement"}:
            errors.append(f"resourceMappings[{index}].strategy is invalid: {strategy}")
        generated_targets = mapping.get("generatedTargets")
        if not isinstance(generated_targets, list) or not generated_targets:
            errors.append(f"resourceMappings[{index}].generatedTargets must be a non-empty array")
        else:
            if len(generated_targets) != len(set(str(item) for item in generated_targets)):
                errors.append(f"resourceMappings[{index}].generatedTargets contains duplicates")
            for target in generated_targets:
                resolve_app_file(app_dir, str(target), errors, f"resourceMappings[{index}].generatedTargets")
        for dependency in graph.get(source, []):
            if dependency not in reviewed_set:
                errors.append(f"Local dependency closure was not reviewed for {source}: {dependency}")
        equivalence = mapping.get("equivalenceTestCases") or []
        if strategy == "reimplement":
            if not str(mapping.get("reason") or "").strip():
                errors.append(f"Reimplemented resource has no reason: {source}")
            if not isinstance(equivalence, list) or not equivalence:
                errors.append(f"Reimplemented resource has no equivalence test cases: {source}")

    for capability in implemented:
        implementation_sources = capability.get("implementationSources")
        if not isinstance(implementation_sources, list) or not implementation_sources:
            errors.append(f"Implemented capability has no implementationSources: {capability.get('id')}")
            implementation_sources = []
        for source in implementation_sources:
            if source not in mapped_sources:
                errors.append(f"Implemented capability source has no resource mapping: {capability.get('id')} -> {source}")
        for evidence in capability.get("sourceEvidence") or []:
            source = str(evidence.get("file") or "") if isinstance(evidence, dict) else ""
            if source and source not in reviewed_set:
                errors.append(f"Implemented capability source was not reviewed: {capability.get('id')} -> {source}")
    return inspection, reviewed_set, mappings


def validate_analysis(app_dir: Path, errors: list[str], warnings: list[str]) -> dict:
    path = app_dir / "generated" / "skill-app-analysis.json"
    analysis = read_json(path, errors, "conversion analysis")
    if not analysis:
        return {}
    if analysis.get("schemaVersion") != 1:
        errors.append("skill-app-analysis.json schemaVersion must be 1")
    capabilities = analysis.get("capabilities")
    if not isinstance(capabilities, list):
        errors.append("skill-app-analysis.json capabilities must be an array")
        capabilities = []

    valid_dispositions = {"visual", "ai-assisted", "manual", "excluded"}
    counts = {name: 0 for name in valid_dispositions}
    seen_ids = set()
    implemented = []
    primary_count = 0
    for index, capability in enumerate(capabilities):
        if not isinstance(capability, dict):
            errors.append(f"skill-app-analysis.json capabilities[{index}] must be an object")
            continue
        capability_id = str(capability.get("id") or "").strip()
        if not capability_id:
            errors.append(f"skill-app-analysis.json capabilities[{index}] has no id")
        elif capability_id in seen_ids:
            errors.append(f"Duplicate capability id in skill-app-analysis.json: {capability_id}")
        seen_ids.add(capability_id)
        disposition = capability.get("disposition")
        if disposition not in valid_dispositions:
            errors.append(f"Invalid capability disposition for {capability_id or index}: {disposition}")
            continue
        counts[disposition] += 1
        if not isinstance(capability.get("primary"), bool):
            errors.append(f"Capability primary must be boolean: {capability_id or index}")
        elif capability["primary"]:
            primary_count += 1
        evidence = capability.get("sourceEvidence")
        if not isinstance(evidence, list) or not evidence:
            errors.append(f"Capability has no source evidence: {capability_id or index}")
        tests = capability.get("testCases")
        if disposition in {"visual", "ai-assisted"}:
            implemented.append(capability)
            if not isinstance(tests, list) or not tests:
                errors.append(f"Implemented capability has no executable test case IDs: {capability_id or index}")
            if not str(capability.get("extensionAction") or "").strip():
                errors.append(f"Implemented capability has no Extension action: {capability_id or index}")
        gap_reason = capability.get("gapReason")
        if disposition in {"manual", "excluded"} and not str(gap_reason or "").strip():
            errors.append(f"Unimplemented capability has no gapReason: {capability_id or index}")

    if implemented and primary_count == 0:
        errors.append("At least one implemented capability must be marked primary")
    coverage = analysis.get("coverage")
    if not isinstance(coverage, dict):
        errors.append("skill-app-analysis.json coverage must be an object")
        coverage = {}
    expected = {
        "discovered": len(capabilities),
        "visual": counts["visual"],
        "aiAssisted": counts["ai-assisted"],
        "manual": counts["manual"],
        "excluded": counts["excluded"],
    }
    for key, value in expected.items():
        if coverage.get(key) != value:
            errors.append(f"skill-app-analysis.json coverage.{key} is {coverage.get(key)!r}; expected {value}")
    inspection, reviewed, mappings = validate_source_review(app_dir, analysis, implemented, errors)
    analysis["_implemented"] = implemented
    analysis["_inspection"] = inspection
    analysis["_reviewed"] = reviewed
    analysis["_mappings"] = mappings
    return analysis


def validate_test_plan(
    app_dir: Path,
    extension_id: str,
    declared: dict[str, set[str]],
    analysis: dict,
    errors: list[str],
) -> tuple[dict, Path, dict[str, dict]]:
    path = app_dir / "generated" / "extension-tests.json"
    plan = read_json(path, errors, "Extension test plan")
    cases_by_id: dict[str, dict] = {}
    if not plan:
        return {}, path, cases_by_id
    if plan.get("schemaVersion") != 1:
        errors.append("extension-tests.json schemaVersion must be 1")
    if plan.get("extensionId") != extension_id:
        errors.append(f"extension-tests.json extensionId must equal {extension_id}")
    cases = plan.get("cases")
    if not isinstance(cases, list) or not cases:
        errors.append("extension-tests.json cases must be a non-empty array")
        cases = []
    categories_by_action: dict[str, set[str]] = {}
    all_declared = declared["commands"] | declared["tools"]
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            errors.append(f"extension-tests.json cases[{index}] must be an object")
            continue
        case_id = str(case.get("id") or "").strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", case_id):
            errors.append(f"extension-tests.json cases[{index}].id is invalid")
        elif case_id in cases_by_id:
            errors.append(f"Duplicate Extension test case ID: {case_id}")
        cases_by_id[case_id] = case
        action = normalize_action(extension_id, case.get("action"))
        kind = case.get("kind")
        category = case.get("category")
        expected_kind = "commands" if kind == "command" else "tools" if kind == "tool" else ""
        if expected_kind == "":
            errors.append(f"Extension test case has invalid kind: {case_id}")
        elif action not in declared[expected_kind]:
            errors.append(f"Extension test case references an undeclared action: {case_id} -> {action}")
        if category not in TEST_CATEGORIES:
            errors.append(f"Extension test case has invalid category: {case_id} -> {category}")
        if case.get("required") is not True:
            errors.append(f"Extension test case must be required: {case_id}")
        if not isinstance(case.get("input"), dict):
            errors.append(f"Extension test case input must be an object: {case_id}")
        else:
            credentials = sensitive_paths(case["input"])
            if credentials:
                errors.append(f"Extension test case must not embed credentials: {case_id} -> {', '.join(credentials)}")
        timeout_ms = case.get("timeoutMs", 30000)
        if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, int) or not 100 <= timeout_ms <= 120000:
            errors.append(f"Extension test case timeoutMs must be an integer from 100 to 120000: {case_id}")
        assertions = (case.get("expect") or {}).get("assertions")
        if not isinstance(assertions, list) or not assertions:
            errors.append(f"Extension test case must contain assertions: {case_id}")
        else:
            for assertion in assertions:
                if not isinstance(assertion, dict) or assertion.get("operator") not in TEST_OPERATORS:
                    errors.append(f"Extension test case has an invalid assertion: {case_id}")
                    continue
                if not isinstance(assertion.get("path"), str):
                    errors.append(f"Extension test assertion path must be a string: {case_id}")
                operator = assertion.get("operator")
                if operator in {"equals", "type", "minItems"} and "value" not in assertion:
                    errors.append(f"Extension test assertion requires a value: {case_id} -> {operator}")
                if operator == "type" and assertion.get("value") not in {
                    "null", "array", "object", "string", "number", "boolean"
                }:
                    errors.append(f"Extension test type assertion has an invalid value: {case_id}")
                if operator == "minItems" and (
                    isinstance(assertion.get("value"), bool) or
                    not isinstance(assertion.get("value"), int) or
                    assertion.get("value") < 1
                ):
                    errors.append(f"Extension test minItems assertion must use an integer of at least 1: {case_id}")
        assertions = assertions if isinstance(assertions, list) else []
        success_assertion = any(
            assertion.get("path") == "result.ok" and assertion.get("operator") == "equals" and assertion.get("value") is True
            for assertion in assertions if isinstance(assertion, dict)
        )
        failure_assertion = any(
            (assertion.get("path") == "result.ok" and assertion.get("operator") == "equals" and assertion.get("value") is False) or
            (assertion.get("path") == "threw" and assertion.get("operator") == "equals" and assertion.get("value") is True)
            for assertion in assertions if isinstance(assertion, dict)
        )
        if category in {"success", "integration", "equivalence"} and not success_assertion:
            errors.append(f"Successful Extension test must assert result.ok equals true: {case_id}")
        if category in {"invalid-input", "dependency", "failure", "timeout"} and not failure_assertion:
            errors.append(f"Failure Extension test must assert result.ok false or threw true: {case_id}")
        if category == "integration":
            meaningful = any(
                str(assertion.get("path") or "").startswith("result.data") and
                assertion.get("operator") in {"nonEmpty", "minItems"} and
                (
                    assertion.get("operator") != "minItems" or
                    (
                        isinstance(assertion.get("value"), int) and
                        not isinstance(assertion.get("value"), bool) and
                        assertion.get("value") >= 1
                    )
                )
                for assertion in assertions if isinstance(assertion, dict)
            )
            if not meaningful:
                errors.append(f"Integration test must assert meaningful non-empty result.data: {case_id}")
        categories_by_action.setdefault(action, set()).add(category)

    for action in sorted(all_declared):
        categories = categories_by_action.get(action, set())
        if "success" not in categories and "integration" not in categories:
            errors.append(f"Generated action has no representative success test: {action}")
        if "invalid-input" not in categories:
            errors.append(f"Generated action has no invalid-input test: {action}")

    for capability in analysis.get("_implemented", []):
        capability_id = capability.get("id")
        action = normalize_action(extension_id, capability.get("extensionAction"))
        test_ids = capability.get("testCases") or []
        for test_id in test_ids:
            case = cases_by_id.get(test_id)
            if not case:
                errors.append(f"Capability references a missing Extension test case: {capability_id} -> {test_id}")
            elif normalize_action(extension_id, case.get("action")) != action:
                errors.append(f"Capability test case targets a different action: {capability_id} -> {test_id}")
        if capability.get("primary") and "network" in (capability.get("risks") or []):
            if not any(cases_by_id.get(test_id, {}).get("category") == "integration" for test_id in test_ids):
                errors.append(f"Primary network capability has no live integration test: {capability_id}")

    for mapping in analysis.get("_mappings", []):
        if mapping.get("strategy") == "reimplement":
            for test_id in mapping.get("equivalenceTestCases") or []:
                case = cases_by_id.get(test_id)
                if not case:
                    errors.append(f"Reimplemented resource references a missing equivalence test: {mapping.get('source')} -> {test_id}")
                elif case.get("category") != "equivalence":
                    errors.append(f"Reimplementation test must use equivalence category: {test_id}")
    return plan, path, cases_by_id


def validate_release_report(
    app_dir: Path,
    extension_dir: Path,
    extension: dict,
    plan_path: Path,
    cases_by_id: dict[str, dict],
    errors: list[str],
) -> dict:
    report_path = app_dir / "generated" / "extension-test-report.json"
    report = read_json(report_path, errors, "Extension test report")
    if not report:
        return {}
    if report.get("schemaVersion") != 1 or report.get("ok") is not True:
        errors.append("extension-test-report.json must be a successful schemaVersion 1 report")
    if report.get("extensionId") != extension.get("id") or report.get("extensionVersion") != extension.get("version"):
        errors.append("Extension test report identity/version does not match the current Extension")
    current_extension_fingerprint = extension_fingerprint(extension_dir, errors)
    if report.get("extensionFingerprint") != current_extension_fingerprint:
        errors.append("Extension test report is stale: Extension package fingerprint changed")
    report_root_text = str(report.get("extensionRoot") or "").strip()
    report_root = Path(report_root_text).expanduser().resolve() if report_root_text else None
    installed_layout = bool(
        report_root and
        report_root.name == extension.get("version") and
        report_root.parent.name == extension.get("id") and
        report_root.parent.parent.name == "extensions"
    )
    if report.get("installedLayout") is not True or not installed_layout:
        errors.append("Final Extension test report was not run against an installed Extension path")
    elif not report_root.is_dir():
        errors.append(f"Tested installed Extension no longer exists: {report_root}")
    else:
        installed_manifest = read_json(report_root / "extension.moss.json", errors, "installed Extension manifest")
        if (
            installed_manifest.get("id") != extension.get("id") or
            installed_manifest.get("version") != extension.get("version")
        ):
            errors.append("Tested installed Extension manifest does not match the source identity/version")
        installed_fingerprint = extension_fingerprint(report_root, errors)
        if installed_fingerprint != current_extension_fingerprint:
            errors.append("Tested installed Extension package does not match the current source package")
        if report.get("extensionFingerprint") != installed_fingerprint:
            errors.append("Extension test report fingerprint does not match the tested installed package")
    if not plan_path.is_file() or report.get("planFingerprint") != sha256_file(plan_path):
        errors.append("Extension test report is stale: test-plan fingerprint changed")
    report_cases = {
        str(case.get("id")): case
        for case in report.get("cases", [])
        if isinstance(case, dict) and case.get("id")
    }
    report_case_ids = [
        str(case.get("id"))
        for case in report.get("cases", [])
        if isinstance(case, dict) and case.get("id")
    ]
    if len(report_case_ids) != len(set(report_case_ids)):
        errors.append("Extension test report contains duplicate case IDs")
    if set(report_case_ids) != set(cases_by_id):
        errors.append("Extension test report case IDs do not exactly match the current plan")
    for case_id in cases_by_id:
        case = report_cases.get(case_id)
        planned = cases_by_id[case_id]
        if not case:
            errors.append(f"Extension test report is missing a required case: {case_id}")
        elif case.get("passed") is not True:
            errors.append(f"Required Extension test did not pass: {case_id}")
        else:
            for key in ("action", "kind", "category", "required"):
                if case.get(key) != planned.get(key):
                    errors.append(f"Extension test report case metadata differs from the plan: {case_id} -> {key}")
            planned_assertions = (planned.get("expect") or {}).get("assertions") or []
            report_assertions = case.get("assertions") or []
            if [assertion_signature(item) for item in report_assertions if isinstance(item, dict)] != planned_assertions:
                errors.append(f"Extension test report assertions differ from the plan: {case_id}")
            elif not all(item.get("passed") is True for item in report_assertions if isinstance(item, dict)):
                errors.append(f"Extension test report contains a failed assertion: {case_id}")
            elif not all(evaluate_report_assertion(case.get("outcome"), item) for item in planned_assertions):
                errors.append(f"Extension test report outcome does not satisfy the planned assertions: {case_id}")
    totals = report.get("totals") or {}
    report_case_list = report.get("cases") if isinstance(report.get("cases"), list) else []
    passed_count = sum(1 for case in report_case_list if isinstance(case, dict) and case.get("passed") is True)
    failed_count = len(report_case_list) - passed_count
    required_failed = sum(
        1 for case in report_case_list
        if isinstance(case, dict) and case.get("required") is True and case.get("passed") is not True
    )
    expected_totals = {
        "cases": len(report_case_list),
        "passed": passed_count,
        "failed": failed_count,
        "requiredFailed": required_failed,
    }
    if any(totals.get(key) != value for key, value in expected_totals.items()):
        errors.append("Extension test report totals are inconsistent with its cases")
    return report


def validate(app_dir: Path, extension_dir: Path, phase: str) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    analysis = validate_analysis(app_dir, errors, warnings)
    app = read_json(app_dir / "app.moss.json", errors, "App manifest")
    extension = read_json(extension_dir / "extension.moss.json", errors, "Extension manifest")

    if app.get("schemaVersion") != 1:
        errors.append("app.moss.json schemaVersion must be 1")
    if app.get("kind") != "plugin-app":
        errors.append('app.moss.json kind must be "plugin-app"')
    app_id = str(app.get("id") or "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", app_id):
        errors.append("app.moss.json id must be a lowercase Moss slug")
    entry = str(app.get("entry") or "")
    if not entry:
        errors.append("app.moss.json entry is required")
    else:
        try:
            entry_path = (app_dir / entry).resolve()
            entry_path.relative_to(app_dir)
        except (OSError, ValueError):
            errors.append(f"App entry must stay inside the App directory: {entry}")
        else:
            if not entry_path.is_file() and not (app_dir / "src" / "index.html").is_file() and not (app_dir / "public" / "index.html").is_file():
                errors.append(f"App entry does not exist and no static fallback was found: {entry}")

    extension_id = str(extension.get("id") or "")
    extension_version = str(extension.get("version") or "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", extension_id):
        errors.append("extension.moss.json id must be a lowercase Moss identifier")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", extension_version):
        errors.append("extension.moss.json version must be semver-like")
    main = str(extension.get("main") or "dist/extension.js")
    try:
        main_path = (extension_dir / main).resolve()
        main_relative = main_path.relative_to(extension_dir)
    except (OSError, ValueError):
        errors.append(f"Extension main must stay inside the generated Extension directory: {main}")
    else:
        if any(part in RUNTIME_SKIP_DIRS for part in main_relative.parts):
            errors.append(f"Extension main is excluded from the installable package: {main}")
        if not main_path.is_file():
            errors.append(f"Extension main does not exist: {main}")

    dependencies = app.get("extensionDependencies") or {}
    if not isinstance(dependencies, dict):
        errors.append("app.moss.json extensionDependencies must be an object")
        dependencies = {}
    if extension_id and extension_id not in dependencies:
        errors.append(f"App does not depend on generated Extension {extension_id}")

    capabilities = app.get("capabilities") or {}
    if not isinstance(capabilities, dict):
        errors.append("app.moss.json capabilities must be an object")
        capabilities = {}
    allowed = {}
    for kind in ("commands", "tools"):
        values = capabilities.get(kind) or []
        if values is True or values == "*" or (isinstance(values, list) and "*" in values):
            errors.append(f"Wildcard {kind} capability is not allowed for generated Apps")
            values = []
        if not isinstance(values, list):
            errors.append(f"capabilities.{kind} must be an array")
            values = []
        allowed[kind] = {str(item) for item in values}

    contributes = extension.get("contributes") or {}
    if not isinstance(contributes, dict):
        errors.append("extension.moss.json contributes must be an object")
        contributes = {}
    declared = {
        kind: full_names(extension_id, contributes.get(kind) or [], kind, errors)
        for kind in ("commands", "tools")
    }

    app_code = read_code(app_dir)
    extension_code = read_code(extension_dir)
    calls = {"commands": set(), "tools": set()}
    registrations = {"commands": set(), "tools": set()}
    for _, content in app_code:
        for kind, pattern in CALL_PATTERNS.items():
            calls[kind].update(pattern.findall(content))
        for namespace, method in HOST_API_METHOD_PATTERN.findall(content):
            if method not in HOST_API_METHODS.get(namespace, set()):
                errors.append(f"App uses unsupported Host API: mossApp.{namespace}.{method}()")
    for _, content in extension_code:
        for kind, pattern in REGISTER_PATTERNS.items():
            registrations[kind].update(pattern.findall(content))

    for kind in ("commands", "tools"):
        local_declared = {name[len(extension_id) + 1:] for name in declared[kind] if name.startswith(f"{extension_id}.")}
        for name in calls[kind] - allowed[kind]:
            errors.append(f"UI calls {kind[:-1]} not allowed by app capabilities: {name}")
        for name in calls[kind] - declared[kind]:
            errors.append(f"UI calls {kind[:-1]} not declared by Extension: {name}")
        for name in registrations[kind] - local_declared:
            errors.append(f"Extension registers undeclared {kind[:-1]}: {name}")
        for name in local_declared - registrations[kind]:
            errors.append(f"Extension declares but does not statically register {kind[:-1]}: {name}")
        for name in allowed[kind] - declared[kind]:
            errors.append(f"App allows {kind[:-1]} not declared by generated Extension: {name}")
        for name in declared[kind] - calls[kind]:
            warnings.append(f"Generated Extension {kind[:-1]} is not statically called by the App: {name}")

    for path, content in extension_code:
        relative = path.relative_to(extension_dir).as_posix()
        for label, pattern in DANGEROUS_PATTERNS.items():
            if pattern.search(content):
                errors.append(f"Dangerous generated Extension pattern ({label}) in {relative}")
        if re.search(r"\bspawn\s*\(", content):
            warnings.append(f"Review fixed executable, argument validation, output limits, and timeout in {relative}")
        if re.search(r"\.\.\.process\.env|env\s*:\s*process\.env", content):
            warnings.append(f"Review broad environment forwarding in {relative}")
    extension_fp = extension_fingerprint(extension_dir, errors)

    status_code = [content for _, content in app_code if "extensions.getStatus" in content]
    if not status_code:
        warnings.append("App does not statically display Extension status")
    elif not any(
        re.search(
            rf"\.extensions\s*(?:\?\.)?\s*\[\s*['\"]{re.escape(extension_id)}['\"]\s*\]",
            content,
        ) and
        re.search(r"(?:\.|\[['\"]state['\"]\])state\b|\.state\b", content)
        for content in status_code
    ):
        errors.append(
            "App calls extensions.getStatus() but does not inspect the generated Extension's state; "
            "do not treat a resolved status request as proof that the Extension is active"
        )
    if not any("window.mossApp" in content for _, content in app_code):
        errors.append("App does not use the current window.mossApp Host API")

    plan, plan_path, cases_by_id = validate_test_plan(app_dir, extension_id, declared, analysis, errors)
    report = validate_release_report(app_dir, extension_dir, extension, plan_path, cases_by_id, errors) if phase == "release" else {}
    return {
        "ok": not errors,
        "phase": phase,
        "appId": app_id or None,
        "extensionId": extension_id or None,
        "extensionVersion": extension_version or None,
        "extensionFingerprint": extension_fp,
        "errors": errors,
        "warnings": warnings,
        "summary": {
            "targetSkill": (analysis.get("targetSkill") or {}).get("name") if analysis else None,
            "capabilityCount": len(analysis.get("capabilities") or []) if analysis else 0,
            "reviewedFileCount": len(analysis.get("_reviewed") or []),
            "testCaseCount": len(cases_by_id),
            "testReportPassed": report.get("ok") if report else None,
            "appCalls": {kind: sorted(values) for kind, values in calls.items()},
            "declaredActions": {kind: sorted(values) for kind, values in declared.items()},
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app_dir")
    parser.add_argument("extension_dir")
    parser.add_argument("--phase", choices=("static", "release"), default="static")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    result = validate(
        Path(args.app_dir).expanduser().resolve(),
        Path(args.extension_dir).expanduser().resolve(),
        args.phase,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
