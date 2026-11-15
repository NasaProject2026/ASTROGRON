"""Command-line entry point for the ASTRAGRON Global Adaptive Evidence module."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .capabilities import capability_dependency_graph
from .inventory import P0_BASELINE_CASES, compute_p0_baseline_report, verify_upstream_integrity


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="adaptive_evidence.cli",
        description="ASTRAGRON Global Adaptive Evidence & Intelligent Fallback Sidecar CLI",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_inv = sub.add_parser("p0-inventory", help="Run P0 baseline inventory and capability report")
    p_inv.add_argument("--output", type=Path, help="Optional path to write JSON report")

    p_eval = sub.add_parser("p5-evaluate", help="Run P5 geographic generalization and red-team report")
    p_eval.add_argument("--output", type=Path, help="Optional path to write JSON report")

    p_verify = sub.add_parser("verify-upstream", help="Verify zero upstream/protected file changes")

    p_pkg = sub.add_parser("package-stage", help="Build review ZIP for a completed stage")
    p_pkg.add_argument("--stage", required=True, help="Stage ID (e.g. P0, P1, P2, P3, P4, P5, P6, P7)")

    args = parser.parse_args(argv)
    if args.command == "verify-upstream":
        res = verify_upstream_integrity()
        print(json.dumps(res, indent=2))
        return 0 if res["passed"] else 1

    if args.command == "p5-evaluate":
        from .evaluation import evaluate_p5_generalization_and_redteam
        rep = evaluate_p5_generalization_and_redteam()
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(rep, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(json.dumps(rep["summary_metrics"], indent=2))
        return 0

    if args.command == "package-stage":
        from .packaging import (
            package_p0,
            package_p1,
            package_p2,
            package_p3,
            package_p4,
            package_p5,
            package_p6,
            package_p7,
        )
        if args.stage == "P0":
            print(json.dumps(package_p0(), indent=2))
            return 0
        if args.stage == "P1":
            print(json.dumps(package_p1(), indent=2))
            return 0
        if args.stage == "P2":
            print(json.dumps(package_p2(), indent=2))
            return 0
        if args.stage == "P3":
            print(json.dumps(package_p3(), indent=2))
            return 0
        if args.stage == "P4":
            print(json.dumps(package_p4(), indent=2))
            return 0
        if args.stage == "P5":
            print(json.dumps(package_p5(), indent=2))
            return 0
        if args.stage == "P6":
            print(json.dumps(package_p6(), indent=2))
            return 0
        if args.stage == "P7":
            print(json.dumps(package_p7(), indent=2))
            return 0
        raise ValueError(f"Unsupported stage: {args.stage}")

    if args.command == "p0-inventory":
        report = compute_p0_baseline_report()
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        summary = {
            "stage": report["stage"],
            "upstream_integrity_passed": report["upstream_integrity"]["passed"],
            "summary_metrics": report["summary_metrics"],
            "output": str(args.output) if args.output else None,
        }
        print(json.dumps(summary, indent=2))
        return 0 if report["upstream_integrity"]["passed"] else 1

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
