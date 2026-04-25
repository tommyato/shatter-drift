// -----------------------------------------------------------------------
// MenuNavigation — gamepad/keyboard cursor for HTML button menus.
//
// Title screen, customize panel, pause menu, and game-over panel each
// register a list of focusable buttons; this module tracks which one is
// "selected" (visual cursor), reads d-pad / left-stick / arrow-keys to
// step the selection, and fires `.click()` on the focused element when
// A (gamepad btn 0) or keyboard Space/Enter is pressed.
//
// Scopes are stacked so opening a modal (customize, pause) pushes a
// new scope; popping restores focus on the underlying menu.
//
// Visual: the focused element gets the `menu-focused` class. CSS in
// index.html paints the cyan glow via `box-shadow: ... !important`,
// which is necessary because several SD buttons run keyframe `transform`
// animations (titleGlow, fadeInUp) that would otherwise mask a transform-
// based focus indicator.
//
// Vendored from Clockwork Climb's gamedevjs-2026-entry/src/menu-navigation.ts
// with minimal edits — just the import path for SD's Input class.
// -----------------------------------------------------------------------

import type { Input } from "./input";

type Direction = "up" | "down" | "left" | "right";

export const MENU_FOCUS_CLASS = "menu-focused";

interface MenuScope {
  items: HTMLElement[];
  index: number;
  // Optional callback for when this scope's cancel button is hit
  // (Esc / gamepad B). The handler is responsible for closing whatever
  // it opened — which itself calls popScope, restoring parent focus.
  onCancel?: () => void;
}

export class MenuNavigation {
  private readonly stack: MenuScope[] = [];
  // Suppress activation for one frame after a scope is pushed, so the
  // same A press that opened a modal doesn't immediately activate the
  // close button inside it.
  private suppressActivateFrames = 0;

  /**
   * Replace the entire scope stack with a single new scope. Use this
   * on entering a screen (title / game-over). The first visible item
   * is auto-focused.
   */
  setScope(items: HTMLElement[], onCancel?: () => void): void {
    this.clearAll();
    if (items.length === 0) return;
    this.stack.push({ items, index: 0, onCancel });
    this.focusFirstVisible();
  }

  /**
   * Push a nested scope (e.g. modal close button). Restores prior
   * focus when popped.
   */
  pushScope(items: HTMLElement[], onCancel?: () => void): void {
    if (items.length === 0) return;
    // Hide focus on the parent scope so only the topmost is visually focused.
    this.removeFocusClass(this.top());
    this.stack.push({ items, index: 0, onCancel });
    this.focusFirstVisible();
    // Skip the next frame's activation read — the same A press that
    // pushed this scope shouldn't immediately confirm inside it.
    this.suppressActivateFrames = 1;
  }

  /** Pop the topmost scope and restore visual focus on the parent. */
  popScope(): void {
    const popped = this.stack.pop();
    if (popped) {
      this.removeFocusClass(popped);
    }
    // Restore parent focus highlight.
    const parent = this.top();
    if (parent) this.applyFocusClass(parent);
  }

  /** Detach entirely (game starts, no menus active). */
  detach(): void {
    this.clearAll();
  }

  /** Whether any scope is currently active. */
  isActive(): boolean {
    return this.stack.length > 0;
  }

  /**
   * Read d-pad / arrow-key / A inputs and update focus + activate
   * focused button. Call once per frame (after `input.update()` and
   * before `input.endFrame()`).
   *
   * Returns true if the menu consumed the A press this frame, so the
   * caller can skip any legacy "space → start game" shortcut and
   * avoid double-firing.
   */
  update(input: Input): boolean {
    const scope = this.top();
    if (!scope) return false;

    // Filter to currently-visible, non-disabled items each frame. A
    // snapshot taken at scope creation can go stale (e.g. a button that
    // toggles `display:none`).
    const visible = scope.items.filter(isInteractable);
    if (visible.length === 0) return false;

    // Re-anchor scope.index against the current visible list. If the
    // currently focused item is no longer visible, snap to 0.
    const currentEl = scope.items[scope.index];
    let visIdx = visible.indexOf(currentEl);
    if (visIdx < 0) {
      visIdx = 0;
      scope.index = scope.items.indexOf(visible[0]);
    }

    const dirPressed: Direction | null =
      input.justPressedDir("up")    ? "up"    :
      input.justPressedDir("down")  ? "down"  :
      input.justPressedDir("left")  ? "left"  :
      input.justPressedDir("right") ? "right" :
      null;

    if (dirPressed !== null) {
      const next = findNeighbor(dirPressed, visible[visIdx], visible);
      if (next !== null) {
        scope.index = scope.items.indexOf(next);
      }
    }
    // Ensure visual focus stays on the current element (covers the case
    // where DOM was re-rendered and class was wiped).
    this.applyFocusClass(scope);

    // Cancel/back (Esc + gamepad B): if the topmost scope was opened
    // with an onCancel handler, fire it.
    if (input.justPressedCancel()) {
      const cancel = scope.onCancel;
      if (cancel) {
        cancel();
        return false;
      }
    }

    if (this.suppressActivateFrames > 0) {
      this.suppressActivateFrames -= 1;
      return false;
    }

    if (input.justPressed("space")) {
      const target = scope.items[scope.index];
      if (target && isInteractable(target)) {
        // Defer the click() so the current frame's input read finishes
        // before any side effects (e.g. modal open) mutate DOM. Without
        // this, opening a modal mid-update can cause the parent scope
        // to lose its focused item before we return.
        queueMicrotask(() => {
          target.click();
        });
        return true;
      }
    }

    return false;
  }

