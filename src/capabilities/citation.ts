import { stringify } from "yaml";
import { type Capability, noOp } from "../core/capability.ts";
import { OSS_LICENSE } from "./oss.ts";

export const CITATION_FILE = "CITATION.cff";

export function citation(): Capability {
  return {
    name: "citation",
    documentation: {
      tools: [
        {
          name: "Citation File Format",
          url: "https://citation-file-format.github.io/",
          purpose:
            "Lets people and tools cite the project from machine-readable metadata.",
        },
      ],
      init: "Seed CITATION.cff from the package name, description, version, and owner, with the catalog license.",
    },
    init(project) {
      const { name, description, version, author } = project.packageJson;
      // The owner is a staff ID, so the stub names an entity until a person replaces it.
      project.files.set(
        CITATION_FILE,
        stringify(
          {
            "cff-version": "1.2.0",
            message:
              "If you use this software, please cite it using this metadata.",
            title: name,
            ...(description ? { abstract: description } : {}),
            type: "software",
            version,
            license: OSS_LICENSE,
            authors: [{ name: author ?? name }],
          },
          { lineWidth: 0 },
        ),
      );
    },
    update: noOp(
      "Citation metadata is owner-managed after init, including deletion; update never overwrites authors, version, or abstract.",
    ),
    validate: noOp(
      "CITATION.cff schema validation needs cffconvert, which Drop Calf's tool containers do not run; the agent-skills-toolkit validate-cff check covers it once installed.",
    ),
  };
}
