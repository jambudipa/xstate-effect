# @typescript-eslint/no-explicit-any

This is an Effect-first repo where correct type inference is paramount. `any` defeats TypeScript's type safety and breaks Effect's powerful type-level error tracking.

## Fix strategies (in order of preference)

1. **Remove `any` and let TypeScript infer** - Often the type is already correctly inferred
   ```ts
   // Bad
   const result: any = yield* myEffect
   // Good
   const result = yield* myEffect
   ```

2. **Use `unknown` with type narrowing** - When the type is truly unknown at compile time
   ```ts
   // Bad
   function handle(data: any) { ... }
   // Good
   function handle(data: unknown) {
     if (Schema.is(MySchema)(data)) { ... }
   }
   ```

3. **Use generics** - When the type should be parameterized
   ```ts
   // Bad
   function wrap(value: any): any { ... }
   // Good
   function wrap<T>(value: T): T { ... }
   ```

4. **Use Effect Schema for runtime validation** - For external data
   ```ts
   const MySchema = Schema.Struct({ name: Schema.String })
   const parsed = Schema.decodeUnknown(MySchema)(externalData)
   ```

5. **Use branded types or newtypes** - For domain-specific constraints

## Common scenarios

- **Catch blocks**: Use `unknown` - errors can be anything
- **JSON parsing**: Use `Schema.decodeUnknown` with a schema
- **Third-party APIs**: Define interfaces matching the API response
- **Event handlers**: Type the event properly (`MouseEvent`, `KeyboardEvent`, etc.)
- **Dynamic object access**: Use `Record<string, T>` or index signatures

## Never acceptable
- Using `any` to silence type errors without understanding them
- Casting through `any` to bypass type checking (`x as any as Y`)
