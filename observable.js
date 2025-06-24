/** @type FinalizationRegistry<AbortController> */
const abortRegistry = new FinalizationRegistry(controller => controller.abort())

/** @param {String} string */
const camelToKebab = string => string.replace(/([a-z])([A-Z])/g, (_, a, b) => `${a}-${b}`).toLowerCase()

/** @param {String} string */
const kebabToCamel = string => string.replace(/([a-z])-([a-z])/g, (_, a, b) => a+b.toUpperCase())

/**
 * @typedef {Object} Change
 * @property {string} property
 * @property {any} from
 * @property {any} to
 * @property {boolean} mutation - The change happened inside the value without a new assignment
 */

/* Custom Event Classes */

/** Event fired for every change before the internal state has been updated that can be canceled. */
export class ChangeEvent extends Event {
	/** @param {Change} change */
	constructor(change) {
		super('change', {cancelable: true})
		this.change = Object.freeze(change)
	}
}

/** Event fired for one or more changed values after the internal state has been updated. */
export class ChangesEvent extends Event {
	/** @param {Change[]} changes */
	constructor(...changes) {
		super('changes')
		this.changes = changes
	}

	/** @return {Map<String,Change[]>} */
	get changesByProperty() {
		const properties = new Map()

		for (const {property, ...change} of this.changes) {
			if (!properties.has(property)) {
				properties.set(property, [])
			} 

			properties.get(property).push(change)
		}

		Object.defineProperty(this, "changesByProperty", {value: properties})
		return properties
	}
}

/**
 * @typedef {Object} Options
 * @field {boolean} children
 * @field {(a: any, b: any) => boolean} same
 */

export class Observable extends EventTarget {
	/** @type Change[]> */
	#queue = []
	#abortController = new AbortController

