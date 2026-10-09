/**
 * Port of upstream `packages/core/src/scxml.ts` (xstate@5.33.2): the SCXML converter that
 * the SCXML conformance runner (`test/upstream/scxml.test.ts`) uses.
 *
 * Test support only (D4): upstream does not export the converter, and the port keeps it out
 * of `src/`, so the built package holds no SCXML converter and no `eval` (DELIVERY-1). It
 * evaluates SCXML expressions as upstream does, with `new Function` and a `with (context)`
 * block, and the datamodel with `eval`; test files have the relaxed lint rules.
 *
 * The converter builds a machine config from the SCXML document with the port's own action
 * and guard creators (`assign`, `cancel`, `log`, `raise`, `sendTo`, `enqueueActions`, `not`,
 * `stateIn`) and calls `createMachine`. Like upstream, it then gives every state node's
 * transitions map the wildcard form of each event descriptor (`foo` becomes `foo.*`), so an
 * SCXML descriptor matches its own event and every event below it (SCXML prefix matching).
 * Conversion is synchronous and throws for an SCXML feature it does not convert, with the
 * upstream message.
 */
import { type Element as XMLElement, xml2js } from "xml-js"
import {
  type ActionDefinition,
  assign,
  cancel,
  createMachine,
  enqueueActions,
  type EventObject,
  type GuardArgs,
  type InvokeConfig,
  log,
  not,
  NULL_EVENT,
  raise,
  sendTo,
  stateIn,
  type StateMachineType,
  type StateNodeConfig,
  type StateNodeInterface,
  type TransitionConfig,
  type TransitionDefinition
} from "../../../src/index.js"

/** The context of a converted machine: its SCXML datamodel, one key per `<data>` id. */
export type ScxmlContext = Record<string, unknown>

/** A machine converted from an SCXML document. */
export type ScxmlMachine = StateMachineType<string, ScxmlContext, EventObject, unknown, unknown, EventObject, never>

type ScxmlAction = ActionDefinition<ScxmlContext, EventObject>
type ScxmlGuard = (args: GuardArgs<ScxmlContext, EventObject>) => boolean
type ScxmlStateNodeConfig = StateNodeConfig<ScxmlContext, EventObject>
type ScxmlTransitionConfig = TransitionConfig<ScxmlContext, EventObject>

/** Upstream `SpecialTargets.Internal`: a `<send>` to this target raises its event. */
const INTERNAL_TARGET = "#_internal"

// upstream: src/scxml.ts > sanitizeStateId
/** An SCXML state id as a state key and id of the machine: each `.` becomes `$`. */
export function sanitizeStateId(id: string) {
  return id.replace(/\./g, "$")
}

// upstream: src/scxml.ts > appendWildcards
/**
 * Gives `state` and every node below it the wildcard form of each event descriptor, in the
 * same order and with the same transitions: `foo` becomes `foo.*`; `*` and a descriptor that
 * already ends in `.*` stay. Upstream assigns the node's `transitions` map after
 * `createMachine`; the port's node holds the map in a read-only field, which
 * `StateMachine.make` fills the same way while it builds the machine, so the machine's
 * `events`, its `config` and each transition's `eventType` keep the descriptors as written.
 */
function appendWildcards(state: StateNodeInterface<ScxmlContext, EventObject>): void {
  const newTransitions = new Map<string, ReadonlyArray<TransitionDefinition<ScxmlContext, EventObject>>>()

  for (const [descriptor, transitions] of state.transitions) {
    if (descriptor !== "*" && !descriptor.endsWith(".*")) {
      newTransitions.set(`${descriptor}.*`, transitions)
    } else {
      newTransitions.set(descriptor, transitions)
    }
  }

  // The port's node holds the Map's entries, in its order (SD-22, amended 2026-10-08)
  Object.assign(state, { transitions: Array.from(newTransitions) })

  for (const key of Object.keys(state.states)) {
    appendWildcards(state.states[key]!)
  }
}

