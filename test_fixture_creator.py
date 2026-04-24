#!/usr/bin/env python3
"""Creates test checkpoint fixtures for resume-from-checkpoint acceptance tests.

Runs under the relay contract (--config / --output-dir / --job-id / --script-dir).
Does NOT launch a sim-bridge — creates two .pt files in the output dir, then exits 0.

Outputs:
  <output-dir>/old-format-ckpt.pt   — plain state_dict (old format, matching arch)
  <output-dir>/summary.json         — minimal summary so relay marks job complete
"""

from __future__ import annotations

import argparse
import atexit
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn


def layer_init(layer: nn.Linear, std: float = float(np.sqrt(2)), bias: float = 0.0) -> nn.Linear:
    nn.init.orthogonal_(layer.weight, std)
    nn.init.constant_(layer.bias, bias)
    return layer


class ActorCritic(nn.Module):
    def __init__(self, obs_dim: int, n_actions: int, hidden: int = 64, num_layers: int = 2):
        super().__init__()
        layers: list[nn.Module] = []
        in_dim = obs_dim
        for _ in range(num_layers):
            layers.append(layer_init(nn.Linear(in_dim, hidden)))
            layers.append(nn.Tanh())
            in_dim = hidden
        self.trunk = nn.Sequential(*layers)
        self.actor = layer_init(nn.Linear(hidden, n_actions), std=0.01)
        self.critic = layer_init(nn.Linear(hidden, 1), std=1.0)


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
    _exit_code_path = output_dir / "exit-code"

    def _write_exit_code():
        try:
            _exit_code_path.write_text(str(exit_status["code"]))
        except Exception:
            pass

    atexit.register(_write_exit_code)

    with open(args.config, "r", encoding="utf-8") as fh:
        config = json.load(fh)

    hidden_size = int(config.get("hidden_size", 64))
    num_layers = int(config.get("num_layers", 2))
    obs_dim = 24   # shatter-drift fixed
    n_actions = 6  # shatter-drift fixed

    print(
        f"[fixtures] Creating checkpoints for arch={num_layers}x{hidden_size} "
        f"obs={obs_dim} actions={n_actions}",
        flush=True,
    )

    # ---- Old-format checkpoint (plain state_dict, matching arch) ----
    model = ActorCritic(obs_dim, n_actions, hidden=hidden_size, num_layers=num_layers)
    old_ckpt_path = output_dir / "old-format-ckpt.pt"
    torch.save(model.state_dict(), old_ckpt_path)
    print(f"[fixtures] Saved old-format checkpoint: {old_ckpt_path}", flush=True)

    # ---- Summary ----
    summary = {
        "job_id": args.job_id,
        "description": "test-fixture-creator",
        "old_format_ckpt": str(old_ckpt_path),
        "arch_hidden": hidden_size,
        "arch_num_layers": num_layers,
    }
    with open(output_dir / "summary.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    print("[fixtures] Done.", flush=True)
    exit_status["code"] = 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
