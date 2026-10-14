import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Changeset,
  type Directory,
  dag,
  func,
  object,
  type Secret,
} from "@dagger.io/dagger";
import {
  blueprintFor,
  type ProjectProfile,
  resolveProfile,
  scaffoldSteps,
} from "./composition/profiles.ts";
import { updateCapabilities, validateCapabilities } from "./core/capability.ts";
import { mergeScaffoldPackage, scaffoldName } from "./core/package-json.ts";
import { renderToDirectory } from "./core/project.ts";
import { seedTemplates } from "./core/templates.ts";

@object()
export class DropCalf {
  /**
   * First-time setup of an empty directory or a `forge create` repository.
   * Refuse when catalog-info.yaml or .atlassian/OWNER exists at the project root;
   * use update for maintenance.
   * Otherwise remove the scaffold files Drop Calf replaces, generate the
   * profile's files over what is left, and keep the scaffold's runtime dependencies.
   * Scaffold steps are declared per kind; forge-app adopts root src JavaScript as
   * TypeScript and updates matching resource paths without editing source
   * contents or relaxing strict checks.
   * Normalize the manifest runtime from .nvmrc in the final update pass.
   * Package naming: explicit name, nonblank scaffold name, workspace basename.
   * Catalog owns package identity; the owner staff ID is the package author.
   */
  @func()
  async init(
    directory: Directory,
    profile: string,
    owner: string,
    packageName?: string,
    description = "",
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
  ): Promise<Directory> {
    const capabilities = resolveProfile(
      profile,
      withFunctions,
      withoutFunctions,
      preset,
    );
    for (const marker of ["catalog-info.yaml", ".atlassian/OWNER"])
      if (await directory.exists(marker))
        throw new Error(
          `init is a one-time operation: ${marker} already exists; use update instead.`,
        );
    const scaffold = (await directory.exists("package.json"))
      ? await directory.file("package.json").contents()
      : undefined;
    let cleaned = directory;
    for (const step of scaffoldSteps(profile as ProjectProfile))
      cleaned = await step(cleaned);
    const name =
      packageName ??
      scaffoldName(scaffold) ??
      basename(fileURLToPath(await dag.currentWorkspace().address()));
    const project = blueprintFor(capabilities, name, owner, description);
    let rendered = renderToDirectory(project);
    if (await cleaned.exists(".gitignore"))
      rendered = rendered.withNewFile(
        ".gitignore",
        await cleaned.file(".gitignore").contents(),
      );
    const seeded = await seedTemplates(
      rendered,
      dag.currentModule().source(),
      project.templates,
    );
    const kept = (await cleaned.exists("package.json"))
      ? await cleaned.file("package.json").contents()
      : undefined;
    const initialized = cleaned
      .withDirectory(".", seeded)
      .withNewFile(
        "package.json",
        mergeScaffoldPackage(
          kept,
          await seeded.file("package.json").contents(),
        ),
      );
    return updateCapabilities(initialized, capabilities);
  }

  /** `init` as a changeset, so deleted scaffold files are deleted on export. */
  @func()
  async initChanges(
    directory: Directory,
    profile: string,
    owner: string,
    packageName?: string,
    description = "",
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
  ): Promise<Changeset> {
    return (
      await this.init(
        directory,
        profile,
        owner,
        packageName,
        description,
        withFunctions,
        withoutFunctions,
        preset,
      )
    ).changes(directory);
  }

  /** Apply only the selected capabilities' update policies; never run scaffold steps. */
  @func()
  async update(
    directory: Directory,
    profile: string,
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
  ): Promise<Directory> {
    return updateCapabilities(
      directory,
      resolveProfile(profile, withFunctions, withoutFunctions, preset),
    );
  }

  /** Read-only tool acceptance report, including skipped checks and all failures. */
  @func()
  async validate(
    directory: Directory,
    profile: string,
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
    forgeEmail?: Secret,
    forgeApiToken?: Secret,
  ): Promise<string> {
    const capabilities = resolveProfile(
      profile,
      withFunctions,
      withoutFunctions,
      preset,
    );
    return JSON.stringify(
      await validateCapabilities(directory, capabilities, {
        forgeEmail,
        forgeApiToken,
      }),
      null,
      2,
    );
  }
}
