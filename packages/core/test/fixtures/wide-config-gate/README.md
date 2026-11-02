# Wide config diagnostic fixtures

Each `.ts.txt` file is a separate TypeScript input. The test compiler reads a virtual
`.ts` view without writing generated source files. `support.ts.txt` supplies an agent
setup and a setup with a certified child.

`manifest.json` pins every expected diagnostic code, source line, and message fragment.
An empty diagnostic list requires a clean compile. The harness also refuses every
diagnostic outside the listed fixtures, including source and shared support errors.

The COV-1 spec runs this matrix through `test/verify/wide-config-gate.ts`.

The original 84 fixtures cover 28 unreadable configurations (A), 40 literal errors with their
real messages (B), and 16 valid configurations (C). The same cases run for agent
setups and setups that hold a certified child. C5 checks exact contextual types,
including the `Option<number>` output of an invoked Effect actor. C6 reads the
literal configuration from the returned machine's `HoldsAgents` marker.

The wide `onDone` target in A7 reports `SettlementMustExit`: an arbitrary string
cannot guarantee that settlement leaves the invoking state. A9 pins the call-arity
error that prevents `any` from swallowing an error intersection.

The fixture files contain no diagnostic suppression directives. B fixtures also
assert that their messages do not contain `ConfigNotLiteral`.

The complete sampled matrix contains 127 fixtures and 102 expected diagnostics.
The additional 34 negative inputs cover erased structural values and unions in both
setup types. Nine positive inputs cover state/event names that equal config member
names, nested invocation callbacks, opaque callback values, plain-setup compatibility,
and the exported certificate and capability types for unions.

The added union-of-states cases report `CannotReachFinal`, and erased `onDone.target`
cases report `SettlementMustExit`. These are their observed compile-time refusals;
the original B assertions still require the specific literal errors without
`ConfigNotLiteral`. The matrix describes sampled static types, not every possible
way TypeScript can erase information before a library receives a value.
