import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read a real `templates/` subtree, so tests assemble from the same bytes generation does. */
const templatesIn = (tree: string) => {
  const directory = join(import.meta.dir, "../templates", tree);
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

export const docsTemplates = () => templatesIn("docs");

export const typescriptTemplates = () => templatesIn("typescript");

export const biomeTemplates = () => templatesIn("biome");

export const changelogTemplates = () => templatesIn("changelog");

export const gitHooksTemplates = () => templatesIn("git-hooks");

export const secretsTemplates = () => templatesIn("secretspec");
