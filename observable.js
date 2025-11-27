/** @type FinalizationRegistry<AbortController> */
const abortRegistry = new FinalizationRegistry(controller => controller.abort())

/** @param {String} string */
const camelToKebab = string => string.replace(/([a-z])([A-Z])/g, (_, a, b) => `${a}-${b}`).toLowerCase()

/** @param {String} string */
const kebabToCamel = string => string.replace(/([a-z])-([a-z])/g, (_, a, b) => a+b.toUpperCase())

/**
 * @typedef {Object} Change
 * @property {string|symbol} property
 * @property {any} from
 * @property {any} to
 * @property {boolean} mutation - The change happened inside the value without a new assignment
 * @property {any} source - The source that caused the change (usually the object setting the value)
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
export class ChangedEvent extends Event {
	/** @param {Change[]} changes */
	constructor(...changes) {
		super('changed')
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

	/** @type {Object} */
	#target

	/** @type {Boolean} */
	#trackChildren = false

	/**
	 * @param {Object} target
	 * @param {Options} options
	 */
	constructor(target={}, {children=false, same}={}) {
		super()

		this.#trackChildren = children
		this.#target = target
		if (typeof same === "function") this.same = same

		abortRegistry.register(this, this.#abortController)

		Object.defineProperty(this, "target", target)

		this.values = new Proxy(target, {
			/**
			 * @param {Object} _
			 * @param {string|symbol} property
			 * @param {any} value
			 * @param {Proxy} receiver
			 */
			set: (_, property, value, receiver) => {
				return this.set(property, value, receiver)
			}
		})

		this.readOnly = new Proxy(target, {
			set(_, prop) {
				throw new TypeError(`Attempting to set property ${String(prop)} on read-only values proxy`)
			}
		})
	}

	/**
	 * @param {any} a
	 * @param {any} b
	 */
	same(a, b) { return a === b }

	/**
	 * @param {string|symbol} property
	 * @param {any} value
	 * @param {any} source
	 */
	set(property, value, source) {
		const target = this.#target

		if (source === undefined) console.warn(`Setting property '${String(property)}' on State without a source:`, {observable: this, value})

		const old = target[property]

		if (!this.same(old, value)) {
			if (this.enqueue({property, from: old, to: value, mutation: false, source})) {
				if (this.#trackChildren) {
					if (old instanceof Observable) this.disown(property, old)
					if (value instanceof Observable) this.adopt(property, value)
				}
				target[property] = value
			} else {
				return false
			}
		}
		return true
	}

	#microTaskQueued = false
	/** Queues up a change event
	 * @param {Change} change
	 * @protected
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

	/**
	 * @param {Change[]} changes
	 * @protected
	 */
	emit(changes) {
		const consolidated = this.consolidate(changes)
		this.dispatchEvent(new ChangedEvent(...consolidated))

		if (this.#states.size || this.#promises.size) {
			const lastForPromises = {}
			const lastForStates = {}

			for (const change of consolidated) {
				const {property} = change

				if (this.#states.has(property)) {
					lastForStates[property] = change.to
				}

				if (this.#promises.has(property)) {
					lastForPromises[property] = change.to
				}
			}

			for (const [property] of Object.entries(lastForStates)) {
				this.#states.get(property).notifyChange(this)
			}

			for (const [property, value] of Object.entries(lastForPromises)) {
				const {callback} = this.#promises.get(property)
				this.#promises.delete(property)
				callback(value)
			}
		}
	}

	/** Override this method in subclasses to filter changes
	 * before dispatching an event, for example by dropping
	 * insignificant changes or even adding new ones.
	 * This method is allowed to mutate the input array.
	 * @param {Change[]} changes
	 * @return {Change[]}
	 */
	consolidate(changes) {
		return changes
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

	/** @type Map<Observable, Map<string|symbol, EventListener>> */
	#nested = new Map()

	/** Adopts an observable to be notified of its changes
	 * @param {string|symbol} property
	 * @param {Observable} observable
	 * @protected
	 */
	adopt(property, observable) {
		let handlers = this.#nested.get(observable)
		if (!handlers) {
			// Actual adoption
			handlers = new Map()
			this.#nested.set(observable, handlers)
		}

		const ref = this.ref

		const handler = () => ref.deref()?.enqueue({property, from: observable, to: observable, mutation: true, source: observable})

		handlers.set(property, handler)
		observable.addEventListener("changed", handler, {signal: this.collectedSignal})
	}

	/** Undoes the adoption of a nested observable, cancelling the associated event hook
	 * @param {string|symbol} property
	 * @param {Observable} observable
	 * @protected
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

	/** @type {Map<string|symbol,{promise: Promise, callback: (value: any)=>void}>} */
	#promises = new Map()
	// Can't be weak refs because promises are often given callbacks and then forgotten

	/** @param {string|symbol} property */
	when(property) {
		const cached = this.#promises.get(property)
		if (cached) return cached[0]

		let callback = undefined
		const promise = new Promise(accept => { callback = accept })

		this.#promises.set(property, {promise, callback})

		return promise
	}

	/** @type {Map<string|symbol,WriteableState>} */
	#states = new Map()

	/** @param {string|symbol} property */
	property(property, {readonly=false}={}) {
		const cached = this.#states.get(property)
		if (cached) return cached

		const state = new PropertyState(this, property, {readonly})
		this.#states.set(property, state)

		return state
	}
}

const valueKey = Symbol("value")

class StateChangedEvent extends Event {
	/**
	 * @param {any} value
	 * @param {any} source
	 */
	constructor(value, source) {
		super("changed")
		this.value = value
		this.source = source
	}
}

/** @template T */
export class State extends EventTarget {
	static dirty = Symbol("dirty")
	static clean = Symbol("clean")
	static orphaned = Symbol("orphaned")
	/** @typedef {State.dirty|State.clean|State.orphaned} state */

	readOnly = true

	static {
		this.prototype[Symbol.for("nyooom:state")] = true
	}

	/**
	 * @template G
	 * @param {G} value
	 * @return {WriteableState<G>}
	 */
	static value(value) { return new WriteableState(value) }

	static compute(fn) { return (...inputs) => new ComputedState(fn, ...inputs) }

	/**
	 * @template G
	 * @param {(value: T) => G} fn
	 * @return {ComputedState<G>}
	 */
	map(fn) { return new ComputedState(fn, this) }

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

	/** @param {any} source */
	notifyChange(source) {
		this.dispatchEvent(new StateChangedEvent(this.value, source))
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

	readOnly = false

	/** @param {T} value */
	set value(value) {
		this.update(value)
	}

	// Doesn't get inherited.
	// mabe the setter overwrites the entire inherited property?
	/** @return {T} */
	get value() {
		return this[valueKey]
	}

	/**
	 * @param {T} value
	 * @param {any} source
	 */
	update(value, source) {
		if (value !== this[valueKey]) {
			this[valueKey] = value
			this.notifyChange(source)
		}
	}
}

/**
 * @template T
 * @class WriteableState
 * @extends State<T>
 */
export class PropertyState extends State {
	/** @type {Observable} */
	#observable

	/** @type {string|symbol} */
	#property

	/** @type {boolean} */
	#readonly = false

	/**
	 * @param {Observable} observable
	 * @param {string|symbol} property
	 */
	constructor(observable, property, {readonly=false}={}) {
		super()
		this.#readonly = readonly
		this.#observable = observable
		this.#property = property
	}

	get readonly() { return this.#readonly }

	/** @param {T} value */
	set value(value) {
		this.update(value)
	}

	// Doesn't get inherited.
	// mabe the setter overwrites the entire inherited property?
	/** @return {T} */
	get value() {
		return this.#observable.values[this.#property]
	}

	/**
	 * @param {T} value
	 */
	update(value) {
		if (this.#readonly) {
			throw(new TypeError("Attempting to update a read-only state"))
		}
		this.#observable.set(this.#property, value, this)
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
			/** @param {StateChangedEvent} event */
			const callback = event => { this.setDirty(event.source) }

			input.addEventListener("changed", callback, eventParams)
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

	/** @param {any} source */
	setDirty(source) {
		this.#state = State.dirty
		this.notifyChange(source)
	}

	get state() { return this.#state }

	get value() {
		if (this.state !== State.clean) {
			if (this.updateValues()) {
				this[valueKey] = this.#fn(...this.#values)
			}
			this.#state = State.clean
		}
		return this[valueKey]
	}

	updateValues() {
		let changed = false
		for (const key in this.#inputs) {
			const state = this.#inputs[key].deref()
			const value = state?.value
			if (state && (value !== this.#values[key])) {
				this.#values[key] = value
				changed = true
			}
		}
		return changed
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

export class ReactiveElement extends HTMLElement {
	constructor() {
		super()
		ReactiveElement.attachObserver(this)
	}

	/**
	 * @param {HTMLElement} element
	 * @returns {Observable}
	 */
	static attachObserver(element) {
		const target = Object.fromEntries([...element.attributes].map(attribute => [kebabToCamel(attribute.name), attribute.value]))
		const observable = new Observable(target)
		componentInstanceStates.set(element, observable)

		observable.addEventListener("changed", event => {
			if (event instanceof ChangedEvent)
				for (const {property, to: value} of event.changes) {
					if (typeof property == "string") {
						const kebabName = camelToKebab(property)
						if (element.getAttribute(kebabName) !== String(value))
							element.setAttribute(kebabName, value)
					}
				}
		})

		attributeObserver.observe(element, {attributes: true})
		return observable
	}

	get state() {
		return componentInstanceStates.get(this)
	}
}

/**
 * @param {String} name
 * @param {(this: HTMLElement, state: Observable) => Node} render
 */
export const component = (render, name) => {
	const htmlName = camelToKebab(name ?? render.name)
	const jsName = kebabToCamel(htmlName)

	class Element extends ReactiveElement {
		static {
			Object.defineProperty(this, "name", {value: jsName})
		}

		render() {
			const content = render.call(this, this.state)
			if (content) this.replaceChildren(content)
		}

		constructor() {
			super()
			this.render()
		}
	}

	customElements.define(htmlName, Element)
	return Element
}
