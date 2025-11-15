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

	static get new() { throw new Error("Attempting to call 'new' as a class method; this is JavaScript, you absolute imbecile!") }

	/**
	 * @param {Object} target
	 * @param {Options} options
	 */
	constructor(target={}, {children=false, same}={}) {
		super()

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
			}
		})

		this.readOnly = new Proxy(target, {
			set(_, prop) {
				throw new TypeError(`Attempting to set property ${String(prop)} on read-only values proxy`)
			}
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

		if (this.#states.size || this.#promises.size) {
			for (const change of changes) {
				const {property} = change

				if (this.#states.has(property)) {
					const pair = this.#states.get(property)
					pair.update(change.to)
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

	/** @type {Map<String,readOnlyPair<any>>} */
	#states = new Map()

	/** @param {String} property */
	state(property) {
		const cached = this.#states.get(property)
		if (cached) return cached

		const pair = State.readOnly(this.values[property])
		this.#states.set(property, pair)
		return pair.state
	}
}

const valueKey = Symbol("value")

/** @template T */
export class State extends EventTarget {
	static dirty = Symbol("dirty")
	static clean = Symbol("clean")
	static orphaned = Symbol("orphaned")
	/** @typedef {State.dirty|State.clean|State.orphaned} state */

	/**
	 * @template G
	 * @param {G} value
	 * @return {WriteableState<G>}
	 */
	static value(value) { return new WriteableState(value) }

	static compute(fn) { return (...inputs) => new ComputedState(fn, ...inputs) }

	/** @template G
	 * @typedef {{state: State<G>, update: (value: G)=>void}} readOnlyPair
	 */

	/**
	 * @template G
	 * @param {G} value
	 * @return {readOnlyPair<G>}
	 */
	static readOnly(value) {
		/** @type {State<G>} */
		const state = new State()
		state[valueKey] = value
		/** @param {G} newValue */
		const update = newValue => {
			state[valueKey] = newValue
			state.notifyChange()
		}
		return {state, update}
	}

	/** @type {AbortSignal} */
	collectedSignal

	constructor() {
		super()
		const controller = new AbortController()
		abortRegistry.register(this, controller)
		Object.defineProperty(this, "collectedSignal", {value: controller.signal, writable: false, configurable: false})
	}

	/**
	 * @type {T}
	 * @protected
	 */
	[valueKey]

	/** @return {T} */
	get value() {
		return this[valueKey]
	}

	notifyChange() {
		this.dispatchEvent(new CustomEvent("change"))
	}

	/** @return {state} */
	get state() { return State.clean }
}

/**
 * @template T
 * @class WriteableState
 * @extends State<T>
 */
class WriteableState extends State {
	/** @param {T} value */
	constructor(value) {
		super()
		this[valueKey] = value
	}

	/** @param {T} value */
	set value(value) {
		if (value !== this[valueKey]) {
			this[valueKey] = value
			this.notifyChange()
		}
	}
}

/** @template {object} T */
class RevocableRef {
	/** @param {T} target */
	constructor(target) {
		this.target = target
	}
	/** @return {T} */
	deref() { return this.target }
	revoke() { this.target = undefined }
}

/**
 * @template {object} T
 * @typedef {WeakRef<T>|RevocableRef<T>} Ref
 */

/** @template T */
class ComputedState extends State {
	/** @type {(...args: any[]) => T} */
	#fn

	/** @type {Ref<State<any>>[]} */
	#inputs

	#state = State.dirty

	/** @type {any[]} */
	#values

	/**
	 * @param {(...args: any[]) => T} fn
	 * @param {State[]} inputs
	 */
	constructor(fn, ...inputs) {
		super()
		const eventParams = {signal: this.collectedSignal}

		this.#fn = fn
		this.#values = new Array(inputs.length)
		this.#inputs = inputs.map(input => {
			input.addEventListener("change", () => { this.setDirty() }, eventParams)
			if (input instanceof ComputedState) {
				const ref = new RevocableRef(input)
				input.addEventListener("orphaned", () => {
					this.checkOrphaned()
					ref.revoke()
				}, eventParams)
				return ref
			} else {
				const ref = new WeakRef(input)
				input.collectedSignal.addEventListener("abort", () => {
					this.checkOrphaned()
				}, eventParams)
				return ref
			}
		})
	}

	checkOrphaned() {
		for (const ref of this.#inputs) {
			if (ref.deref()) {
				return false
			}
		}
		this.#state = State.orphaned
		this.dispatchEvent(new CustomEvent("orphaned"))
		return true
	}

	setDirty() {
		this.#state = State.dirty
		this.notifyChange()
	}

	get state() { return this.#state }

	get value() {
		if (this.state !== State.clean) {
			if (this.checkChanges()) {
				this[valueKey] = this.#fn(...this.#inputs.map((ref, index) => {
					const state = ref.deref()
					if (state) {
						return state.value
					} else {
						return this.#values[index]
					}
				}))
			}
			this.#state = State.clean
		}
		return this[valueKey]
	}

	checkChanges() {
		for (const key in this.#inputs) {
			if (this.#inputs[key] !== this.#values[key]) return true
		}
		return false
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
