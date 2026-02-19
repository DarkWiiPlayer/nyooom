/** @typedef {Promise & {signal: AbortSignal}} PromiseWithSignal */
/** @typedef {(element: HTMLElement, detached: PromiseWithSignal) => void} Callback */
/** @typedef {new (element: HTMLElement, detached: PromiseWithSignal) => Object} ControllerClass */
/** @typedef {Callback|ControllerClass} Controller */

// Keep a referee alive until a referrer is collected
const weakReferences = new WeakMap()

/** Keeps the referenced value alive until the referrer is collected
 * @param {Object} referrer
 * @param {Object} reference
 */
const untilDeathDoThemPart = (referrer, reference) => {
	if (!weakReferences.has(referrer)) weakReferences.set(referrer, new Set())
	weakReferences.get(referrer).add(reference)
}

export class ControllerList {
	/** @type {HTMLElement} */
	#element

	/** @type {string} */
	#attribute

	/**
	 * @param {HTMLElement} element
	 * @param {string} attribute
	 * */
	constructor(element, attribute="controller") {
		this.#element = element
		this.#attribute = attribute
	}

	get #set() {
		return new Set(this.#element.getAttribute(this.#attribute)?.split(" ") ?? [])
	}

	set #set(set) {
		this.#element.setAttribute(this.#attribute, [...set].join(" "))
	}

	/** @param {string} name */
	contains(name) {
		return this.#set.has(name)
	}

	/** @param {string} name */
	add(name) {
		this.toggle(name, true)
	}

	/** @param {string} name */
	remove(name) {
		this.toggle(name, false)
	}

	/**
	 * @param {string} name
	 * @param {string} replacement
	 */
	replace(name, replacement) {
		const set = this.#set
		if (set.has(name)) {
			set.delete(name)
			set.add(replacement)
			this.#set = set
			return true
		} else {
			return false
		}
	}

	/**
	 * @param {string} name
	 * @param {Boolean} force
	 */
	toggle(name, force) {
		const set = this.#set
		if (force === true) {
			if (!set.has(name)) {
				set.add(name)
				this.#set = set
			}
		} else if (force === false) {
			if (set.has(name)) {
				set.delete(name)
				this.#set = set
			}
		} else {
			if (set.has(name)) set.delete(name)
				else set.add(name)
			this.#set = set
		}
	}
}

