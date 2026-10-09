# test/upstream/support

Test-only code that a rewrite needs but that the package must not ship. It holds the SCXML
converter: a port of upstream `packages/core/src/scxml.ts` that `../scxml.test.ts` runs against
the SCXML conformance fixtures (D4, SD-14).

Upstream does not export the converter, so the port keeps it out of `src/`: the built package
holds no SCXML converter and no `eval` (DELIVERY-1). The converter evaluates SCXML expressions
as upstream does, with `new Function` and `eval`, and it throws synchronously, with the
upstream message, for an SCXML feature it does not convert. Both are allowed only because this
is test code: the test files have the relaxed lint rules, and SD-3 names this converter as the
one synchronous throw left in the port.

The converter builds each machine with the port's own action and guard creators, so a change
to one of those creators reaches the SCXML run too.

`scxml.ts` is pinned by its whole source in `test/verify/capability-pins.json`. Any edit to
it, a comment included, needs its pin regenerated (see `test/verify/README.md`).