// upstream: src/scxml.ts > getAttribute
function getAttribute(element: XMLElement, attribute: string): string | number | undefined {
  return element.attributes ? element.attributes[attribute] : undefined
}

// upstream: src/scxml.ts > indexedRecord
function indexedRecord<T>(items: ReadonlyArray<T>, identifierFn: (item: T) => string): Record<string, T> {
  const record: Record<string, T> = {}

  items.forEach((item) => {
    const key = identifierFn(item)

    record[key] = item
  })

  return record
}

// upstream: src/utils.ts > mapValues
function mapValues<T, R>(collection: Record<string, T>, iteratee: (item: T, key: string) => R): Record<string, R> {
  const result: Record<string, R> = {}

  for (const key of Object.keys(collection)) {
    result[key] = iteratee(collection[key]!, key)
  }

  return result
}

// upstream: src/scxml.ts > executableContent
function executableContent(elements: ReadonlyArray<XMLElement>): { readonly actions: ReadonlyArray<ScxmlAction> } {
  return {
    actions: mapActions(elements)
  }
}

// upstream: src/scxml.ts > getTargets
function getTargets(targetAttr?: string | number): Array<string> | undefined {
  return targetAttr
    ? `${targetAttr}`
        .split(/\s+/)
        .map((target) => `#${sanitizeStateId(target)}`)
    : undefined
}

// upstream: src/scxml.ts > delayToMs
// It must stay a self-contained function: a `delayexpr` converts its value with the source
// text of this function (upstream does the same).
function delayToMs(delay?: string | number): number | undefined {
  if (!delay) {
    return undefined
  }

  if (typeof delay === "number") {
    return delay
  }

  const millisecondsMatch = delay.match(/(\d+)ms/)

  if (millisecondsMatch) {
    return parseInt(millisecondsMatch[1]!, 10)
  }

  const secondsMatch = delay.match(/(\d*)(\.?)(\d+)s/)

  if (secondsMatch) {
    const hasDecimal = !!secondsMatch[2]
    if (!hasDecimal) {
      return parseInt(secondsMatch[3]!, 10) * 1000
    }
    const secondsPart = secondsMatch[1] ? parseInt(secondsMatch[1], 10) * 1000 : 0
    const millisecondsPart = parseInt(secondsMatch[3]!.padEnd(3, "0"), 10)

    if (millisecondsPart >= 1000) {
      throw new Error(`Can't parse "${delay} delay."`)
    }

    return secondsPart + millisecondsPart
  }

  throw new Error(`Can't parse "${delay} delay."`)
}

// upstream: src/scxml.ts > evaluateExecutableContent
/**
 * Runs an SCXML expression body with the datamodel in scope (`with (context)`), `_event` as
 * the SCXML event (`name` and `data`) and `_sessionid` as a placeholder, as upstream does.
 * Upstream's unused `_meta` argument and extra parameter names are left out.
 */
const evaluateExecutableContent = (context: ScxmlContext, event: EventObject, body: string): unknown => {
  const scope = ['const _sessionid = "NOT_IMPLEMENTED";'].filter(Boolean).join("\n")

  const args = ["context", "_event"]

  const fnBody = `
${scope}
with (context) {
  ${body}
}
  `

  const fn = new Function(...args, fnBody) as (
    context: ScxmlContext,
    _event: { readonly name: string; readonly data: EventObject }
  ) => unknown

  return fn(context, { name: event.type, data: event })
}

// upstream: src/scxml.ts > createGuard
/**
 * A guard that evaluates an SCXML condition. Upstream returns the value itself and tests it
 * for truthiness; the port's guard gives a boolean, so the value is tested here.
 */
function createGuard(guard: string): ScxmlGuard {
  return ({ context, event }) => Boolean(evaluateExecutableContent(context, event, `return ${guard};`))
}

