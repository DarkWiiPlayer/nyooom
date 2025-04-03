/** @type FinalizationRegistry<AbortController> */
const abortRegistry = new FinalizationRegistry(controller => controller.abort())

/** @param {String} string */
const camelToKebab = string => string.replace(/([a-z])([A-Z])/g, (_, a, b) => `${a}-${b}`).toLowerCase()
/** @param {String} string */
const kebabToCamel = string => string.replace(/([a-z])-([a-z])/g, (_, a, b) => a+b.toUpperCase())

const identity = object=>object

const target = Symbol("Proxy Target")

/* Custom Event Classes */

/**
 * @typedef {Object} Change
 * @property {string} property
 * @property {any} from
 * @property {any} to
 * @property {boolean} mutation - The change happened inside the value without a new assignment
 */

/** Event fired for every change before the internal state has been updated that can be canceled. */
export class ChangeEvent extends Event {
	/** @param {Change} change */
	constructor(change) {
		super('change', {cancelable: true})
		this.change = Object.freeze(change)
	}
}

/** Event fired for one or more changed values after the internal state has been updated. */
export class ChangedEvent extends Event {
	/** @type {any} */
	#final
	/** @type {any} */
	#values

	/** @param {Change[]} changes */
	constructor(...changes) {
		super('changed')
		this.changes = changes
	}

	get values() {
		if (!this.#values) {
			const values = new Map()
			for (const {property, from, to} of this.changes) {
				let list = values.get(property)
				if (!list) {
					list = [from]
					values.set(property, list)
				}
				list.push(to)
			}
			this.#values = values
		}
		return this.#values
	}

	get final() {
		if (!this.#final) {
			this.#final = new Map()
			for (const [property, list] of this.values) {
				if (list[0] !== list[list.length-1]) {
					this.#final.set(property, list[list.length-1])
				}
			}
		}
		return this.#final
	}
}

export class Observable extends EventTarget {
	#synchronous
	/** @type Change[]> */
	#queue
	#abortController = new AbortController

