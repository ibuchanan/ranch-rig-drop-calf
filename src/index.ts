import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Changeset,
  type Directory,
  dag,
  type File,
  func,
  object,
  type Secret,
  type Socket,
} from "@dagger.io/dagger";
import {
  blueprintFor,
  type ProjectProfile,
  resolveProfile,
  scaffoldSteps,
} from "./composition/profiles.ts";
import { updateCapabilities, validateCapabilities } from "./core/capability.ts";
import { carryFile, firstExisting, readOptionalFile } from "./core/files.ts";
import { mergeScaffoldPackage, scaffoldName } from "./core/package-json.ts";
import { renderToDirectory } from "./core/project.ts";
import { repositoryWorkflow } from "./core/repository.ts";
import { seedTemplates } from "./core/templates.ts";

/** Files whose presence means the project was already initialized. */
const INIT_MARKERS = ["catalog-info.yaml", ".atlassian/OWNER"];

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
   * With git, return repository.bundle and result.json instead of a worktree;
   * author identity is required and history supplies an existing repository.
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
    git = false,
    history?: File,
    targetBranch = "main",
    authorName = "",
    authorEmail = "",
  ): Promise<Directory> {
    if (git)
      return repositoryWorkflow(
        {
          operation: "init",
          directory,
          history,
          branch: targetBranch,
          authorName,
          authorEmail,
          publish: false,
          provenance: `Drop-Calf-Source: ${await dag.currentModule().source().digest()}\nProfile: ${profile}\nWith: ${withFunctions.join(",")}\nWithout: ${withoutFunctions.join(",")}\nPreset: ${preset ?? "default"}`,
        },
        (input) =>
          this.init(
            input,
            profile,
            owner,
            packageName,
            description,
            withFunctions,
            withoutFunctions,
            preset,
          ),
      );
    const capabilities = resolveProfile(
      profile,
      withFunctions,
      withoutFunctions,
      preset,
    );
    const marker = await firstExisting(directory, INIT_MARKERS);
    if (marker)
      throw new Error(
        `init is a one-time operation: ${marker} already exists; use update instead.`,
      );
    const scaffold = await readOptionalFile(directory, "package.json");
    let cleaned = directory;
    for (const step of scaffoldSteps(profile as ProjectProfile))
      cleaned = await step(cleaned);
    const name =
      packageName ??
      scaffoldName(scaffold) ??
      basename(fileURLToPath(await dag.currentWorkspace().address()));
    const project = blueprintFor(capabilities, name, owner, description);
    const rendered = await carryFile(
      renderToDirectory(project),
      cleaned,
      ".gitignore",
    );
    const seeded = await seedTemplates(
      rendered,
      dag.currentModule().source(),
      project.templates,
    );
    const kept = await readOptionalFile(cleaned, "package.json");
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

  /**
   * Apply selected update policies without scaffold steps. With git, return a
   * repository bundle and result.json, retaining an update branch and merge.
   * Supply history or remoteUrl; publish explicitly pushes both refs to remoteUrl.
   * Always inspect result.json: failures after preparation export recovery history.
   */
  @func({ cache: "never" })
  async update(
    directory: Directory,
    profile: string,
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
    git = false,
    history?: File,
    remoteUrl?: string,
    targetBranch = "main",
    authorName = "",
    authorEmail = "",
    publish = false,
    authHeader?: Secret,
    sshAgent?: Socket,
    knownHosts?: File,
  ): Promise<Directory> {
    if (publish && !git) throw new Error("Publication requires --git.");
    if (git)
      return repositoryWorkflow(
        {
          operation: "update",
          directory,
          history,
          remoteUrl,
          branch: targetBranch,
          authorName,
          authorEmail,
          publish,
          authHeader,
          sshAgent,
          knownHosts,
          provenance: `Drop-Calf-Source: ${await dag.currentModule().source().digest()}\nProfile: ${profile}\nWith: ${withFunctions.join(",")}\nWithout: ${withoutFunctions.join(",")}\nPreset: ${preset ?? "default"}`,
        },
        (input) =>
          this.update(input, profile, withFunctions, withoutFunctions, preset),
      );
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