// upstream: src/scxml.ts > mapAction
function mapAction(element: XMLElement): ScxmlAction {
  switch (element.name) {
    case "raise": {
      return raise<ScxmlContext, EventObject>({
        type: element.attributes!.event as string
      })
    }
    case "assign": {
      return assign<ScxmlContext, EventObject>(({ context, event }) => {
        const fnBody = `

${element.attributes!.location};

return {'${element.attributes!.location}': ${element.attributes!.expr}};
          `

        return evaluateExecutableContent(context, event, fnBody) as Partial<ScxmlContext>
      })
    }
    case "cancel":
      if ("sendid" in element.attributes!) {
        return cancel<ScxmlContext, EventObject>(element.attributes.sendid! as string)
      }
      return cancel<ScxmlContext, EventObject>(({ context, event }) => {
        const fnBody = `
return ${element.attributes!.sendidexpr};
          `

        return evaluateExecutableContent(context, event, fnBody) as string
      })
    case "send": {
      const { event, eventexpr, target, id } = element.attributes!

      let convertedEvent: EventObject | ((args: { context: ScxmlContext; event: EventObject }) => EventObject)
      let convertedDelay: number | ((args: { context: ScxmlContext; event: EventObject }) => number) | undefined

      const params =
        element.elements &&
        element.elements.reduce((acc, child) => {
          if (child.name === "content") {
            throw new Error("Conversion of <content/> inside <send/> not implemented.")
          }
          return `${acc}${child.attributes!.name}:${child.attributes!.expr},\n`
        }, "")

      if (event && !params) {
        convertedEvent = { type: event as string }
      } else {
        convertedEvent = ({ context, event: _ev }) => {
          const fnBody = `
return { type: ${event ? `"${event}"` : eventexpr}, ${params ? params : ""} }
            `

          return evaluateExecutableContent(context, _ev, fnBody) as EventObject
        }
      }

      if ("delay" in element.attributes!) {
        convertedDelay = delayToMs(element.attributes.delay)
      } else if (element.attributes!.delayexpr) {
        convertedDelay = ({ context, event: _ev }) => {
          const fnBody = `
return (${String(delayToMs)})(${element.attributes!.delayexpr});
            `

          return evaluateExecutableContent(context, _ev, fnBody) as number
        }
      }

      if (target === INTERNAL_TARGET) {
        return raise<ScxmlContext, EventObject>(convertedEvent)
      }

      return sendTo<ScxmlContext, EventObject>(
        typeof target === "string" ? target : ({ self }) => self,
        convertedEvent,
        {
          delay: convertedDelay,
          id: id as string | undefined
        }
      )
    }
    case "log": {
      const label = element.attributes!.label

      return log<ScxmlContext, EventObject>(
        ({ context, event }) => {
          const fnBody = `
return ${element.attributes!.expr};
            `

          return evaluateExecutableContent(context, event, fnBody)
        },
        label !== undefined ? String(label) : undefined
      )
    }
    case "if": {
      const branches: Array<{
        guard?: ScxmlGuard
        actions: Array<ScxmlAction>
      }> = []

      let current: (typeof branches)[number] = {
        guard: createGuard(element.attributes!.cond as string),
        actions: []
      }

      for (const el of element.elements!) {
        if (el.type === "comment") {
          continue
        }

        switch (el.name) {
          case "elseif":
            branches.push(current)
            current = {
              guard: createGuard(el.attributes!.cond as string),
              actions: []
            }
            break
          case "else":
            branches.push(current)
            current = { actions: [] }
            break
          default:
            current.actions.push(mapAction(el))
            break
        }
      }

      branches.push(current)

      return enqueueActions<ScxmlContext, EventObject>(({ enqueue, check }) => {
        for (const branch of branches) {
          if (!branch.guard || check(branch.guard)) {
            branch.actions.forEach((action) => enqueue(action))
            break
          }
        }
      })
    }
    default:
      throw new Error(`Conversion of "${element.name}" elements is not implemented yet.`)
  }
}

