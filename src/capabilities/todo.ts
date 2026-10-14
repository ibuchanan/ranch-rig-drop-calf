import { type Capability, noOp } from "../core/capability.ts";

/** git grep reads tracked working-tree files and returns 1 only for no matches. */
export const TODO_COMMAND =
  'git grep -n -I -F TO"DO" -- .; status=$?; if [ "$status" -eq 1 ]; then echo "No TO""DO markers found."; elif [ "$status" -ne 0 ]; then exit "$status"; fi';

export function todo(): Capability {
  return {
    name: "todo",
    documentation: {
      tools: [
        {
          name: "Git grep",
          url: "https://git-scm.com/docs/git-grep",
          purpose:
            "Lists TODO markers in tracked files with paths and line numbers.",
        },
      ],
    },
    packageJson: { seed: { scripts: { todo: TODO_COMMAND } } },
    init: noOp(
      "Todo owns no files; its package.json contribution seeds scripts.todo for every kind.",
    ),
    update: noOp(
      "The seeded todo script is owner-managed after init; update does not replace or re-add it.",
    ),
    validate: noOp(
      "Todo owns no configuration with a separate tool-acceptance check; owners run the script in their Git repository.",
    ),
  };
}
