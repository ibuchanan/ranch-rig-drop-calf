import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Changeset,
  type Container,
  type Directory,
  dag,
  func,
  object,
  type Secret,
} from "@dagger.io/dagger";
import { updateCapabilities, validateCapabilities } from "./capability.ts";
import { validateCatalog } from "./catalog.ts";
import { validateChangelog } from "./changelog.ts";
import { forgeManifest, validateForgeManifest } from "./forge-manifest.ts";
import {
  adoptScaffoldTypeScript,
  mergeScaffoldPackage,
  scaffoldName,
} from "./init.ts";
import { nodeContainer as buildNodeContainer } from "./node.ts";
import { applyPreclean } from "./preclean.ts";
import { validatePrelint } from "./prelint.ts";
import { buildProject, resolveProfile } from "./profiles.ts";
import { renderToDirectory } from "./project.ts";
import { seedTemplates } from "./templates.ts";
@object()
export class DropCalf {
  /**
   * The Node baseline as a native Dagger container. Containerized tools run the
   * same major the file pins promise rather than whatever the host has
   * installed.
   */
  @func()
  nodeContainer(): Container {
    return buildNodeContainer();
  }

  @func()
  async validateCatalog(directory: Directory): Promise<string> {
    return JSON.stringify(await validateCatalog(directory), null, 2);
  }

  /**
   * Check git-cliff acceptance by rendering the canonical command in isolation.
   * Does not compare owner policy or package scripts with the baseline. Reports
   * `skipped` when the policy or Git history is unavailable.
   */
  @func()
  async validateChangelog(directory: Directory): Promise<string> {
    return JSON.stringify(await validateChangelog(directory), null, 2);
  }

  /** Run Forge lint against an unchanged repository without registration or deployment. */
  @func()
  async validateForgeManifest(
    directory: Directory,
    forgeEmail?: Secret,
    forgeApiToken?: Secret,
  ): Promise<string> {
    return JSON.stringify(
      await validateForgeManifest(directory, forgeEmail, forgeApiToken),
      null,
      2,
    );
  }

  /** Prelint has no local configuration to validate; report its explicit skip reason. */
  @func()
  async validatePrelint(directory: Directory): Promise<string> {
    return JSON.stringify(await validatePrelint(directory), null, 2);
  }

  @func()
  async removeScaffold(directory: Directory): Promise<Directory> {
    return applyPreclean(directory);
  }

  @func()
  async removeScaffoldChanges(directory: Directory): Promise<Changeset> {
    return (await this.removeScaffold(directory)).changes(directory);
  }

  /**
   * First-time setup of an empty directory or a `forge create` repository.
   * Refuse when catalog-info.yaml or .atlassian/OWNER exists at the project root;
   * use update for maintenance.
   * Otherwise remove the scaffold files Drop Calf replaces, generate the
   * profile's files over what is left, and keep the scaffold's runtime dependencies.
   * On forge-app, adopt root src JavaScript as TypeScript and update matching
   * resource paths without editing source contents or relaxing strict checks.
   * Normalize the manifest runtime from .nvmrc in the final update pass.
   * Package naming: explicit name, nonblank scaffold name, workspace basename.
   * Catalog owns package identity; the legacy author argument is ignored in favor
   * of its owner staff ID.
   */
  @func()
  async init(
    directory: Directory,
    profile: string,
    owner: string,
    packageName?: string,
    description = "",
    author = "",
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
  ): Promise<Directory> {
    resolveProfile(profile, withFunctions, withoutFunctions, preset);
    for (const marker of ["catalog-info.yaml", ".atlassian/OWNER"])
      if (await directory.exists(marker))
        throw new Error(
          `init is a one-time operation: ${marker} already exists; use update instead.`,
        );
    const scaffold = (await directory.exists("package.json"))
      ? await directory.file("package.json").contents()
      : undefined;
    const adopted =
      profile === "forge-app"
        ? await adoptScaffoldTypeScript(directory)
        : directory;
    const cleaned = await applyPreclean(adopted);
    const name =
      packageName ??
      scaffoldName(scaffold) ??
      basename(fileURLToPath(await dag.currentWorkspace().address()));
    const project = buildProject(
      profile,
      name,
      owner,
      description,
      author,
      withFunctions,
      withoutFunctions,
      preset,
    );
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
    return this.update(
      initialized,
      profile,
      withFunctions,
      withoutFunctions,
      preset,
    );
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
    ).map((capability) =>
      capability.name === "forge-manifest"
        ? forgeManifest(forgeEmail, forgeApiToken)
        : capability,
    );
    return JSON.stringify(
      await validateCapabilities(directory, capabilities),
      null,
      2,
    );
  }

  /** `init` as a changeset, so deleted scaffold files are deleted on export. */
  @func()
  async initChanges(
    directory: Directory,
    profile: string,
    owner: string,
    packageName?: string,
    description = "",
    author = "",
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
        author,
        withFunctions,
        withoutFunctions,
        preset,
      )
    ).changes(directory);
  }

  @func()
  async export(directory: Directory, path: string): Promise<string> {
    return await directory.export(path);
  }
}
