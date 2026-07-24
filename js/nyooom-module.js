import {html, nothing} from "nyooom/render"

const kb = (text, ...values) => {
	const buf = []
	for (let index in text) {
		buf.push(text[index])
		const value = values[index]
		if (typeof value === "number") {
			if (value > 1024)
				buf.push(`${Math.round(value / 102.4) / 10} kB`)
			else
				buf.push(`${value} bytes`)
		} else {
			buf.push(value)
		}
	}
	return buf.join("")
}

const mutationObserver = new MutationObserver(mutations => {
	for (const {target} of mutations) {
		if (target instanceof NyooomModule) {
			target.render()
		}
	}
})

export class NyooomModule extends HTMLElement {
	#internals = this.attachInternals()

	constructor() {
		super()

		mutationObserver.observe(this, {childList: true, subtree: true})
		this.attachShadow({mode: "open"})

		this.render()
	}

	/** @type {AbortController|undefined} */
	#rendering

	async render() {
		this.#rendering?.abort()

		this.#rendering = new AbortController()

		const result = await fetch(this.url)
		const cdn_size = Number(result.headers.get("content-length"))
		const text = await result.text()
		const min_size = text.length

		this.#internals.shadowRoot?.replaceChildren(
			html.span(
				`nyooom/${this.moduleName}: `,
				kb`${min_size} minified (${cdn_size} served compressed via CDN)`,
				{style: {fontSize: ".8em"}}
			)
		)

		this.#rendering = undefined
	}

	get moduleName() {
		return this.innerHTML
	}

	get url() {
		return `https://cdn.jsdelivr.net/gh/darkwiiplayer/nyooom/${this.moduleName}.min.js`
	}
}
