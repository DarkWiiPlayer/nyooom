# Nyooom

```js
import {html} from "nyooom/render"
import {Observable} from "nyooom/observable"

const text = new Observable({value: "Nyooom is cool"})
setTimeout(() => {text.value = "Nyooom is awesome!"}, 1e5)

document.body.append(html.div(
    html.h1("Hello, World!"),
    html.p(text.signal("value"), {class: "amazing"}),
    html.button("Show Proof", {click: event => { alert("It's true!") }})
))
```

## Goals

> Arrakis teaches the attitude of the knife - chopping off what's incomplete and
> saying: "Now, it's complete because it's ended here."
> 
> — Frank Herbert, Dune

Nyooom aims to offer as much convenienve as possible within the following
constraints:

1. Small, independent modules that can also work on their own
1. Easy to figure out by someone who doesn't normally use nyooom
1. Easy to gradually introduce and remove rather than forcing big re-writes
1. Flexible and hackable

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
