# Development

Install dependencies with `npm install`.
Run the checks before sending a pull request:

```sh
npm run lint
npm run lint:docs
npm run format:check
npm run typecheck
npm run test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution process.

## First-time Forge setup with Fence Rider

The `forge:*` package scripts use [Fence Rider][fence-rider] to wrap the
Forge CLI. It resolves configuration declared in `secretspec.toml` through
[SecretSpec](https://secretspec.dev) and your chosen secret provider. Local
controls select the site, product, and environment; manifest inputs are supplied
to Forge locally; only variables listed in `[scopes.runtime]` are uploaded,
always encrypted. Fence Rider is development tooling, not part of the deployed
app.

Complete these steps from the repository root before your first Forge workflow:

1. Install the tools described in Fence Rider's [installation guide][installation].
   Dependency installation supplies Fence Rider, but you also need Bun,
   SecretSpec, and the Forge CLI available on `PATH`. Follow the
   [Forge getting-started guide][forge-setup] to authenticate; Fence Rider does
   not install these tools or log you in. Check the installed tool versions:

   ```sh
   bun run fence-rider doctor
   ```

   This checks tools only, not whether your app configuration resolves.

2. Confirm access to the app and development site you intend to use. If you
   cloned a sample and need your own app registration, follow the
   [`forge register` reference][register] once. Registration changes the app ID
   in `manifest.yml`; do not repeat it for an app you already own or are
   authorized to develop.

3. Follow [workstation provider setup][providers], then
   [app requirements and secret storage][app-secrets]. Review this repository's
   existing `secretspec.toml` rather than replacing it: retain its project name,
   configure provider routes, and store values in your approved provider.
   Commit declarations, never credentials or a secret value as a `default`.
   Keep any local value files out of Git.

4. Review the [local target settings][local] for `FORGE_SITE`, `FORGE_PRODUCT`,
   and `FORGE_ENVIRONMENT` in the default profile. Choose your development site
   and environment before continuing. These controls stay local; do not add
   them to `[scopes.runtime]`. If the app uses manifest inputs, follow the
   [manifest configuration guide][manifest]. Check resolution without printing
   secret values:

   ```sh
   SECRETSPEC_PROFILE=default bun run fence-rider doctor --resolve
   ```

   This may access your provider and require authentication. It does not
   display or confirm the target values; review those separately.

5. Once authorized to change the selected app, site, and environment, upload
   runtime variables, deploy, and install:

   ```sh
   npm run forge:variables:set && npm run forge:deploy && npm run forge:install
   ```

   **These commands change remote state.** Keep the same configured environment
   for upload and deployment; do not override only the deployment target.
   Stored runtime variables become active on the subsequent deployment.
   For code-only changes with unchanged runtime values, run `npm run forge:deploy`.
   After permission scope changes, run `npm run forge:upgrade` for existing
   installations. See [runtime workflows][runtime] and
   [installation management][forge-tooling] for details.

For a guided exercise with disposable values, follow the
[Fence Rider tutorial][tutorial]. Its example script names differ from this
repository's `forge:*` names; use the scripts in this repository's `package.json`.

[fence-rider]: https://github.com/ibuchanan/ranch-rig-fence-rider
[installation]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/installation.md
[forge-setup]: https://developer.atlassian.com/platform/forge/getting-started/
[register]: https://developer.atlassian.com/platform/forge/cli-reference/register/
[providers]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/configure-user-providers.md
[app-secrets]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/configure-app-secrets.md
[local]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/local.md
[manifest]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/manifest.md
[runtime]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/runtime.md
[forge-tooling]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/use-forge-tooling.md
[tutorial]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/tutorials/tutorial.md