// upstream: src/scxml.ts > mapActions
function mapActions(elements: ReadonlyArray<XMLElement>): Array<ScxmlAction> {
  const mapped: Array<ScxmlAction> = []

  for (const element of elements) {
    if (element.type === "comment") {
      continue
    }

    mapped.push(mapAction(element))
  }

  return mapped
}

type HistoryAttributeValue = "shallow" | "deep" | undefined

// upstream: src/scxml.ts > toConfig
function toConfig(nodeJson: XMLElement, id: string): ScxmlStateNodeConfig {
  const parallel = nodeJson.name === "parallel"
  let initial = parallel ? undefined : nodeJson.attributes!.initial
  const { elements } = nodeJson

  switch (nodeJson.name) {
    case "history": {
      const history = (getAttribute(nodeJson, "type") as HistoryAttributeValue) || "shallow"
      if (!elements) {
        return {
          id,
          history
        }
      }

      const [transitionElement] = elements.filter((element) => element.name === "transition")

      const target = getAttribute(transitionElement!, "target")

      return {
        id,
        history,
        target: target ? `#${sanitizeStateId(target as string)}` : undefined
      }
    }
    default:
      break
  }

  if (nodeJson.elements) {
    const stateElements = nodeJson.elements.filter(
      (element) =>
        element.name === "state" ||
        element.name === "parallel" ||
        element.name === "final" ||
        element.name === "history"
    )

    const transitionElements = nodeJson.elements.filter((element) => element.name === "transition")

    const invokeElements = nodeJson.elements.filter((element) => element.name === "invoke")

    const onEntryElements = nodeJson.elements.filter((element) => element.name === "onentry")

    const onExitElements = nodeJson.elements.filter((element) => element.name === "onexit")

    const states: Record<string, XMLElement> = indexedRecord(stateElements, (item) =>
      sanitizeStateId(`${item.attributes!.id}`)
    )

    const initialElement = !initial ? nodeJson.elements.find((element) => element.name === "initial") : undefined

    if (initialElement && initialElement.elements!.length) {
      initial = initialElement.elements!.find((element) => element.name === "transition")!.attributes!.target as string
    } else if (!initial && !initialElement && stateElements.length) {
      initial = stateElements[0]!.attributes!.id
    }

    const always: Array<ScxmlTransitionConfig> = []
    // Upstream builds `on` as an array with string keys; a plain object has the same key order
    const on: Record<string, Array<ScxmlTransitionConfig>> = {}

    transitionElements.forEach((value) => {
      const events = ((getAttribute(value, "event") as string) || "").split(/\s+/)

      return events.map((eventType) => {
        const targets = getAttribute(value, "target")
        const internal = getAttribute(value, "type") === "internal"

        let guardObject: { readonly guard?: ScxmlTransitionConfig["guard"] } = {}

        if (value.attributes?.cond) {
          const guard = value.attributes.cond
          if ((guard as string).startsWith("In")) {
            const inMatch = (guard as string).trim().match(/^In\('(.*)'\)/)

            if (inMatch) {
              guardObject = {
                guard: stateIn<ScxmlContext, EventObject>(`#${inMatch[1]}`)
              }
            }
          } else if ((guard as string).startsWith("!In")) {
            const notInMatch = (guard as string).trim().match(/^!In\('(.*)'\)/)

            if (notInMatch) {
              guardObject = {
                guard: not<ScxmlContext, EventObject>(stateIn<ScxmlContext, EventObject>(`#${notInMatch[1]}`))
              }
            }
          } else {
            guardObject = {
              guard: createGuard(value.attributes.cond as string)
            }
          }
        }

        const transitionConfig: ScxmlTransitionConfig = {
          target: getTargets(targets),
          ...(value.elements ? executableContent(value.elements) : undefined),
          ...guardObject,
          ...(!internal && { reenter: true })
        }

        if (eventType === NULL_EVENT.type) {
          always.push(transitionConfig)
        } else {
          if (/^done\.state(\.|$)/.test(eventType)) {
            eventType = `xstate.${eventType}`
          } else if (/^done\.invoke(\.|$)/.test(eventType)) {
            eventType = eventType.replace(/^done\.invoke/, "xstate.done.actor")
          }
          let existing = on[eventType]
          if (!existing) {
            existing = []
            on[eventType] = existing
          }
          existing.push(transitionConfig)
        }
      })
    })

    const onEntry = onEntryElements
      ? onEntryElements.flatMap((onEntryElement) => mapActions(onEntryElement.elements!))
      : undefined

    const onExit = onExitElements
      ? onExitElements.flatMap((onExitElement) => mapActions(onExitElement.elements!))
      : undefined

    const invoke = invokeElements.map((element): InvokeConfig<ScxmlContext, EventObject> => {
      if (!["scxml", "http://www.w3.org/TR/scxml/"].includes(element.attributes!.type as string)) {
        throw new Error("Currently only converting invoke elements of type SCXML is supported.")
      }
      const content = element.elements!.find((el) => el.name === "content")!

      return {
        ...(element.attributes!.id && { id: element.attributes!.id as string }),
        src: scxmlToMachine(content)
      }
    })

    const resolvedInitial = initial && String(initial).split(" ")

    if (resolvedInitial && resolvedInitial.length > 1) {
      throw new Error(`Multiple initial states are not supported ("${String(initial)}").`)
    }

    return {
      id: sanitizeStateId(id),
      ...(resolvedInitial
        ? {
            initial: sanitizeStateId(resolvedInitial[0]!)
          }
        : undefined),
      ...(parallel ? { type: "parallel" as const } : undefined),
      ...(nodeJson.name === "final" ? { type: "final" as const } : undefined),
      ...(stateElements.length
        ? {
            states: mapValues(states, (state, key) => toConfig(state, key))
          }
        : undefined),
      on,
      ...(always.length ? { always } : undefined),
      ...(onEntry ? { entry: onEntry } : undefined),
      ...(onExit ? { exit: onExit } : undefined),
      ...(invoke.length ? { invoke } : undefined)
    }
  }

  return { id, ...(nodeJson.name === "final" ? { type: "final" as const } : undefined) }
}

