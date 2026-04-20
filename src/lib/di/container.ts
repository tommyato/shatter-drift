import type {
	Binding,
	BindingBuilder,
	Class,
	Container,
	DepsBuilder,
	Factory,
	ScopeBuilder,
} from './types'
import type { Token, TokenType, TokenValue } from '../token'
import { getInjectedTokens, injected as registerInjected } from './injected'

export { injected } from './injected'

export class MissingBindingError extends Error {
	constructor(description: string) {
		super(`No binding found for token: "${description}"`)
		this.name = 'MissingBindingError'
	}
}

export class DuplicateBindingError extends Error {
	constructor(description: string) {
		super(`Token "${description}" is already bound. Use a separate token or create a child container.`)
		this.name = 'DuplicateBindingError'
	}
}

export class CircularDependencyError extends Error {
	constructor(chain: string[]) {
		super(`Circular dependency detected: ${chain.join(' -> ')}`)
		this.name = 'CircularDependencyError'
	}
}

const containerScopeCache = new WeakMap<object, Map<symbol, unknown>>()

function getContainerCache(container: object): Map<symbol, unknown> {
	let cache = containerScopeCache.get(container)
	if (cache === undefined) {
		cache = new Map()
		containerScopeCache.set(container, cache)
	}
	return cache
}

class ContainerImpl implements Container {
	private readonly bindings = new Map<symbol, Binding>()
	private readonly parent: ContainerImpl | null
	private readonly rootResolvingSet: Set<symbol>
	private readonly resolvingChain: string[]
	private destroyed = false

	constructor(parent: ContainerImpl | null, rootResolvingSet: Set<symbol>, resolvingChain: string[]) {
		this.parent = parent
		this.rootResolvingSet = rootResolvingSet
		this.resolvingChain = resolvingChain
	}

	bind<T>(token: Token<T>): BindingBuilder<T> {
		if (this.destroyed) {
			throw new Error('Container has been destroyed')
		}
		const sym = token.__s
		if (this.bindings.has(sym)) {
			throw new DuplicateBindingError(token.__d)
		}

		const binding: Binding<T> = {
			token,
			type: 'factory',
			scope: 'transient',
			hasCachedInstance: false,
		}

		const makeScopeBuilder = (): ScopeBuilder => ({
			asSingleton: () => {
				binding.scope = 'singleton'
			},
			asTransient: () => {
				binding.scope = 'transient'
			},
			asContainerScoped: () => {
				binding.scope = 'container'
			},
			inSingletonScope: () => {
				binding.scope = 'singleton'
			},
			inTransientScope: () => {
				binding.scope = 'transient'
			},
			inContainerScope: () => {
				binding.scope = 'container'
			},
		})

		const makeDepsBuilder = <A extends readonly unknown[]>(
			injectable: Factory<T> | Class<T>,
		): DepsBuilder<T, A> => {
			const scopeBuilder = makeScopeBuilder()
			const depsBuilder = {
				withDeps: (...tokens: readonly TokenValue[]) => {
					;(registerInjected as (fn: Function, ...toks: readonly TokenValue[]) => void)(
						injectable,
						...tokens,
					)
					return scopeBuilder
				},
				...scopeBuilder,
			}
			return depsBuilder as unknown as DepsBuilder<T, A>
		}

		return {
			toValue: (value: T) => {
				;(binding as Binding<T>).scope = 'singleton'
				;(binding as Binding<T> & { type: 'value'; value: T }).type = 'value'
				;(binding as Binding<T>).cachedInstance = value
				;(binding as Binding<T>).hasCachedInstance = true
				this.bindings.set(sym, binding as Binding)
			},
			toFactory: <A extends readonly unknown[]>(factory: (...args: A) => T) => {
				;(binding as any).type = 'factory'
				;(binding as any).factory = factory as Factory<T>
				this.bindings.set(sym, binding as Binding)
				return makeDepsBuilder<A>(factory as Factory<T>)
			},
			toClass: <A extends readonly unknown[]>(ctor: new (...args: A) => T) => {
				;(binding as any).type = 'class'
				;(binding as any).ctor = ctor as Class<T>
				this.bindings.set(sym, binding as Binding)
				return makeDepsBuilder<A>(ctor as Class<T>)
			},
		}
	}

