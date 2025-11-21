# Managing state with `Observable` and `State`

Nyooom offers two types of state container:

`Observable`s are a higher level, multi-value container with batched events
executed in microtasks.

`State`s are simpler, single-valued but composable event containers that emit
immediate change events.

`State`s can be composed into `ComputedState`s, which are read-only and compute
their value lazily using dirty-tracking.

## Observable objects

Observables are multi-value state containers that can be observed via event
listeners, promises, or states.

An observables values are stored in the `values` property, which returns a proxy
that will queue a change event whenever its value is changed. These changes can
also be reacted to immediately via the cancellable `'change'` event

Whenever there are changes, the observable will emit an event in the next
microtask that has a list of all the changes in order as an array of objects
with the following properties:

- `property`: String or Symbol
- `from`: The value of the property before the change
- `to`: The new value of the property
- `mutation`: Whether the value (must be observable) was mutated rather than changed
- `source`: The object responsible for the change (used for avoiding loops)

When using the `values`-Proxy to set a new property, this proxy will be listed
as the `source` of the change. To set a custom source, the `update(prop, value,
source)` method may be used instead.

If desired, the batched `"changed"`-event can be emitted prematurely with the
`emitQueue` method. This will not remove a queued microtask, but will clear the
event queue so the microtask becomes a nop unless new changes are made before it
runs.

### Promises

To listen for the single next change of a property, the `when(prop)` method
returns a proise that will resolve on the next `"changed"` event that affects
the given property with the last change in the list.

### States

To listen to multipla updates to the same change and/or modify the state, the
`property(prop, {readonly=false})` method returns a `WriteableState`
corresponding to a single property on the observable object.

This `State` will be notified of any change to the property in the next event
emision microtask, including changes made through the state itself.

Property states can be set to read-only to prevent them from writing data back
to the observable.

The `property` method is also memoized, meaning it will repeatedly return the
same state object for any given property name.

### Filtering / Consolidating changes

The list of events can be filtered before dispatching the event by overriding
the `filterChanges(changes)` method on a subclass of `Observable`.

For convenience, `Observable` provides the static method `consolidate` which can
be set as the `filterChanges` method on any subclass or instance to join all
changes on the same property into one.

### Skipping non-changes

By redefining the `same(a, b)` method, it is possible to define more granular
checks for whether two objects are the same when assigning, or this check can be
disabled entirely by returning `false` so change events are queued even if the
new valueis identical to the old one (this can still be handled in the
`filterChanges` method later on)

## Writeable States

Writeable states are simple single-value containers that emit a `"changed"`
event immediately when their value is changed.

## Computed States

Computed states cannot be written to but depend on other states and a compute
function for their value. Computed states autonomously keep track of upstream
changes and recompute their value only on demand when an upstream value has
changed since the last computation.

Computed states are created by passing a list of input states into a generator
function which in turn is created by calling `State.computed` with a computation
function. The computation function is called with the values of the input states
in the order they were passed into the generator.

```js
const difference = State.compute((a, b) => a - b)

const progress = Observable.new({target: 100, current: 30})

const remaining = difference(
	progress.property("target"),
	progress.property("current")
)

remaining.addEventListener("changed", ({value}) => {
	console.log(`Only ${value}% remaining`)
})

progress.current = 40
```

Computed states with a single input can also be created using the
`map(fn)` function on a state instance:

```js
const number = State.value(10)

const double = number.map(n => n*2)
```
