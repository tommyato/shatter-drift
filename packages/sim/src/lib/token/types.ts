export interface TokenValue<T = unknown> {
	readonly __t: T
	readonly __s: symbol
	readonly __d: string
	readonly __o: boolean
}

export interface RequiredToken<T = unknown> extends TokenValue<T> {
	readonly __o: false
}

export interface OptionalToken<T = unknown> extends TokenValue<T> {
	readonly __o: true
}

export interface Token<T = unknown> extends RequiredToken<T> {
	readonly optional: OptionalToken<T>
}

export type TokenType<V extends TokenValue> = V extends RequiredToken<infer T>
	? T
	: V extends OptionalToken<infer T>
		? T | undefined
		: never

