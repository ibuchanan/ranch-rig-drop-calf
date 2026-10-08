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

export function mockOssSource() {
  const templates = ossTemplates();
  const source = {
    file: (path: string) => ({
      text: templates.get(path),
      contents: async () => templates.get(path),
    }),
  };
  return spyOn(dag, "currentModule").mockReturnValue({
    source: () => ({ directory: () => source }),
  } as unknown as ReturnType<typeof dag.currentModule>);
}
