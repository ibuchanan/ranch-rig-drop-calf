import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OSS_ASSETS } from "../src/oss.ts";
import { mockModuleSource } from "./module-source.ts";
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

export const mockOssSource = () => mockModuleSource(ossTemplates());
