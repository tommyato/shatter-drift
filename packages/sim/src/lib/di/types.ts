import type { Token, TokenType, TokenValue } from '../token'

export type { Token, TokenType, TokenValue }

export type Factory<T, A extends readonly unknown[] = readonly any[]> = (...args: A) => T
export type Class<T, A extends readonly unknown[] = readonly any[]> = new (...args: A) => T
export type Scope = 'singleton' | 'transient' | 'container'

export interface Binding<T = unknown> {
	readonly token: Token<T>
	readonly type: 'value' | 'factory' | 'class'
	readonly value?: T
	readonly factory?: Factory<T>
	readonly ctor?: Class<T>
	scope: Scope
	cachedInstance?: T
	hasCachedInstance: boolean
}

export interface Container {
	bind<T>(token: Token<T>): BindingBuilder<T>
	get<V extends TokenValue>(token: V): TokenType<V>
	createChild(): Container
	destroy(): void
}

export type TokensFor<A extends readonly unknown[]> = {
	readonly [K in keyof A]: TokenValue<A[K]>
}

export interface BindingBuilder<T> {
	toValue(value: T): void
	toFactory<A extends readonly unknown[]>(factory: (...args: A) => T): DepsBuilder<T, A>
	toClass<A extends readonly unknown[]>(ctor: new (...args: A) => T): DepsBuilder<T, A>
}

export interface DepsBuilder<T, A extends readonly unknown[] = readonly unknown[]> extends ScopeBuilder {
	withDeps(...tokens: TokensFor<A>): ScopeBuilder
}

export interface ScopeBuilder {
	asSingleton(): void
	asTransient(): void
	asContainerScoped(): void
	inSingletonScope(): void
	inTransientScope(): void
	inContainerScope(): void
}

