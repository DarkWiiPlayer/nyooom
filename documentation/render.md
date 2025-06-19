# Rendering DOM nodes using `render.js`

```js
import {html} from "nyooom/render.js"
```

A functional-friendly helper library for procedural DOM generation and templating, with support for reactive state objects.

## Summary

```js
html.button(
	"Click Me!",
	{
		class: "primary",
		click({target}) {
			console.log("User clicked", target)
		}
	},
	button => { console.log("Created", button) }
)
```

* elements as factory functions `content -> element`
* content as arguments or in arrays
* attributes in object arguments
* style, dataset, shadow root, etc. as magic attributes
* events as function attributes
* initialisers as `any -> void` functions

## Interface / Examples

### Basic DOM generation

Accessing the `html` proxy with any string key returns a new node generator function.
When called this function will generate a DOM node (HTML Tag).
The name of the function becomes the tag name of the node.

```js
html.div()
```

Content and attributes can be set via the function arguments:
Strings and DOM nodes are inserted as children, while other objects (except for some special cases) have their key-value pairs turned into attribute-value pairs on the 

```js
html.div("Big Text", {style: "font-size: 1.4em"})
```

Arrays are iterated and their values treated as arguments.
This works both for inserting children and setting attributes.

```js
const content = [" ps: hi", {class: "title"}]
html.h1({id: "main-heading"}, "Heading", content)
```

Function arguments are treated differently depending on their length:]
Functions with **no** named parameters are called, and their return value is then evaluated just like an argument to the generator.

All other functions are (immediately) called with the newly created node as their first and only argument.
These can be used to initialise the new node in a point-free style.

```js
const hello = () => html.bold("Hello, World!")
const init = node => console.log("Initialising", node)
html.div(hello, init)
```

Nested tags can be generated with nested function calls.
When properly formatted, this means simpler templates will have the same structure as if written in HTML (sans those pesky closing tags).

```js
html.div(
    html.p(
        html.b("Bold Text")
    )
)
```

### Attribute Processing

For convenience, arrays assigned as attributes will be joined with spaces:

```js
html.a({class: ["button", "important"]})
```

Assigning a function as an attribute will instead attach it as an event listener:

```js
html.button("Click me!", {click: event => {
    alert("You clicked the button.")
}})
```

The special `style` property can be set to an object and its key/value pairs will be inserted as CSS properties on the element's `style` object.

```js
const style = { color: "salmon" }
html.span("Salmon", { style })
```

The special property `shadowRoot` will attach a shadow-DOM to the element if none is present and append its content to the shadow root.
Arrays are iterated over and their elements appended individually.

```js
html.div({
   shadowRoot = ["Hello, ", html.b("World"), "!"]
})
```

The `dataset` property will add its key/value pairs to the new node's `dataset`,
as a more convenient alternative to setting individual `data-` attributes.

```js
const dataset = { foo: "bar" }
const div = html.div({dataset})
console.log(dataset.foo === div.dataset.foo)
console.log(div.getAttribute("data-foo") === "bar")
```

### Reactivity

Nyooom supports reactivity through a simple protocol:

Observable objects identify themselves with the `observable` attribute,
which must return a truthy value.

Observables are expected to expose a `value` attribute that is both readable and writeable,
and to emit a "change" event whenever its vale has changed.

Observables can be passed to nyooom's node functions as both
attribute values (values in an object) or
child elements (direct arguments or in an array).

#### Reactive Children

Passing an observable as a child element will attempt to insert its current
value into the new node as if it was passed in directly, but will also hook into
the observable to replace the value when the state changes.

```js
const state = new Observable.value(0)

const button = html.button(state, {
	click(event) { state.value++ }
})
```

Note that to keep the replacement logic simple, it is not currently possible to
insert use document fragments, as these could insert several top-level children
into a component that would then all have to be replaced. When an observable
contains or changes to a document fragment, nyooom will raise an error.

Before replacing an element, a `"replace"` event is emitted from the old
element. This event bubbles and is cancelable, and can thus be used both to
completely prevent the replacement according to custom logic, to alter or
initialise the new element before it is inserted, or even to modify the old
object instead of replacing it.

#### Reactive Attributes

Passing an observable as an object value will, likewise, treat its value as the
attribute value, and update it whenever the state's value changes.

```js
const state = new Observable.value(0)

const input_1 = html.input({ type: "number", value: state })
const input_2 = html.input({ type: "number", value: state })
```

## Helpers

### Wrapper

Sometimes writing entire sections in a functional style is a bit inconvenient,
and a side-effect based style would be better.

This is possile using the `wrapper` helper method on the DomRenderers

```js
const h = DomHtmlRenderer.wrapper

const content = h(fragmet => {
	fragment.h1("Functions have side effects")
	fragment.p("There is no special functionality for nested nodes:")
	fragment.ul(h(ul => {
		ul.li("Foo")
		ul.li("Bar")
		ul.li("Baz")
	}))
	fragment.p("However, it is quite easy to add ", html.b("nested elements"))
})
```

Wrappers create a document fragment, call the passed in function with a special
proxy that, itself, wraps the render proxy of the Renderer object, but has its
return values added to the fragment, then finally returns the document fragment.

This means that the methods on the helper take the same arguments as described
above, but append their results to a buffer instead of returning them. This
makes it very easy to comine both rendering styles as needed.

There is currently no export for a default HTML renderer wrapper, but this is
planned for the future once an appropriate name has been found.

### Empty Values

Nyooom will produce a warning when it encounters `undefined` as an argument to a
node factory, and skip it.

When completely ommitting the argument would make code more complicated, the
`nothing` export can be used instead, and will be completely ignored by nyooom:

```js
import {html, nothing} from "nyooom/render"

const value = undefined

html.div(value ? html.p(value) : nothing) // <div></div>
```

### Event Handlers

Event handlers often need to call `preventDefault()` and `stopPropagation()` on
the event. To save a bit of typing, the wrapper functions `noDefault` and
`noPropagation` take a function `event => void` and wrap it in a function that
first calls the corresponding method on the event:

```js
html.form(
	html.button("Click me!", click: noDefault(() => console.log("Clicked!")))
)
```

### DOM-Fragments

The `fragment` helper function collects a list of DOM nodes from its arguments
into a new document fragment, so they can more easily be processed as a group
and inserted elsewhere.

```js
import {fragment} from "nyooom/render"

const f = fragment(html.p("paragraph 1"), html.p("paragraph 1"))
document.body.append(f.cloneNode(true))
```

### Text

The `text` helper function operates in two modes: When a string is provided, it
outputs a `TextNode`. This acts the same as `document.createTextNode`, except it
won't error for `undefined` and instead simply return an empty text node.

When used as a template literal, it will return a document template containing a
list of text nodes. HTML-Elements can be interpolated into these fragments and
will be inserted into the template.

```js
import {text} from "nyooom/render"

const t = text`Hello, ${html.b("World")}!`
```

## Extending

The Nyooom renderer is built in a modular way that allows for easy extending:

The most generic functionality like the `proxy()` method is implemented in the
`Renderer` class.

This is extended by the `DomRenderer` class which defines how
elements are created inside the browser or a compatible DOM implementation.

The DomHtmlRenderer defines a `camelCase` to `snake-case` conversion for node
names and a list of magic node names to be handled differently.

The `DomSvgRenderer` creates DOM nodes in the SVG namespace.