  /** Currently focused element, if any. Useful for callers that need to
   *  know what the user is on (e.g. range slider for left/right adjust). */
  focusedElement(): HTMLElement | null {
    const scope = this.top();
    if (!scope) return null;
    return scope.items[scope.index] ?? null;
  }

  private top(): MenuScope | undefined {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
  }

  private focusFirstVisible(): void {
    const scope = this.top();
    if (!scope) return;
    const firstVisIdx = scope.items.findIndex(isInteractable);
    scope.index = firstVisIdx >= 0 ? firstVisIdx : 0;
    this.applyFocusClass(scope);
  }

  private applyFocusClass(scope: MenuScope): void {
    for (let i = 0; i < scope.items.length; i++) {
      const el = scope.items[i];
      if (i === scope.index) {
        el.classList.add(MENU_FOCUS_CLASS);
      } else {
        el.classList.remove(MENU_FOCUS_CLASS);
      }
    }
  }

  private removeFocusClass(scope: MenuScope | undefined): void {
    if (!scope) return;
    for (const el of scope.items) {
      el.classList.remove(MENU_FOCUS_CLASS);
    }
  }

  private clearAll(): void {
    while (this.stack.length > 0) {
      this.removeFocusClass(this.stack.pop());
    }
  }
}

function isInteractable(el: HTMLElement): boolean {
  if (!el || !el.isConnected) return false;
  // offsetParent is null when the element (or any ancestor) is
  // display:none. visibility:hidden / opacity:0 are intentionally
  // treated as visible — they're typically used for animation, not
  // for hiding a button from interaction.
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  if (el.classList.contains("hidden")) return false;
  return true;
}

// -----------------------------------------------------------------------
// Spatial directional navigation — rect-based d-pad algorithm.
// Standard scoring used by browsers and consoles:
//   score = primaryAxisDist + perpendicularOffset * PERP_MULT
// where the perpendicular penalty is zeroed when the candidate's rect
// brackets our center on the cross-axis (same row/column → snap).
// -----------------------------------------------------------------------

const PERP_MULT = 2;

function findNeighbor(
  direction: Direction,
  currentEl: HTMLElement,
  visible: HTMLElement[]
): HTMLElement | null {
  const candidates = visible.filter((el) => el !== currentEl);
  if (candidates.length === 0) return null;

  const cur  = currentEl.getBoundingClientRect();
  const curCx = (cur.left + cur.right) / 2;
  const curCy = (cur.top  + cur.bottom) / 2;

  const horizontal = direction === "right" || direction === "left";
  const forward    = direction === "right" || direction === "down";

  const curPrimary = horizontal ? curCx : curCy;
  const curPerp    = horizontal ? curCy : curCx;

  interface Scored { el: HTMLElement; aligned: boolean; score: number }

  function scoreCandidate(el: HTMLElement): Scored | null {
    const r  = el.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top  + r.bottom) / 2;

    const candidatePrimary = horizontal ? cx : cy;
    const candidatePerp    = horizontal ? cy : cx;

    if (forward ? candidatePrimary <= curPrimary : candidatePrimary >= curPrimary) {
      return null;
    }

    const primaryDist = Math.abs(candidatePrimary - curPrimary);
    const perpOffset  = Math.abs(candidatePerp    - curPerp);

    const aligned = horizontal
      ? r.top  <= curCy && r.bottom >= curCy
      : r.left <= curCx && r.right  >= curCx;

    return { el, aligned, score: primaryDist + (aligned ? 0 : perpOffset * PERP_MULT) };
  }

  const scored = candidates
    .map(scoreCandidate)
    .filter((s): s is Scored => s !== null)
    .sort((a, b) => {
      if (a.aligned !== b.aligned) return a.aligned ? -1 : 1;
      return a.score - b.score;
    });

  if (scored.length > 0) return scored[0].el;

  // Wraparound — no candidates in primary half-plane. Return the item at
  // the extreme opposite end, breaking ties by perpendicular closeness.
  interface Wrapped { el: HTMLElement; extremeVal: number; perpOffset: number }

  const wrapped = candidates
    .map((el): Wrapped => {
      const r  = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top  + r.bottom) / 2;
      const candidatePrimary = horizontal ? cx : cy;
      const candidatePerp    = horizontal ? cy : cx;
      return {
        el,
        extremeVal: forward ? candidatePrimary : -candidatePrimary,
        perpOffset: Math.abs(candidatePerp - curPerp),
      };
    })
    .sort((a, b) =>
      a.extremeVal !== b.extremeVal
        ? a.extremeVal - b.extremeVal
        : a.perpOffset - b.perpOffset
    );

  return wrapped[0]?.el ?? null;
}
