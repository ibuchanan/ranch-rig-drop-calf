import { spyOn } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { OSS_ASSETS } from "../src/oss.ts";
import { docsTemplates } from "./docs-source.ts";

export const moduleTemplates = () =>
  new Map<string, string>(
    OSS_ASSETS.map((path) => [path, `fixture for ${path}`]),
  );

export function mockModuleSource(
  templates: ReadonlyMap<string, string> = moduleTemplates(),
) {
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
