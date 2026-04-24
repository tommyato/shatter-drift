# Shatter Drift v7 Retrain — Launch Templates

**Status:** Ready to fire. Pick option (a) or (b), copy the command block into a shell, and go.
**Context:** v6 (`ffe29003-…`) OOM-killed at step 4,492,800 / 5,000,000 (ckpt-4404224.pt is the last clean checkpoint). Best playtest run 492m (8m short of 500m threshold). See `reports/v6-playtest-2026-04-24.md` for full verdict.

---

## ⚠️ Architecture caveat (important — affects option selection)

v6 was trained with **2×64** (the `train.py` defaults, because the v6 config omitted `hidden_size` and `num_layers`). Confirmed via job status: `"config": { …no hidden_size/num_layers… }`.

`train.py`'s new `load_checkpoint` (commit `88be372`) **fails loud** on shape mismatch: if you resume a 2×64 checkpoint into a 2×128 model, it raises `RuntimeError: Architecture mismatch`. This is by design — silent-reshape bugs during the SD v5 era wasted ~10h of compute.

**Consequence:** "Resume ckpt-4404224.pt with 2×128" is impossible — the combinations that work are:
- (a) Resume at 2×64 *or*
- (b) 2×128 fresh (no resume)

The v6 playtest report's "Resume from ckpt-4404224.pt with explicit 2×128 architecture" recommendation conflates these two options and should be ignored as written.

Additional caveat for option (a): `ckpt-4404224.pt` is in the **old format** (plain state_dict — no optimizer/global_step/tracker saved). On load, `train.py` warns and resets optimizer + global_step=0. So option (a) is *weights-warm-start*, not true resume. The 5M steps are a fresh schedule starting from v6's late-training weights.

---

## Option (a) — 2×64 weights-warm-start from ckpt-4404224.pt

**Theory of improvement:** v6 was plateauing at mean_ret ~52-55 in the final 2M steps — the positional-phase reward had not fully converged, and OOM cut training before the policy could exploit the plateau. Warm-starting from those weights with a fresh 5M step schedule (new LR schedule, new optimizer moments) gives the policy another ~5 hours of training to push past the plateau without relearning low-level skills.

**Why this might be the right call:** The playtest showed the agent already reaches Crystal Caves at 430–492m with correct shatter usage, smooth x13-x16 combos, and purposeful phasing. This isn't "broken agent needs retrain" — it's "trained agent 10% short." Warm-start preserves all that skill while giving the reward signal another lap to converge.

**Downsides:**
- Optimizer resets, so early steps will be noisier than a true resume.
- global_step resets to 0, so TensorBoard shows this as a new run.
- If v6's weights are in a bad local minimum (possible — mean_ret oscillated 48-55 without clear upward trend), warm-start inherits that minimum.

