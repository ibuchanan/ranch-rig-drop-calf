import { type Directory, dag } from "@dagger.io/dagger";
import type { TemplateSeed } from "./templates.ts";
export type PackageJson = {
  name: string;
  version: string;
  type: "module";
  engines?: { node: string };
  private?: boolean;
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
  files?: string[];
  "size-limit"?: { name: string; path: string; limit: string }[];
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  dependencies?: Record<string, string>;
  description?: string;
  author?: string;
  license?: string;
};

export type ProjectBlueprint = {
  packageJson: PackageJson;
  files: Map<string, string>;
  templates: TemplateSeed[];
};

export function createBlueprint(
  packageName: string,
  description: string,
  author: string,
): ProjectBlueprint {
  const packageJson: PackageJson = {
    name: packageName,
    version: "0.1.0",
    type: "module",
    scripts: {},
    devDependencies: {},
  };

  if (description) packageJson.description = description;
  if (author) packageJson.author = author;
  const files = new Map<string, string>();

  // `.gitignore` is deliberately absent: it is a pinned, seeded asset like the
  // OSS and docs trees, so its capability declares the pin for seeding. See
  // src/gitignore.ts. The node baseline (`.nvmrc`, `.npmrc`, `@types/node`)
  // is absent for a different reason: it belongs to the `node` capability, not
  // to every blueprint. See src/node.ts. Authored config trees belong to their
  // capabilities: the blueprint carries their seed steps, and generation reads
  // them from the module source after rendering.
  return { packageJson, files, templates: [] };
}

export function renderToDirectory(project: ProjectBlueprint): Directory {
  let dir = dag.directory();
  dir = dir.withNewFile(
    "package.json",
    `${JSON.stringify(project.packageJson, null, 2)}\n`,
  );
  for (const [path, contents] of project.files) {
    dir = dir.withNewFile(path, contents);
  }
  return dir;
}
