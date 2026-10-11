import { spyOn } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";

/** Fake only the container boundary; real tool behavior is covered by the opt-in Dagger tests. */
export function mockBiomeContainer(
  migrate: (contents: string) => string = (contents) => contents,
  failure?: Error,
) {
  const commands: string[][] = [];
  const mounts: { path: string; readOnly?: boolean }[] = [];
  const reads: string[] = [];
  let input: Directory;
  const container = {
    from: () => container,
    withFile: () => container,
    withNewFile: () => container,
    directory: () => ({ files: new Map<string, string>() }),
    withExec: (args: string[]) => {
      commands.push(args);
      return container;
    },
    withMountedDirectory: (
      path: string,
      directory: Directory,
      options?: { readOnly?: boolean },
    ) => {
      input = directory;
      mounts.push({ path, ...options });
      return container;
    },
    withWorkdir: () => container,
    stdout: async () => {
      if (failure) throw failure;
      return "";
    },
    file: (path: string) => {
      reads.push(path);
      return {
        contents: async () =>
          migrate(await input.file(path.slice("/repo/".length)).contents()),
      };
    },
  };
  return {
    commands,
    mounts,
    reads,
    spy: spyOn(dag, "container").mockReturnValue(container as never),
  };
}