**Expected compute:** ~5h on Mac Studio MPS (same as v6's full run; rough estimate based on v6 SPS ≈ 260 → 5M / 260 = 19,200s = 5.3h).

**Launch command:**

```bash
rl-train start \
  --game-dir /Users/tommyato/Documents/projects/superhq/projects/shatter-drift \
  --config-inline '{
    "total_timesteps": 5000000,
    "num_steps": 256,
    "num_minibatches": 4,
    "update_epochs": 4,
    "learning_rate": 3e-4,
    "gamma": 0.99,
    "gae_lambda": 0.95,
    "clip_coef": 0.2,
    "ent_coef": 0.05,
    "vf_coef": 0.5,
    "max_grad_norm": 0.5,
    "dt": 0.016666666666666666,
    "seed": 42,
    "checkpoint_interval_steps": 100000,
    "max_episode_steps": 10000,
    "class_name": "ShatterDriftSimulation",
    "hidden_size": 64,
    "num_layers": 2,
    "resume_from_checkpoint": "/Users/tommyato/.config/tommyato/training/ffe29003-fd34-4e68-bcfe-46d3388c9ae6/ckpt-4404224.pt"
  }' \
  --tag shatter-drift-v7a-warmstart
```

Expect to see in the log:
```
[load_checkpoint] WARNING: Old-format checkpoint detected (plain state_dict …). Optimizer will be reset … global_step=0.
[shatter-drift] network=2x64 obs=… actions=…
```

---

## Option (b) — 2×128 fresh (no resume)

**Theory of improvement:** Double the hidden dim (64 → 128) gives the network 4× more parameters in each dense layer. If v6's plateau at mean_ret ~52 is a *capacity* limit — i.e. the 2×64 network physically cannot represent the policy needed to chain combos past 500m through Crystal Caves — then only a wider network will break through.

**Why this might be the right call:** The v6 plateau was flat (48-55 oscillation over 2M steps, no clear upward trend in the tail) despite mean_ret being well below typical "converged" values for this task. That's the signature of a capacity cap, not a training-length cap.

**Downsides:**
- No warm-start — full 5M steps starts from random init. All of v6's shatter + centerline + combo skill must be relearned.
- 4× params means ~4× memory for parameters + gradients + Adam moments. v6 OOMed at 2×64 with `num_steps=256, num_minibatches=4` (batch 64). Need to lower either `num_steps` or raise `num_minibatches` to dodge OOM — template below halves `num_steps` to 128.
- Longer training likely (more params = more updates needed to converge).

**Expected compute:** ~6-8h on Mac Studio MPS (rough; more params + smaller num_steps = more updates per 5M steps).

**Launch command:**

```bash
rl-train start \
  --game-dir /Users/tommyato/Documents/projects/superhq/projects/shatter-drift \
  --config-inline '{
    "total_timesteps": 5000000,
    "num_steps": 128,
    "num_minibatches": 4,
    "update_epochs": 4,
    "learning_rate": 3e-4,
    "gamma": 0.99,
    "gae_lambda": 0.95,
    "clip_coef": 0.2,
    "ent_coef": 0.05,
    "vf_coef": 0.5,
    "max_grad_norm": 0.5,
    "dt": 0.016666666666666666,
    "seed": 42,
    "checkpoint_interval_steps": 100000,
    "max_episode_steps": 10000,
    "class_name": "ShatterDriftSimulation",
    "hidden_size": 128,
    "num_layers": 2
  }' \
  --tag shatter-drift-v7b-128h-fresh
```

Expect in the log:
```
[shatter-drift] network=2x128 obs=… actions=…
```
(No `[load_checkpoint]` line — fresh run.)

---

## Agent's recommendation

**Option (a)** is the lower-risk, lower-compute choice and directly addresses the v6 playtest verdict ("borderline — 8m short"). It respects the observation that v6 plays with real skill; it just needs another lap.

Option (b) is the right move *if* you believe the 2×64 network is genuinely capacity-capped. The plateau evidence is suggestive but not conclusive — a single clean 5M-step run at 2×64 (which v6 was not, due to OOM) would tell us more cheaply than starting fresh at 2×128.

**Suggested sequence:** fire (a) first. If v7a still plateaus <500m after 5M clean steps, then (b) is justified. If (a) clears 500m consistently, ship v7a and don't spend the extra compute on (b).

---

## Post-training handoff (both options)

After training completes:

```bash
# Download the ONNX
rl-train download <jobId> --artifact model.onnx --output /Users/tommyato/Documents/projects/superhq/projects/shatter-drift/public/model.onnx

# Playtest verdict (same pattern as v6-playtest-2026-04-24.md)
agent-browser open "https://tommyato.com/games/_play/shatter-drift/?_ai=onnx"
# Run 3 clean games. If 2/3 clear ≥500m with survival ≥30s → ship. Otherwise diagnose.

# If shipping:
cd /Users/tommyato/Documents/projects/superhq/projects/shatter-drift
npm run build
git add public/model.onnx dist
git commit -m "ship: v7<a|b> ONNX agent — mean_ret <X>, playtest 2/3 over 500m"
git push  # GH Pages auto-deploys

# Platform sync (itch.io + Wavedash) — agent will pick this up on [PROJECT TASK COMPLETED] or deploy notification.
```

---

_Prepared 2026-04-24T10:45Z by autonomous deep-work session. Unverified until Tommy fires the command._
