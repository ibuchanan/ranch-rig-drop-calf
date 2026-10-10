import { spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dag } from "@dagger.io/dagger";
import { OSS_ASSETS } from "../src/oss.ts";

export const ossTemplates = () =>
  new Map<string, string>(
    OSS_ASSETS.map((path) => [
      path,
      readFileSync(
        join(import.meta.dir, "../vendor/oss-templates", path),
        "utf8",
      ),
    ]),
  );

export const docsTemplates = () => {
  const directory = join(import.meta.dir, "../templates/docs");
  return new Map(
    [
      ...new Bun.Glob("**/*").scanSync({
        cwd: directory,
        onlyFiles: true,
        dot: true,
      }),
    ]
      .sort()
      .map((path) => [path, readFileSync(join(directory, path), "utf8")]),
  );
};

export function mockOssSource() {
  const templates = ossTemplates();
  const docs = docsTemplates();
  const source = {
    file: (path: string) => ({
      text: templates.get(path),
      contents: async () => templates.get(path),
    }),
  };
  const docsSource = {
    glob: async () => [...docs.keys()],
    exists: async (path: string) => docs.has(path),
    file: (path: string) => ({
      text: docs.get(path),
      contents: async () => docs.get(path),
    }),
  };
  return spyOn(dag, "currentModule").mockReturnValue({
    source: () => ({
      directory: (path: string) =>
        path === "templates/docs" ? docsSource : source,
    }),
  } as unknown as ReturnType<typeof dag.currentModule>);
}
