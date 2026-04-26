import type { OptionalToken, Token } from './types'

export function createToken<T>(description: string): Token<T> {
	const sym = Symbol(description)

	const optional: OptionalToken<T> = {
		__t: null as unknown as T,
		__s: sym,
		__d: description,
		__o: true,
	}

	return {
		__t: null as unknown as T,
		__s: sym,
		__d: description,
		__o: false,
		optional,
	}
}

