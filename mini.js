/**
 * @param {String} name
 * @return {String}
 */
const snakeToHTML = name => name.replace(/([A-Z])/g, "-$1").replace(/^-/, "").toLowerCase()

// @ts-ignore
export default new Proxy(/** @type {Object<string,(...args: any)=>HTMLElement>} */(document), {
	/** @param {string} tag */
	get: (_, tag) => /** @param {any[]} args */ (...args) => {
		let node = document.createElement(snakeToHTML(tag))
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
