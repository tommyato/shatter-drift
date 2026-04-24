#!/usr/bin/env python3
"""Verify that a checkpoint file has the expected new rich format.

Relay-contract script: takes --config with {"ckpt_path": "<abs_path>"}.
Writes verification result to summary.json and exits 0 if OK, 1 if failed.
"""

from __future__ import annotations

import argparse
import atexit
import json
import sys
from pathlib import Path

import torch


EXPECTED_KEYS = {"model", "optimizer", "global_step", "tracker_returns", "num_episodes_total", "config_snapshot"}


def main() -> int:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--script-dir", required=True)
    args, _ = parser.parse_known_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    exit_status = {"code": 1}

    def _write_exit_code():
        try:
            (output_dir / "exit-code").write_text(str(exit_status["code"]))
        except Exception:
            pass

    atexit.register(_write_exit_code)

    with open(args.config, "r", encoding="utf-8") as fh:
        config = json.load(fh)

    ckpt_path = Path(config["ckpt_path"])
    print(f"[verify] Loading: {ckpt_path}", flush=True)

    raw = torch.load(ckpt_path, weights_only=False)

    ok = isinstance(raw, dict) and set(raw.keys()) == EXPECTED_KEYS
    missing = EXPECTED_KEYS - set(raw.keys()) if isinstance(raw, dict) else EXPECTED_KEYS
    extra = set(raw.keys()) - EXPECTED_KEYS if isinstance(raw, dict) else set()

    print(f"[verify] keys present: {sorted(raw.keys()) if isinstance(raw, dict) else '<not a dict>'}", flush=True)
    print(f"[verify] result: {'PASS' if ok else 'FAIL'}", flush=True)
    if missing:
        print(f"[verify] MISSING keys: {missing}", flush=True)
    if extra:
        print(f"[verify] EXTRA keys: {extra}", flush=True)

    global_step = raw.get("global_step") if isinstance(raw, dict) else None
    print(f"[verify] global_step in ckpt: {global_step}", flush=True)

    summary = {
        "job_id": args.job_id,
        "ckpt_path": str(ckpt_path),
        "keys_found": sorted(raw.keys()) if isinstance(raw, dict) else [],
        "expected_keys": sorted(EXPECTED_KEYS),
        "format_ok": ok,
        "global_step": global_step,
    }
    with open(output_dir / "summary.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    if ok:
        print("[verify] PASS — checkpoint is in new rich format.", flush=True)
        exit_status["code"] = 0
        return 0
    else:
        print("[verify] FAIL — checkpoint does NOT have expected format.", flush=True)
        exit_status["code"] = 1
        return 1


if __name__ == "__main__":
    sys.exit(main())