// upstream: src/scxml.ts > scxmlToMachine
function scxmlToMachine(scxmlJson: XMLElement): ScxmlMachine {
  const machineElement = scxmlJson.elements!.find((element) => element.name === "scxml")!

  const dataModelEl = machineElement.elements!.filter((element) => element.name === "datamodel")[0]

  const context = dataModelEl
    ? dataModelEl.elements!
        .filter((element) => element.name === "data")
        .reduce<ScxmlContext>((acc, element) => {
          const { src, expr, id } = element.attributes!
          if (src) {
            throw new Error("Conversion of `src` attribute on datamodel's <data> elements is not supported.")
          }

          if (expr === "_sessionid") {
            acc[id!] = undefined
          } else {
            acc[id!] = eval(`(${expr})`)
          }

          return acc
        }, {})
    : undefined

  // Upstream passes `context: undefined` for a document without a datamodel; a machine reads
  // a missing context as `{}` (upstream `context || {}`), which the port's context type takes
  const machine = createMachine<ScxmlContext, EventObject>({
    ...toConfig(machineElement, "(machine)"),
    context: context ?? {}
  })

  appendWildcards(machine.root)

  return machine
}

// upstream: src/scxml.ts > toMachine
/** Converts an SCXML document to a machine. Throws for an SCXML feature it does not convert. */
export function toMachine(xml: string): ScxmlMachine {
  const json = xml2js(xml) as XMLElement
  return scxmlToMachine(json)
}
