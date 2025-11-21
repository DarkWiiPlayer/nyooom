# DOM-Manipulation with `domProxy.js`

```js
import * as DomProxy from "nyooom/domProxy.js"
```

## DOM-Array

DOM-Arrays provide an array-like wrapper over an element's children.

The `DomProxy.array` function itself takes an object defining proxy methods and
returns the real proxy factory which can be re-used on different elements.

As a shortcut, the function can be called with two arguments, an element and the
proxy methods, to return a singleton DOM-Array in a single call.

```js
const listArray = DomProxy.array({
	get() { return this.innerText },
	set(text) { this.innerText = text },
	new(text) { html.li(text) }
})

const list = html.ul()
const cats = listArray(list)

list.push("Tiger")
list.push("Ocelot")
list.push("Snow Leopard")

console.log(list) // HTML-List with three items
```

### Proxy methods

The following three methods can be passed to the DOM-Array factory to identify
how to interact with the children:

- `get`: Called as a method on the element to get its return value. Defaults to
  returning the element itself.
- `set`: Called as a method on the element with a new value as its only argument
  to update the element's value to it. Defaults to failing.
- `new`: Called as a method on the container element to create a new child
element. The initial value is passed in as an argument. Defaults to fail.

Failing to set a property means the proxy trap returns `false`, which is ignored
normally but throws an error in strict mode.

Note: When creating items at specific indices beyond the current element count,
the proxy will first fill the container with empty elements up to that index by
calling the `new` method without arguments. The method should either be able  to
handle `undefined` values, or throw an error with a helpful message if
unsupported.

It is also assumed that `new` will set the value on the new element as it is
created rather than calling `set` on it.

## Meta

Called immediately on a container element (default: document head), this proxy
abstracts a document's `<meta>`-tags as an object, where property names are
mapped to the meta tag's `name` attribute and the corresponding value to its
`value` attribute.

The proxy supports creating and deleting meta tags as well as reading and
deleting nested meta tags. New meta tags are appended to the end of the
container element.
