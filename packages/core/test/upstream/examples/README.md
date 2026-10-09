# test/upstream/examples

The rewrites of the 6 files of upstream `packages/core/test/examples/` at `xstate@5.33.2`
(D1). Each file builds a statechart and checks a table of its transitions: from a state, on
an event, the expected next state value. A few files add single tests beside the table.

Most files run the table through `testAll` of `../utils.ts`, which makes one test per entry
with the upstream title template; `6.17.test.ts` loops over its table itself. The
`// upstream:` annotation sits above the generator call and stands for every test the table
expands to. The parity check counts the assertions in the body of `testAll` for each such
annotation, so a change to `testAll` changes the counts of every file here.

The rules of `../README.md` apply here unchanged: the annotation text, the upstream assertions,
and a ledger row in `../CONFORMANCE.md` for each difference.
