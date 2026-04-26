import type { TokenValue } from '../token'
import type { TokensFor } from './types'

const registry = new WeakMap<Function, readonly TokenValue[]>()

export function injected<A extends readonly unknown[]>(
	injectable: ((...args: A) => unknown) | (new (...args: A) => unknown),
	...tokens: TokensFor<A>
): void {
	registry.set(injectable as Function, tokens as readonly TokenValue[])
}

export function getInjectedTokens(factory: Function): readonly TokenValue[] | undefined {
	return registry.get(factory)
}

