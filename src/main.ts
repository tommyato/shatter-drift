import { Game } from "./game";

declare global {
	interface Window {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		__harness?: any
		__harnessReady?: boolean
	}
}

if (new URLSearchParams(window.location.search).get("_harness") === "1") {
	// Load harness.js as a runtime-URL dynamic import so TypeScript and Vite
	// cannot statically resolve it to harness.ts. This keeps the normal game
	// bundle lean — the sim/harness code is NOT bundled into index.html.
	// harness.js is built separately by esbuild in build.mjs.
	const harnessUrl = new URL("harness.js", window.location.href).href;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { createHarness } = await (Function("u", "return import(u)")(harnessUrl) as Promise<any>);
	const harness = createHarness();
	window.__harness = harness;
	window.__harnessReady = true;
	console.log("[harness] ready, scripts:", harness.listScripts().join(", "));
} else {
	const game = new Game();
	game.start();
}