	#ref = new WeakRef(this)
	get ref() { return this.#ref }

	/**
	 * @param {Object} target
	 * @param {Options} options
	 */
	constructor(target={}, {children=false, same}={}) {
		super()

		Object.defineProperty(this, "observable", {value: true, configurable: false, writable: false})

		abortRegistry.register(this, this.#abortController)

		Object.defineProperty(this, "target", target)

		this.values = new Proxy(target, {
			/**
			 * @param {Object} target
			 * @param {String} property
			 * @param {any} value
			 */
			set: (target, property, value) => {
				const old = target[property]

				if (same ? !same(old, value) : (old !== value)) {
					if (this.enqueue({property, from: old, to: value, mutation: false})) {
						if (children) {
							if (old instanceof Observable) this.disown(property, old)
							if (value instanceof Observable) this.adopt(property, value)
						}
						target[property] = value
					}
				}
				return true
			},
			/**
			 * @param {Object} target
			 * @param {String} property
			 */
			get: (target, property) => target[property],
		})
	}

	#microTaskQueued = false
	/** Queues up a change event
	 * @param {Change} change
	 */
	enqueue(change) {
		if (!this.dispatchEvent(new ChangeEvent(change))) return false

		if (!this.#microTaskQueued) {
			this.#microTaskQueued = true
			queueMicrotask(() => {
				this.#microTaskQueued = false
				this.emitQueue()
			})
		}
		this.#queue.push(change)

		return true
	}

	/** @param {Change[]} changes */
	emit(changes) {
		this.dispatchEvent(new ChangesEvent(...changes))

		if (this.#signals.size || this.#promises.size) {
			for (const change of changes) {
				const {property} = change

				if (this.#signals.has(property)) {
					throw("Fallback signals aren't implemented yet!")
				}

				if (this.#promises.has(property)) {
					const {callback} = this.#promises.get(property)
					this.#promises.delete(property)
					callback(change)
				}
			}
		}
	}

	/** Synchronously emits an event with all queued changes. Does nothing when there are no events. */
	emitQueue() {
		const queue = this.#queue
		if (queue.length) {
			this.emit(queue)
		}
		queue.length = 0
	}

	get collectedSignal() { return this.#abortController.signal }

	/** @type {Number} */
	get changesQueued() { return this.#queue.length }

	/** @type Map<Observable, Map<String, EventListener>> */
	#nested = new Map()

	/** Adopts an observable to be notified of its changes
	 * @param {string} property
	 * @param {Observable} observable
	 */
	adopt(property, observable) {
		let handlers = this.#nested.get(observable)
		if (!handlers) {
			// Actual adoption
			handlers = new Map()
			this.#nested.set(observable, handlers)
		}

		const ref = this.ref

		const handler = () => ref.deref()?.enqueue({property, from: observable, to: observable, mutation: true})

		handlers.set(property, handler)
		observable.addEventListener("changed", handler, {signal: this.collectedSignal})
	}

	/** Undoes the adoption of a nested observable, cancelling the associated event hook
	 * @param {string} property
	 * @param {Observable} observable
	 */
	disown(property, observable) {
		const handlers = this.#nested.get(observable)
		const handler = handlers.get(property)

		observable.removeEventListener("changed", handler)

		handlers.delete(property)
		if (handlers.size == 0) {
			this.#nested.delete(observable)
		}
	}

	/** @type {Map<String,{promise: Promise, callback: (value: any)=>void}>} */
	#promises = new Map()
	// Can't be weak refs because promises are often given callbacks and then forgotten

	/** @param {String} property */
	when(property) {
		const cached = this.#promises.get(property)
		if (cached) return cached[0]

		let callback = undefined
		const promise = new Promise(accept => { callback = accept })

		this.#promises.set(property, {promise, callback})

		return promise
	}

	/** @type {Map<String,FallbackSignal>} */
	#signals = new Map()

	/** @param {String} property */
	signal(property) {
		const cached = this.#signals.get(property)
		if (cached) return cached

		const signal = new FallbackSignal(this, property)
		this.#signals.set(property, signal)
		return signal
	}
}

class FallbackSignal {
	/**
	 * @param {Observable} _observable
	 * @param {String} _property
	 */
	constructor(_observable, _property) {
		throw("Fallback signals aren't implemented yet!")
	}
}

/** @type {WeakMap<Element, Observable>} */
const componentInstanceStates = new WeakMap()

const attributeObserver = new MutationObserver(mutations => {
	for (const {type, target, attributeName: name} of mutations) {
		if (type == "attributes" && target instanceof HTMLElement) {
			const next = target.getAttribute(name)
			const camelName = kebabToCamel(name)
			const state = componentInstanceStates.get(target)
			if (String(state.values[camelName]) !== next)
				state.values[camelName] = next
		}
	}
})

/**
 * @param {String} name
 * @param {(this: HTMLElement, state: Observable) => Node} generator
 * @param {Object<String,Function>} methods
 */
export const component = (name, generator, methods) => {
	if (typeof name === "function") {
		methods = generator
		generator = name
		name = camelToKebab(generator.name)
	}

	const jsName = kebabToCamel(name)
	component[jsName] = class extends HTMLElement{
		/** @type {Observable} */
		state

		constructor() {
			super()
			const target = Object.fromEntries([...this.attributes].map(attribute => [kebabToCamel(attribute.name), attribute.value]))
			this.state = new Observable(target)

			this.state.addEventListener("changed", event => {
				if (event instanceof ChangesEvent)
					for (const {property, to: value} of event.changes) {
						const kebabName = camelToKebab(property)
						if (this.getAttribute(kebabName) !== String(value))
							this.setAttribute(kebabName, value)
					}
			})

			attributeObserver.observe(this, {attributes: true})
			const content = generator.call(this, this.state)
			if (content) this.replaceChildren(content)
		}
	}

	const element = component[jsName]
	if (methods) {
		Object.defineProperties(element.prototype, Object.getOwnPropertyDescriptors(methods))
	}

	customElements.define(name, element)
	return element;
}
