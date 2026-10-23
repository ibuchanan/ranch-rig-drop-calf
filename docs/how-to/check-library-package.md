# Check a library package

Use this workflow in a repository initialized with the `library` profile and
with a source entry matching its owner-managed tsdown configuration. Install its
dependencies first. The checks require a working build, local checker binaries,
npm, a POSIX shell, and writable temporary storage.
1. Run source tests separately:

   ```sh
   bun run test
   ```

2. Check the consumer package:

   ```sh
   bun run pack:check
   ```

   The command builds fresh output, prints the pack dry-run file list with
   lifecycle scripts disabled, and creates a temporary tarball. Strict Publint
   checks packaging conventions; Are the Types Wrong checks consumer declaration
   resolution on the same tarball. A failure stops the command with tool
   diagnostics. No package is published; the tarball is removed afterwards.

3. Fix the reported source or package metadata problem and rerun `pack:check`.
   Review the file list for unintended or missing contents. Manage public exports,
   export paths, package files, side effects, peers, and compatibility promises
   in your repository; Drop Calf does not rewrite them to make checks pass. Keep any
   library-specific consumer fixtures in your own test suite.

4. Run the combined verification workflow before pushing:

   ```sh
   bun run check
   ```

   Freshly seeded `lefthook.yml` includes `pack:check` in pre-push, and `check`
   dispatches that same group. For an existing repository, add
   `npm run pack:check --if-present` to your chosen hook group yourself if wanted;
   Drop Calf update preserves owner-edited hook files, including deletion.

Do not substitute standalone `validate` for this workflow. It checks configuration
acceptance without building or packing; package-check explicitly reports skipped
because its checks need fresh artifacts. Source tests alone do not check the
published file list or declaration resolution.

## Handle the default declaration-resolution blocker

If ATTW reports `Internal resolution error` under `node16 (from ESM)`, inspect
relative imports and re-exports in emitted `dist/*.d.ts`. The current default
build can emit `export { answer } from './answer'` unchanged, which does not
resolve for Node16 ESM consumers even though the source build succeeds.

For the controlled fixture, spelling the source re-export as
`export { answer } from './answer.js'` passes all checks. Apply explicit runtime
extensions where appropriate for your library, then rerun `pack:check`. Do not
suppress the diagnostic to claim compatibility. A general declaration-emission
fix is separate library-build work; the package-check capability leaves that
pipeline unchanged.

Keep any deliberate checker configuration, such as `.attw.json`, owner-managed
and aligned with your actual consumer compatibility promises. Drop Calf seeds no
rule suppressions and preserves configuration on update.