	get<V extends TokenValue>(token: V): TokenType<V> {
		if (this.destroyed) {
			throw new Error('Container has been destroyed')
		}
		if (token.__o) {
			try {
				return this.resolve(token.__s, token.__d) as TokenType<V>
			} catch (error) {
				if (error instanceof MissingBindingError) {
					return undefined as TokenType<V>
				}
				throw error
			}
		}
		return this.resolve(token.__s, token.__d) as TokenType<V>
	}

	createChild(): Container {
		if (this.destroyed) {
			throw new Error('Container has been destroyed')
		}
		return new ContainerImpl(this, this.rootResolvingSet, this.resolvingChain)
	}

	destroy(): void {
		this.destroyed = true
		this.bindings.clear()
		const cache = containerScopeCache.get(this)
		cache?.clear()
	}

	private resolve(sym: symbol, description: string): unknown {
		if (this.rootResolvingSet.has(sym)) {
			throw new CircularDependencyError([...this.resolvingChain, description])
		}

		const owner = this.findOwner(sym)
		if (owner === null) {
			throw new MissingBindingError(description)
		}
		const binding = owner.bindings.get(sym)!
		if (binding.type === 'value') {
			return binding.cachedInstance
		}

		if (binding.scope === 'singleton') {
			if (binding.hasCachedInstance) {
				return binding.cachedInstance
			}
			return this.instantiateCached(binding, owner, sym, description, owner)
		}

		if (binding.scope === 'container') {
			const cache = getContainerCache(this)
			if (cache.has(sym)) {
				return cache.get(sym)
			}
			return this.instantiateCached(binding, this, sym, description, this)
		}

		this.rootResolvingSet.add(sym)
		this.resolvingChain.push(description)
		try {
			return binding.type === 'class'
				? this.callClass(binding.ctor!)
				: this.callFactory(binding.factory!)
		} finally {
			this.rootResolvingSet.delete(sym)
			this.resolvingChain.pop()
		}
	}

	private instantiateCached(
		binding: Binding,
		cacheOwner: ContainerImpl,
		sym: symbol,
		description: string,
		containerForContainerScope: ContainerImpl,
	): unknown {
		this.rootResolvingSet.add(sym)
		this.resolvingChain.push(description)
		try {
			const instance =
				binding.type === 'class'
					? this.callClass(binding.ctor!)
					: this.callFactory(binding.factory!)
			if (binding.scope === 'singleton') {
				;(binding as Binding).cachedInstance = instance
				;(binding as Binding).hasCachedInstance = true
			} else {
				getContainerCache(containerForContainerScope).set(sym, instance)
			}
			return instance
		} finally {
			this.rootResolvingSet.delete(sym)
			this.resolvingChain.pop()
			void cacheOwner
		}
	}

	private callFactory(factory: Factory<unknown>): unknown {
		const depTokens = getInjectedTokens(factory)
		if (depTokens === undefined) {
			if (factory.length > 0) {
				throw new Error(
					`Factory "${factory.name || '(anonymous)'}" has ${factory.length} parameter(s) but no deps were registered. Use .withDeps(TokenA, ...) when binding.`,
				)
			}
			return factory()
		}
		const args = depTokens.map((depToken) => this.get(depToken))
		return factory(...args)
	}

	private callClass(ctor: Class<unknown>): unknown {
		const depTokens = getInjectedTokens(ctor)
		if (depTokens === undefined) {
			if (ctor.length > 0) {
				throw new Error(
					`Class "${ctor.name}" has ${ctor.length} constructor parameter(s) but no deps were registered. Use .withDeps(TokenA, ...) when binding.`,
				)
			}
			return new ctor()
		}
		const args = depTokens.map((depToken) => this.get(depToken))
		return new ctor(...args)
	}

	private findOwner(sym: symbol): ContainerImpl | null {
		if (this.bindings.has(sym)) {
			return this
		}
		return this.parent?.findOwner(sym) ?? null
	}
}

export function createContainer(): Container {
	return new ContainerImpl(null, new Set(), [])
}
