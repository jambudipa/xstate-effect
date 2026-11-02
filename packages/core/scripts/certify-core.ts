/**
 * @since 0.4.0
 * @module scripts/certify-core
 *
 * The pure logic of the `xstate-effect-certify` bin (`certify.ts`): what a config module's default
 * export must hold. It imports the package by no name, so a test can reach it (CONF-8), and it
 * ships beside the bin, compiled to `dist/scripts/certify-core.js`.
 */
import { Layer, Predicate } from "effect"

/** The pattern of a config's machine name, which becomes an export of the certificate module. */
const exportName = /^[A-Za-z_$][\w$]*$/

/**
 * Whether a value is a config: a gate over no machine would prove nothing, so none is refused.
 * `certify.ts` narrows this to `CertifyConfig`, the type this module cannot import.
 */
export const isConfigShape = (value: unknown): boolean => {
  if (!Predicate.hasProperty(value, "output") || !Predicate.hasProperty(value, "machines")) return false
  const machines = value.machines
  if (!Predicate.isString(value.output) || value.output === "" || !Predicate.isObjectKeyword(machines)) return false
  const entries = Object.entries(machines)
  return entries.length > 0 && entries.every(([name, target]) => exportName.test(name) && isTargetShape(target))
}

/**
 * Whether a value names a machine and an environment, and a layer if the key is there. A `layer`
 * that is no Layer is refused, not ignored: a run without it could only crash or, worse, explore
 * a machine against the wrong services.
 */
const isTargetShape = (value: unknown): boolean =>
  Predicate.hasProperty(value, "machine") &&
  Predicate.hasProperty(value.machine, "root") &&
  Predicate.hasProperty(value, "environment") &&
  Predicate.hasProperty(value.environment, "catalogue") &&
  (!Predicate.hasProperty(value, "layer") || Layer.isLayer(value.layer))
