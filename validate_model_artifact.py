#!/usr/bin/env python3
"""
validate_model_artifact.py — Validate model_artifact.json schema and safety metrics.

Supports both v1 (current production) and v2 (new) schemas.
- v1: has model_type, feature_names, trees (no schema_version)
- v2: adds schema_version, mlflow_run_id, safety_metrics, sha256_checksum

Exit codes:
  0 = valid
  1 = invalid (schema error or safety threshold not met)
"""
import hashlib
import json
import sys
import warnings


def _compute_tree_hash(trees: list) -> str:
    """SHA-256 of the JSON-serialized tree content."""
    content = json.dumps(trees, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(content.encode()).hexdigest()


def validate_v1(artifact: dict) -> list[str]:
    """Validate v1 schema. Returns list of errors (empty = valid)."""
    errors = []
    required = ["model_type", "feature_names", "trees"]
    for key in required:
        if key not in artifact:
            errors.append(f"Missing required field: {key}")
    if "feature_names" in artifact and not isinstance(artifact["feature_names"], list):
        errors.append("feature_names must be a list")
    if "trees" in artifact and not isinstance(artifact["trees"], list):
        errors.append("trees must be a list")
    return errors


def validate_v2(artifact: dict) -> list[str]:
    """Validate v2 schema. Returns list of errors (empty = valid)."""
    errors = []

    # Required fields
    required = [
        "schema_version", "mlflow_run_id", "exported_at",
        "sha256_checksum", "safety_metrics", "features", "trees",
    ]
    for key in required:
        if key not in artifact:
            errors.append(f"Missing required field: {key}")

    if errors:
        return errors

    # Schema version
    if str(artifact["schema_version"]) != "2":
        errors.append(f"Expected schema_version '2', got '{artifact['schema_version']}'")

    # mlflow_run_id
    if not artifact.get("mlflow_run_id"):
        errors.append("mlflow_run_id must be non-empty")

    # Checksum verification
    expected_hash = artifact["sha256_checksum"]
    actual_hash = _compute_tree_hash(artifact["trees"])
    if expected_hash != actual_hash:
        errors.append(
            f"Checksum mismatch: expected {expected_hash[:16]}..., "
            f"got {actual_hash[:16]}..."
        )

    # Safety metrics
    sm = artifact.get("safety_metrics", {})
    if not isinstance(sm, dict):
        errors.append("safety_metrics must be a dict")
        return errors

    safety_required = ["drunk_recall", "sober_precision", "auc_roc", "n_subjects", "cv_folds"]
    for key in safety_required:
        if key not in sm:
            errors.append(f"Missing safety_metrics.{key}")

    if "drunk_recall" in sm and sm["drunk_recall"] < 0.80:
        errors.append(
            f"SAFETY GATE FAILED: drunk_recall={sm['drunk_recall']:.3f} < 0.80 minimum"
        )

    if "n_subjects" in sm and sm["n_subjects"] < 8:
        errors.append(
            f"Insufficient statistical power: n_subjects={sm['n_subjects']} < 8 minimum"
        )

    return errors


def validate(path: str) -> bool:
    """Validate a model artifact file. Returns True if valid."""
    with open(path) as f:
        artifact = json.load(f)

    # Detect schema version
    schema_version = artifact.get("schema_version")

    if schema_version is None:
        # v1 schema
        warnings.warn(
            "model_artifact.json uses v1 schema (no schema_version). "
            "New exports should use v2 schema with safety_metrics.",
            DeprecationWarning,
            stacklevel=2,
        )
        errors = validate_v1(artifact)
        label = "v1"
    else:
        errors = validate_v2(artifact)
        label = f"v{schema_version}"

    if errors:
        print(f"FAIL ({label} schema) — {len(errors)} error(s):")
        for err in errors:
            print(f"  - {err}")
        return False

    print(f"PASS ({label} schema)")
    if schema_version and "safety_metrics" in artifact:
        sm = artifact["safety_metrics"]
        print(f"  drunk_recall: {sm.get('drunk_recall', '?')}")
        print(f"  auc_roc: {sm.get('auc_roc', '?')}")
        print(f"  n_subjects: {sm.get('n_subjects', '?')}")
    return True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path/to/model_artifact.json>")
        sys.exit(1)

    ok = validate(sys.argv[1])
    sys.exit(0 if ok else 1)
