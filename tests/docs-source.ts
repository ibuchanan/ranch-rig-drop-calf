import { readFileSync } from "node:fs";
import { join } from "node:path";

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
