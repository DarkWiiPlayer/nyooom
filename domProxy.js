/** @typedef {string|symbol} name */

export const array = (methods, extra) => {
	if (extra) return array(extra)(methods)

	const traps = {
		/**
		 * @param {HTMLElement} target
		 * @param {name} prop
		 * @return {any}
		 */
		get(target, prop) {
			if (prop === "length") {
				return target.children.length
			} else if (prop === Symbol.iterator) {
				return function*() {
					for (const child of target.children) {
						yield methods.get.call(child)
					}
				}
			} else if ((typeof prop === "string") && prop.match?.call(prop, /^[0-9]+$/)) {
				const child = target.children[prop]
				if (child && methods.get) return methods.get.call(child)
				return child
			} else {
				return Array.prototype[prop]
			}
		},
		/**
		 * @param {HTMLElement} target
		 * @param {name} prop
		 * @param {any} value
		 * @return {any}
		 */
		set(target, prop, value) {
			if ((typeof prop === "string") && prop.match?.call(prop, /^[0-9]+$/)) {
				const child = target.children[prop]
				if (child) {
					methods.set.call(child, value)
					return true
				} else {
					for (let i = target.children.length; i < Number(prop); i++) {
						target.appendChild(methods.new())
					}
					const element = methods.new(value)
					target.appendChild(element)
					if (methods.get.call(element) !== value) {
						methods.set.call(element, value)
						return true
					} else {
						return true
					}
				}
			} else if (prop == "length") {
				const length = target.children.length
				const targetLength = Number(value)

				if (isNaN(targetLength) || targetLength < 0 || (targetLength % 1 !== 0)) throw new RangeError("invalid array length")

				console.log(targetLength, length)
				if (targetLength < length) {
					for (const element of Array.from(target.children).slice(targetLength)) {
						element.remove()
					}
				} else if (value > length) {
					for (let i = length; i < targetLength; i++) {
						target.appendChild(methods.new())
					}
				}
				return true
			}
		},
		/**
		 * @param {HTMLElement} target
		 * @param {name} prop
		 */
		deleteProperty(target, prop) {
			if ((typeof prop === "string") && prop.match?.call(prop, /^[0-9]+$/)) {
				const child = target.children[prop]
				if (child) child.remove()
				return true
			}
		},
		has(target, prop) {
			return (prop === Symbol.iterator) || (prop in target.children) || (prop in Array.prototype)
		}
	}

	return element => {
		if (!(element instanceof Element)) throw(new Error("Creating DOM-Array on non-element"))
		return new Proxy(element, traps)
	}
}

export const meta = (element = document.head) => new Proxy(element, {
	get: (target, name) => target.querySelector(`meta[name="${name}"]`)?.content,
	set: (target, name, value) => {
		let meta = target.querySelector(`meta[name="${name}"]`)
		if (!meta) {
			meta = document.createElement("meta")
			meta.name = name
			target.append(meta)
		}
		meta.content = value
		return true
	},
	deleteProperty(target, prop) {
		for (const meta of target.querySelectorAll(`meta[name="${name}"]`)) {
			meta.remove()
		}
		return true
	}
})
