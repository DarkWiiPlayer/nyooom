export default new Proxy(document, {
	/** @param {string} tag */
	get: (_, tag) => /** @param {any[]} args */ (...args) => {
		let node = document.createElement(tag)
		for (const arg of args) {
			if (arg instanceof HTMLElement) {
				node.append(arg)
			} else if (arg instanceof Object) {
				for (let key in arg) {
					node[key] = arg[key]
				}
			}
		}
		return node
	}
})
