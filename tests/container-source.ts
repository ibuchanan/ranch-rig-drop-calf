import { spyOn } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";

type MockContainerOptions = {
  /** Return value of `stdout()`, given the commands run so far. */
  stdout?: (commands: readonly string[][]) => string;
  /** Thrown from `stdout()` instead of returning, to exercise failure paths. */
  failure?: Error;
  /** Transform applied when `file()` reads a mounted input, for tool "migrate" runs. */
  transform?: (contents: string) => string;
};

/**
 * Fake only the container boundary, recording every call so tests can assert the
 * command, mounts and environment without an engine. Real tool behavior is
 * covered by the opt-in Dagger tests. The two `dag.container` guards that assert
 * a container is never started stay local to their tests.
 */
export function mockContainer(options: MockContainerOptions = {}) {
  const commands: string[][] = [];
  const mounts: { path: string; readOnly?: boolean }[] = [];
  const mounted: Directory[] = [];
  const reads: string[] = [];
  const environment: Record<string, string> = {};
  const copied: string[] = [];
  const images: string[] = [];
  let input: Directory | undefined;
  const container = {
    from: (image: string) => {
      images.push(image);
      return container;
    },
    withFile: (path: string) => {
      copied.push(path);
      return container;
    },
    withNewFile: () => container,
    directory: () => ({ files: new Map<string, string>() }),
    withExec: (args: string[]) => {
      commands.push(args);
      return container;
    },
    withMountedDirectory: (
      path: string,
      directory: Directory,
      opts?: { readOnly?: boolean },
    ) => {
      input = directory;
      mounts.push({ path, ...opts });
      mounted.push(directory);
      return container;
    },
    withWorkdir: () => container,
    withEnvVariable: (name: string, value: string) => {
      environment[name] = value;
      return container;
    },
    stdout: async () => {
      if (options.failure) throw options.failure;
      return options.stdout?.(commands) ?? "";
    },
    file: (path: string) => {
      reads.push(path);
      return {
        contents: async () => {
          const contents = await (input as Directory)
            .file(path.slice("/repo/".length))
            .contents();
          return options.transform ? options.transform(contents) : contents;
        },
      };
    },
  };
  return {
    container,
    commands,
    mounts,
    mounted,
    reads,
    environment,
    copied,
    images,
    spy: spyOn(dag, "container").mockReturnValue(container as never),
  };
}