export class ControllerRegistry {
	#observer = new MutationObserver(mutations => {
		for (const mutation of mutations) {
			if (mutation.type === "childList") {
				for (const node of mutation.addedNodes) if (node instanceof HTMLElement) {
					this.upgrade(node)
				}
				for (const node of mutation.removedNodes) if (node instanceof HTMLElement) {
					this.#downgrade(node)
				}
			} else if (mutation.target instanceof HTMLElement) {
				this.#update(mutation.target)
			}
		}
	})

	/** @type {WeakMap<HTMLElement,Map<string,Object>>} */
	#attached = new WeakMap()

	/** @type {Map<string,Set<HTMLElement>>} */
	#waiting = new Map()

	/** @type {Map<string,Callback>} */
	#defined = new Map()

	/** @type {Map<string,Controller>} */
	#lookup = new Map()
	/** @type {Map<Controller,string>} */
	#nameLookup = new Map()

	#attribute

	/** @typedef {Document|DocumentFragment|HTMLElement} Root */

	/**
	 * @param {Root} root
	 * @param {string} attribute
	 */
	constructor(root, attribute="controller") {
		untilDeathDoThemPart(root, this)
		this.#attribute = attribute
		this.#observer.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: [attribute], attributeOldValue: false})
		this.upgrade(root)
	}

	/**
	 * @param {Root} root
	 */
	upgrade(root) {
		if (root instanceof HTMLElement) this.#update(root)
		for (const element of root.querySelectorAll(`[${this.#attribute}]`)) {
			this.#update(/** @type {HTMLElement} */(element))
		}
	}

	/**
	 * @param {Root} root
	 */
	#downgrade(root) {
		if (root instanceof HTMLElement) this.#clear(root)
		for (const element of root.querySelectorAll(`[${this.#attribute}]`)) {
			this.#clear(/** @type {HTMLElement} */(element))
		}
	}

	/**
	 * @param {string} name
	 * @param {Controller} callback
	 */
	define(name, callback) {
		if (this.#nameLookup.has(callback)) console.warn(`Redefining controller ${this.#nameLookup.get(callback)} under new name ${name}:`, callback)

		this.#lookup.set(name, callback)
		this.#nameLookup.set(callback, name)

		if (("function" == typeof callback) && callback.prototype) {
			callback = async (element, disconnected) => {
				const {proxy, revoke} = Proxy.revocable(element, {})
				const controller = new /** @type {ControllerClass} */(callback)(proxy, disconnected)
				await disconnected
				revoke()
				if ("detach" in controller) controller.detach(element)
			}
		}

		this.#defined.set(name, /** @type {Callback} */(callback))

		const waitingList = this.#waiting.get(name)

		if (waitingList) for (const element of waitingList) {
			this.#attach(element, name)
		}
		this.#waiting.delete(name)

		if (this.#whenDefined.has(name)) {
			this.#whenDefined.get(name)[1]?.()
		}
	}

	/** Gets a controller associated with a given name
	 * @param {string} name
	 */
	get(name) {
		return this.#lookup.get(name)
	}

	/** Gets the name a controller is registered with
	 * @param {Controller} controller
	 */
	getName(controller) {
		return this.#nameLookup.get(controller)
	}

	/** @type {Map<string,[Promise, ()=>void]>} */
	#whenDefined = new Map()
	/**
	 * @param {string} name
	 */
	whenDefined(name) {
		if (!this.#whenDefined.has(name)) {
			if (this.#defined.has(name)) {
				this.#whenDefined.set(name, [Promise.resolve(), undefined])
			} else {
				let resolve
				const promise = new Promise(_resolve => {resolve = _resolve})
				this.#whenDefined.set(name, [promise, resolve])
			}
		}
		return this.#whenDefined.get(name)[0]
	}

	/** @type {WeakMap<HTMLElement,ControllerList>} */
	#listMap = new WeakMap()
	/**
	 * @param {HTMLElement} element
	 * @return {ControllerList}
	 */
	list(element) {
		if (this.#listMap.has(element)) {
			return this.#listMap.get(element)
		} else {
			const list = new ControllerList(element, this.#attribute)
			this.#listMap.set(element, list)
			return list
		}
	}

	/** @param {HTMLElement} element */
	attached(element) {
		const attached = this.#attached.get(element)
		if (attached)
			return [...attached.entries().filter(pair => pair[1]).map(pair => pair[0])]
			else
			return []
	}

	/** @param {HTMLElement} element */
	#update(element) {
		const names = this.#getControllerNames(element)
		const attached = this.#attached.get(element)
		if (attached) {
			const current = new Set(names)
			for (const [name] of attached) {
				if (!current.has(name)) {
					this.#detach(element, name)
				}
			}
		}

		for (const name of names) this.#attach(element, name)
	}

	/** @param {HTMLElement} element */
	#clear(element) {
		const attached = this.#attached.get(element)
		if (attached) {
			for (const [name] of attached) {
				this.#detach(element, name)
			}
		}
	}

	/**
	 * @param {HTMLElement} element
	 * @param {string} name
	 */
	#attach(element, name) {
		if (!this.#attached.has(element)) this.#attached.set(element, new Map())
		const attached = this.#attached.get(element)

		const callback = this.#defined.get(name)

		if (callback) {
			if (attached.has("name") && attached.get("name")) return console.warn(`Controller ${name} already fully attached`, element)
			const abortController = new AbortController()
			const promise = new Promise(resolve => abortController.signal.addEventListener("abort", () => resolve()))
			Object.defineProperty(promise, "signal", {value: abortController.signal})
			try {
				callback(element, /** @type {PromiseWithSignal} */(promise))
				attached.set(name, abortController)
			} catch(error) {
				console.error(error)
			}
		} else {
			if (attached.has("name")) return console.warn(`Controller ${name} already attached`, element)
			attached.set(name, undefined)
			let waitingList = this.#waiting.get(name)
			if (!waitingList) {
				waitingList = new Set()
				this.#waiting.set(name, waitingList)
			}
			waitingList.add(element)
		}
	}

	/**
	 * @param {HTMLElement} element
	 * @param {string} name
	 */
	#detach(element, name) {
		const references = this.#attached.get(element)
		if (!references || !references.has(name)) return console.warn(`Controller ${name} not attached`, element)

		references.get(name)?.abort()
		references.delete(name)
	}

	/** @param {HTMLElement} element */
	#getControllerNames(element) {
		return new Set(element.getAttribute(this.#attribute)?.split(" ") ?? [])
	}
}

ControllerRegistry
