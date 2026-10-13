import pins from "../pins/package.json" with { type: "json" };

const pin = pins.devDependencies;

export const NODE_MAJOR = "24";

/** npm pins come from `pins/package.json`; the rest are not npm packages. */
export const TOOL_VERSIONS = {
  bun: "1.4.2",
  fnm: "1.38.1",
  forgeCli: pin["@forge/cli"],
  biome: pin["@biomejs/biome"],
  typescript: pin.typescript,
  tsdown: pin.tsdown,
  sizeLimit: pin["size-limit"],
  cspell: pin.cspell,
  markdownlintCli2: pin["markdownlint-cli2"],
  vitest: pin.vitest,
  promptfoo: pin.promptfoo,
  gitCliff: pin["git-cliff"],
  lefthook: pin.lefthook,
  astGrep: pin["@ast-grep/cli"],
  forgePrelint: pin["@forge-ahead/prelint"],
  fallow: pin.fallow,
  forgeAheadApiTypes: pin["@forge-ahead/atlassian-api-types"],
  forgeAheadErrors: pin["@forge-ahead/errors"],
  forgeAheadLogging: pin["@forge-ahead/logging"],
} as const;
