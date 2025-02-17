# Nyooom

```js
import {html} from "nyooom/render.js"

document.body.append(
	html.p(
		"This is a paragraph with some text ",
		html.b("and some bold text "),
		html.img({
			alt: "And an image",
			href: "http://picsum.photos/200/200"
		})
	)
)
```

## Goals

1. `nyooom/render` should stay small enough to use it as just a helper library
   to generate some dom nodes in any sort of web environment.
1. `nyooom/observable` should likewise function as a standalone reactive state
   management library to be used with or without a framework
1. A developer who doesn't use nyooom should be able to read any code using it
   and piece together what it does based on structure and function names
1. Nyooom should be easy to gradually introduce into an application that uses
   a different framework or no framework at all
1. Nyooom should make it easy to gradually replace it with a different solution
   should it prove unfit for a project it is being used in
1. The library should be hackable so that developers can tweak it for different
   environments like SSR or frameworks

## Warning

**This branch is in the process of being aggressively refactored and improved.
This readme file may not reflect the latest state of the interface.**

## Overview

```js
const text = new State({value: "Nyooom is cool"})
setTimeout(() => {text.value = "Nyooom is awesome!"}, 1e5)

document.body.append(html.div(
    html.h1("Hello, World!"),
    html.p(text, {class: "amazing"}),
    html.button("Show Proof", {click: event => { alert("It's true!") }})
))
```

## Importmaps

The included file `importmaps.html` can be used as a starting point for
importing `nyooom` via importmaps in a minimal environment. Search-and-replace
`./` to wherever the library should be loaded from if necessary.

## A few more examples:

Create a Button that deletes itself:

```js
document.body.append(
	html.button("Delete Me", {click: event => event.target.remove()})
)
```

Turn a two-dimensional array into an HTML table:
```js
const table = rows =>
	html.table(html.tbody(rows.map(
		row => html.tr(row.map(
			cell => html.rd(cell, {dataset: {
				content: cell.toLowerCase(),
			}})
		))
	)))
```

A list that you can add items to
```js
let list, input = ""
document.body.append(html.div([
	list=html.ul(),
	html.input({type: 'text', input: e => input = e.target.value}),
	html.button({click: event => list.append(html.li(input))}, "Add"),
]))
```

A list that you can also delete items from
```js
const listItem = content => html.li(
	html.span(content), " ", html.a("[remove]", {
		click: event => event.target.closest("li").remove(),
		style: { cursor: 'pointer', color: 'red' },
	})
)
let list, input = ""
document.body.append(html.div([
	list=html.ul(),
	html.input({type: 'text', input: e => input = e.target.value}),
	html.button({click: event => list.append(listItem(input))}, "Add"),
]))
```
