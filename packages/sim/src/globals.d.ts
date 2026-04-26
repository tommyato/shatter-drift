// Minimal ambient declarations for Web APIs that are also part of Node's
// global namespace. Declared explicitly here so that @sd/sim can avoid
// pulling in the full DOM type lib (which would risk callers introducing
// browser-only references into the otherwise-pure simulation).
declare const performance: {
	now(): number
}
