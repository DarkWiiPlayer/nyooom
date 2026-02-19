# Controller-Registry

An analog to custom elements with a few key differences:

- Controllers can be attached and detached
- Multiple controllers can attach to the same element
- Can be functions or handler objects

```js
// example.js
import controllers from "controllers"

controllers.define("clickable", (element, detached) => {
    element.addEventListener("click", () => {
        alert("The element has been clicked!")
    }, detached)
})
```

```html
<!-- example.html -->
<script type="module" src="example.js"></script>

<button controller="clickable">Try clicking this button</button>
```

## Concept

Similar to a custom element, a controller defines custom behaviours for HTML
elements and is managed automatically by a registry.

Like custom built-in elements, controllers are controlled via an attribute on
the element.

Unlike custom elements, controllers are external objects or functions that are
attached to an object, meaning several different controllers can be managing the
same element at once, and the class of the element does not change in the
process.

Controllers can be added and removed as necessary.

## API

The library exports a global `ControllerRegistry` attached to the document root
with a similar API to the `CustomElementRegistry` class.

Controllers can be registered under any name as either a callback which gets
called when the controller is added to an element or a constructor which gets
called with `new` and passed a revokable proxy to the element.

```js
controllers.define("showcase", class ShowcaseController {
    constructor(element, detached) {
        this.method(element)
        // detached promise is passed here too for convenience,
        // but the `detached` method is the preferred place
        // to put cleanup code.
    }

    method(element) {
        console.log("Calling method on:", element)
    }

    detached(element) {
        // Cleanup if necessary
    }
})
```

Note that only class controllers are given a revocable proxy: this is because
their stateful nature and suitability for more complex handling makes them more
likely candidates to retain references to the target past their detachment.

For complex function controllers, this can easily be done manually using
`Proxy.revocable(element, {})`.

This behaviour might change in the future.

If the controller is a function, the second argument is a promise that resolves
to the element when the controller is removed again. This promise has an
additional property `"signal"` which returns an `AbortSignal`. This means the
promise can be passed directly as the third argument to `addEventListener`
function calls.

```js
controllers.define("showcase", async (element, detached) => {
    console.log("Attached to element:", element)
    console.log("Detached promise:", detached)
    console.log("Detached signal:", detached.signal)
    element === await detached
    console.log("Detached from element:", element)
}
```

The registry also exposes a `list` function which, given an element, returns an
object similar to a `DomTokenList` for easier management of the controller list.

The `controller` attribute is a space-separated list of controller names as
registered in the registry.

## Interactions between controllers

There is no direct way for controllers to interact with each other, as they
should be mostly independent.

When signalling is needed, events are the way to go; when data needs to be
shared, the element's `dataset` or a more semantic attribute should be used.

For anything even more complex, a custom element or a higher level component
framework might be the better solution.

## Examples

### Classes as Controllers

Controller registries can be attached to any desired attribute, including ones
that already hold meaning, like `id` or `class`.

In this example, a controller registry is attached to the `class` attribute
inside a custom element, meaning classes can add both styling and behaviour to
elements:

```html
<script type="module">
	import {ControllerRegistry} from "controller-registry.js"

	class MyElement extends HTMLElement {
		constructor() {
			const registry = new ControllerRegistry(this, "class")
			registry.define("foo", (element, detached) => {
				element.addEventListener("click", event => {
					alert("a foo has been clicked!")
				}, detached)
			})
		}
	}
	customElements.define("my-element", MyElement)
</script>

<style>
	my-element .foo { font-weight: bold }
</style>

<my-element>
	<p class="foo">Click me, I'm bold!</p>
</my-element>
```