	#ref = new WeakRef(this)
	get ref() { return this.#ref }

	constructor({synchronous=false}={}) {
		super()
		Object.defineProperty(this, "observable", {value: true, configurable: false, writable: false})

		if (this.constructor === Observable) {
			throw new TypeError("Cannot instantiate abstract class")
		}
		this.#synchronous = !!synchronous
		abortRegistry.register(this, this.#abortController)

		this.proxy = new Proxy(this.constructor.prototype.proxy, {
			get: (target, prop) => target.call(this, prop)
		})
	}

	/** @param {Change[]} changes */
	emit(...changes) {
		this.dispatchEvent(new ChangedEvent(...changes))
	}

	/**
	 * @param {string} prop
	 */
	proxy(prop, {get=undefined, set=undefined, ...options}={}) {
		const proxy = new ProxiedObservableValue(this, prop, options)
		if (get) proxy.get = get
		if (set) proxy.set = set
		return proxy
	}

	/**
	 * @param {string} prop
	 * @param {function(any):void} callback
	 */
	subscribe(prop, callback) {
		const controller = new AbortController()
		// @ts-ignore
		this.addEventListener("change", ({final}) => {
			if (final.has(prop)) return callback(final.get(prop))
		}, {signal: controller.signal})

		callback(this[prop])
		return () => controller.abort()
	}

	/** Queues up a change event
	 * @param {string} property - Name of the changed property
	 * @param {any} from
	 * @param {any} to
	 * @param {boolean} mutation - whether a change was an assignment or a mutation (nested change)
	 */
	enqueue(property, from, to, mutation=false) {
		const change = {property, from, to, mutation}
		if (!this.dispatchEvent(new ChangeEvent(change))) return false

		if (!this.synchronous) {
			if (!this.#queue) {
				this.#queue = []
				queueMicrotask(() => {
					this.emit(...this.#queue)
					this.#queue = undefined
				})
			}
			this.#queue.push(change)
		} else {
			this.emit(change)
		}
		return true
	}

	get signal() { return this.#abortController.signal }
	get synchronous() { return this.#synchronous }

	get changesQueued() { return Boolean(this.#queue) }
}

export class ObservableObject extends Observable {
	/**
	 * @param {Object} target
	 * @param {Object} options
	 */
	constructor(target={}, {shallow=true, ...options}={}) {
		super(options)
		Object.defineProperty(this, "target", target)
		this.values = new Proxy(target, {
			/**
			 * @param {Object} target
			 * @param {String} prop
			 * @param {any} value
			 */
			set: (target, prop, value) => {
				const old = target[prop]
				if (old === value) {
					return true
				} else {
					if (this.enqueue(prop, old, value)) {
						if (!shallow) {
							if (old instanceof Observable) this.disown(prop, old)
							if (value instanceof Observable) this.adopt(prop, value)
						}
						target[prop] = value
						return true
					} else {
						return false
					}
				}
			},
			/**
			 * @param {Object} target
			 * @param {String} prop
			 */
			get: (target, prop) => target[prop],
		})
	}

	/**
	 * @param {string} prop
	 * @param {Object} options
	 */
	proxy(prop, {get=undefined, set=undefined, ...options}={}) {
		const proxy = new ProxiedObservableValue(this, prop, {values: this.values, ...options})
		if (get) proxy.get = get
		if (set) proxy.set = set
		return proxy
	}

	/** @type Map<Observable, Map<String, Function>> */
	#nested = new Map()

	/** Adopts an observable to be notified of its changes
	 * @param {string} prop
	 * @param {Observable} observable
	 */
	adopt(prop, observable) {
		let handlers = this.#nested.get(observable)
		if (!handlers) {
			// Actual adoption
			handlers = new Map()
			this.#nested.set(observable, handlers)
		}
		const ref = this.ref
		const handler = () => ref.deref()?.emit(prop, observable, observable, {observable: true})

		handlers.set(prop, handler)
		observable.addEventListener("changed", handler, {signal: this.signal})
	}

	/** Undoes the adoption of a nested observable, cancelling the associated event hook
	 * @param {string} prop
	 * @param {Observable} observable
	 */
	disown(prop, observable) {
		const handlers = this.#nested.get(observable)
		const handler = handlers.get(prop)
		observable.removeEventListener("changed", handler)
		handlers.delete(prop)
		if (handlers.size == 0) {
			this.#nested.delete(observable)
		}
	}
}

export class ObservableValue extends Observable {
	#value

	/**
	 * @param {any} value
	 * @param {Object} options
	 */
	constructor(value, options) {
		super(options)
		this.#value = value
	}

	get value() { return this.#value }
	set value(value) {
		if (this.enqueue("value", this.#value, value)) {
			this.#value = value
		}
	}

	/**
	 * @param {(value: any) => any} func
	 */
	transform(func) {
		return new Composition(func, {}, this)
	}

	proxy(methods) {
	}
}

class ProxiedObservableValue extends ObservableValue {
	#values
	#prop

	/**
	 * @param {Observable} backend
	 * @param {string} prop
	 */
	constructor(backend, prop, {values=backend, ...options}={}) {
		super(options)
		this.#values = values
		this.#prop = prop

		const ref = this.ref
		backend.addEventListener("change", event => {
			const {property, from, to, ...rest} = event.change
			if (property == this.#prop) {
				ref.deref()?.enqueue({
					property,
					from: this.get(from),
					to: this.get(to),
					...rest
				})
			}
		}, { signal: this.signal })
	}

	get = identity
	set = identity

	get value() { return this.get(this.#values[this.#prop]) }
	set value(value) { this.#values[this.#prop] = this.set(value) }
}

const attributeObserver = new MutationObserver(mutations => {
	for (const {type, target, attributeName: name} of mutations) {
		if (type == "attributes" && target instanceof HTMLElement) {
			const next = target.getAttribute(name)
			const camelName = kebabToCamel(name)
			if (String(target.state.values[camelName]) !== next)
				target.state.values[camelName] = next
		}
	}
})

export const component = (name, generator, methods) => {
	if (typeof name === "function") {
		methods = generator
		generator = name
		name = camelToKebab(generator.name)
	}
	const jsName = kebabToCamel(name)
	component[jsName] = class extends HTMLElement{
		/** @type {ObservableObject} */
		state

		constructor() {
			super()
			const target = Object.fromEntries([...this.attributes].map(attribute => [kebabToCamel(attribute.name), attribute.value]))
			this.state = new ObservableObject(target)
			this.state.addEventListener("changed", event => {
				if (event instanceof ChangedEvent)
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

class Composition extends ObservableValue {
	#func
	#states

	/**
	 * @param {(...values: any[]) => any} func
	 * @param {Object} options
	 * @param {Observable[]} states
	 */
	constructor(func, options, ...obesrvables) {
		super(options)

		this.#func = func
		this.#states = obesrvables

		const abortController = new AbortController()
		abortRegistry.register(this, abortController)
		const ref = new WeakRef(this)

		obesrvables.forEach(state => {
			state.addEventListener("changed", () => {
				ref.deref()?.update()
			}, {signal: abortController.signal})
		})

		this.update()
	}

	update() {
		const value = this.#func(...this.#states.map(state => state.value))
		this.value = value
	}
}

/**
 * @param {Function} func
 */
export const compose = func =>
	/**
	 * @param {Observable[]} observables
	 */
	(...observables) =>
		new Composition(func, {}, ...observables)
