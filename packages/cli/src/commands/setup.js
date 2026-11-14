import chalk from "chalk";
import ora from "ora";
import semver from "semver";
import {
  MIN_NODE_VERSION,
  LLM_PROVIDERS,
  EDITIONS,
  VERSION,
} from "../constants.js";
import { ensureHomeDir, getConfigPath } from "../lib/paths.js";
import { loadConfig } from "../lib/config-manager.js";
import {
  isDockerAvailable,
  isDockerComposeAvailable,
  servicesUp,
  findComposeFile,
} from "../lib/service-manager.js";
import { downloadRelease } from "../lib/downloader.js";
import {
  askConfirm,
  askSelect,
  askInput,
  askPassword,
} from "../lib/prompts.js";
import logger from "../lib/logger.js";
import {
  saveLlmConnection,
  llmConnectionIdentity,
  readLlmConnection,
} from "../lib/llm-connection-config.js";
import {
  LK_CHANNEL,
  LK_MODELS,
  resolveLkConnection,
} from "../lib/llm-channel-presets.js";
import {
  assessEvolutionDeploymentReadiness,
  getEvolutionDeploymentStatus,
} from "../lib/evolution/evolution-deployment-config.js";

export function registerSetupCommand(program) {
  program
    .command("setup")
    .description("Interactive setup wizard for ChainlessChain")
    .option("--skip-download", "Skip binary download")
    .option("--skip-services", "Skip Docker service setup")
    .action(async (options) => {
      try {
        await runSetup(options);
      } catch (err) {
        if (err.name === "ExitPromptError") {
          logger.log("\nSetup cancelled.");
          process.exit(0);
        }
        logger.error(`Setup failed: ${err.message}`);
        process.exit(1);
      }
    });
}

export function assertRequiredProviderCredential(providerInfo, apiKey) {
  if (providerInfo?.requiresApiKey && (apiKey === null || apiKey === "")) {
    const error = new Error("An API key is required for the selected provider");
    error.code = "SETUP_API_KEY_REQUIRED";
    throw error;
  }
}

export function resolveSetupLlmDefaults(provider, existing = {}) {
  const preset = LLM_PROVIDERS[provider];
  if (!preset) throw new Error("Unknown setup provider");
  const sameProvider = existing?.provider === provider;
  return {
    baseUrl:
      sameProvider &&
      typeof existing.baseUrl === "string" &&
      existing.baseUrl.trim()
        ? existing.baseUrl
        : preset.defaultBaseUrl,
    model:
      sameProvider &&
      typeof existing.model === "string" &&
      existing.model.trim()
        ? existing.model
        : preset.defaultModel,
  };
}

async function runSetup(options) {
  logger.log(chalk.bold("\n  ChainlessChain Setup Wizard\n"));
  logger.log(`  Version: ${VERSION}`);
  logger.log(`  Config: ${getConfigPath()}\n`);

  // Step 1: Check Node version
  const nodeVersion = process.versions.node;
  if (!semver.gte(nodeVersion, MIN_NODE_VERSION)) {
    logger.error(
      `Node.js ${MIN_NODE_VERSION}+ required (current: ${nodeVersion})`,
    );
    process.exit(1);
  }
  logger.success(`Node.js ${nodeVersion}`);

  // Step 2: Check Docker
  const dockerOk = isDockerAvailable();
  const composeOk = isDockerComposeAvailable();
  if (dockerOk) {
    logger.success("Docker available");
  } else {
    logger.warn("Docker not found (optional - needed for backend services)");
  }
  if (composeOk) {
    logger.success("Docker Compose available");
  }

  // Step 3: Ensure home directory
  ensureHomeDir();
  logger.success("Configuration directory ready");
  logger.newline();

  // Step 4: Select edition
  const edition = await askSelect("Select edition:", [
    {
      name: `${EDITIONS.personal.name} - ${EDITIONS.personal.description}`,
      value: "personal",
    },
    {
      name: `${EDITIONS.enterprise.name} - ${EDITIONS.enterprise.description}`,
      value: "enterprise",
    },
  ]);

  // Step 5: Configure LLM
  let existingLlm;
  try {
    existingLlm = loadConfig({
      resolveSecrets: false,
      failIfUnavailable: true,
    }).llm;
  } catch {
    throw new Error(
      "Could not read existing LLM configuration; repair it before running setup",
    );
  }
  const providerChoices = Object.entries(LLM_PROVIDERS).map(([key, info]) => ({
    name: info.name,
    value: key,
  }));
  providerChoices.push({ name: "LK API (聚合平台 / 主备渠道)", value: "lk" });
  const savedConnections = readLlmConnection().savedConnections;
  savedConnections.forEach((row, index) =>
    providerChoices.push({
      name: `已保存：${row.channel === "lk" ? "LK API" : row.provider} · ${row.baseUrl} · ${row.model}`,
      value: `saved:${index}`,
    }),
  );
  let provider = await askSelect("Select LLM provider:", providerChoices);
  let channelConnection;
  if (provider.startsWith("saved:")) {
    channelConnection = savedConnections[Number(provider.slice(6))];
    provider = channelConnection.provider;
  }
  if (provider === "lk") {
    const protocol = await askSelect(
      "Select LK protocol (FB-5.2 requires Anthropic):",
      ["anthropic", "openai", "gemini"].map((id) => ({
        name: LK_CHANNEL.protocols[id].label,
        value: id,
      })),
    );
    const address = await askSelect(
      "Select LK address (same service; switch manually if unreachable):",
      Object.entries(LK_CHANNEL.addresses).map(([id, url]) => ({
        name: `${id}: ${url}`,
        value: id,
      })),
    );
    const selectedModel = await askSelect("Select LK model:", [
      ...LK_MODELS.filter(
        (entry) =>
          entry.type === "chat" && entry.compatibleProtocols.includes(protocol),
      ).map((entry) => ({
        name: `${entry.label} (${entry.id})`,
        value: entry.id,
      })),
      { name: "Other model (enter exact ID)", value: "__custom__" },
    ]);
    const model =
      selectedModel === "__custom__"
        ? await askInput("Enter LK model name:")
        : selectedModel;
    if (!model?.trim()) throw new Error("An LK model name is required");
    channelConnection = resolveLkConnection(protocol, address, { model });
    provider = channelConnection.provider;
  }
  const providerInfo = LLM_PROVIDERS[provider];

  let apiKey = null;
  let { baseUrl, model } = resolveSetupLlmDefaults(provider, existingLlm);

  if (channelConnection) {
    baseUrl = channelConnection.baseUrl;
    model = channelConnection.model;
  } else if (provider === "custom" || providerInfo.isProxy) {
    baseUrl = await askInput("Enter API base URL:", baseUrl || "");
    model = await askInput("Enter model name:", model || "");
  } else {
    const customizeModel = await askConfirm(
      `Use default model (${model})?`,
      true,
    );
    if (!customizeModel) {
      model = await askInput("Enter model name:");
    }
  }

  const saved = readLlmConnection().savedConnections.find(
    (row) =>
      row.hasKey &&
      llmConnectionIdentity(row) ===
        llmConnectionIdentity({ provider, baseUrl }),
  );
  if (
    channelConnection ||
    providerInfo.requiresApiKey ||
    provider === "custom"
  ) {
    apiKey = await askPassword(
      saved
        ? "API key already saved for this channel (leave blank to restore):"
        : `Enter ${channelConnection ? LK_CHANNEL.name : providerInfo.name} API key:`,
    );
    if (!saved)
      assertRequiredProviderCredential(
        {
          requiresApiKey: Boolean(
            channelConnection || providerInfo.requiresApiKey,
          ),
        },
        apiKey,
      );
  }

  // Step 6: Download binary
  if (!options.skipDownload) {
    logger.newline();
    const doDownload = await askConfirm(
      "Download ChainlessChain desktop application?",
      true,
    );
    if (doDownload) {
      try {
        await downloadRelease(VERSION);
      } catch (err) {
        logger.warn(`Download failed: ${err.message}`);
        logger.info(
          "You can download manually later with: chainlesschain update",
        );
      }
    }
  }

  // Step 7: Save config
  const applySetupValues = (config) => {
    config.setupCompleted = true;
    config.completedAt = new Date().toISOString();
    config.edition = edition;
  };
  saveLlmConnection(
    {
      provider,
      baseUrl,
      model,
      apiKey: apiKey || "",
      visionModel: saved?.visionModel || "",
      allowHttp: true,
    },
    { configMutator: applySetupValues },
  );
  logger.success("Configuration saved");

  // Saving a provider setting does not itself authorize a content-bearing
  // request. Check command-specific deployment admission without executing the
  // host module; a successful preflight is not a model execution probe.
  const modelReadiness = assessEvolutionDeploymentReadiness(
    await getEvolutionDeploymentStatus(),
  );
  if (modelReadiness.ready) {
    logger.success("Signed deployment admits ask and agent");
    logger.info(
      "Runtime composition and model execution will be checked when you run a task.",
    );
  } else {
    logger.warn(
      `Model deployment prerequisites not met: ${modelReadiness.detail}`,
    );
    logger.info(`To enable it: ${modelReadiness.remediation}`);
  }

  // Step 8: Docker services
  if (!options.skipServices && dockerOk && composeOk) {
    logger.newline();
    const startServices = await askConfirm(
      "Start Docker backend services?",
      false,
    );
    if (startServices) {
      const composePath = findComposeFile([process.cwd(), "backend/docker"]);
      if (composePath) {
        const spinner = ora("Starting services...").start();
        try {
          servicesUp(composePath);
          spinner.succeed("Docker services started");
        } catch (err) {
          spinner.fail(`Failed to start services: ${err.message}`);
        }
      } else {
        logger.warn(
          'docker-compose.yml not found. Run from the project root or use "chainlesschain services up".',
        );
      }
    }
  }

  // Done
  logger.newline();
  logger.log(
    modelReadiness.ready
      ? chalk.bold.green(
          "  Setup saved; deployment prerequisites checked (model execution not tested).\n",
        )
      : chalk.bold.yellow(
          "  Setup saved; ask/agent deployment prerequisites remain incomplete.\n",
        ),
  );
  logger.log("  Next steps:");
  logger.log(
    `    ${chalk.cyan("chainlesschain start")}      Launch the desktop app`,
  );
  logger.log(
    `    ${chalk.cyan("chainlesschain services up")} Start backend services`,
  );
  logger.log(
    `    ${chalk.cyan("chainlesschain status")}     Check system status`,
  );
  logger.log(
    `    ${chalk.cyan("chainlesschain doctor")}     Diagnose environment`,
  );
  logger.newline();
}

// === Iter27 V2 governance overlay ===
export function registerDlgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "setup");
  if (!parent) return;
  const L = async () => await import("../lib/downloader.js");
  parent
    .command("dlgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.DLGOV_PROFILE_MATURITY_V2,
            downloadLifecycle: m.DLGOV_DOWNLOAD_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("dlgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveDlgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingDlgovDownloadsPerProfileV2(),
            idleMs: m.getDlgovProfileIdleMsV2(),
            stuckMs: m.getDlgovDownloadStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("dlgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveDlgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dlgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingDlgovDownloadsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dlgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setDlgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dlgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setDlgovDownloadStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("dlgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--mirror <v>", "mirror")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerDlgovProfileV2({ id, owner, mirror: o.mirror }),
          null,
          2,
        ),
      );
    });
  parent
    .command("dlgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateDlgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("dlgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).staleDlgovProfileV2(id), null, 2));
    });
  parent
    .command("dlgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveDlgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("dlgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchDlgovProfileV2(id), null, 2));
    });
  parent
    .command("dlgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getDlgovProfileV2(id), null, 2));
    });
  parent
    .command("dlgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listDlgovProfilesV2(), null, 2));
    });
  parent
    .command("dlgov-create-download-v2 <id> <profileId>")
    .description("Create download")
    .option("--url <v>", "url")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createDlgovDownloadV2({ id, profileId, url: o.url }),
          null,
          2,
        ),
      );
    });
  parent
    .command("dlgov-fetching-download-v2 <id>")
    .description("Mark download as fetching")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).fetchingDlgovDownloadV2(id), null, 2),
      );
    });
  parent
    .command("dlgov-complete-download-v2 <id>")
    .description("Complete download")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeDownloadDlgovV2(id), null, 2),
      );
    });
  parent
    .command("dlgov-fail-download-v2 <id> [reason]")
    .description("Fail download")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failDlgovDownloadV2(id, reason), null, 2),
      );
    });
  parent
    .command("dlgov-cancel-download-v2 <id> [reason]")
    .description("Cancel download")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelDlgovDownloadV2(id, reason), null, 2),
      );
    });
  parent
    .command("dlgov-get-download-v2 <id>")
    .description("Get download")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getDlgovDownloadV2(id), null, 2));
    });
  parent
    .command("dlgov-list-downloads-v2")
    .description("List downloads")
    .action(async () => {
      console.log(JSON.stringify((await L()).listDlgovDownloadsV2(), null, 2));
    });
  parent
    .command("dlgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleDlgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("dlgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck downloads")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckDlgovDownloadsV2(), null, 2),
      );
    });
  parent
    .command("dlgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getDownloaderGovStatsV2(), null, 2),
      );
    });
}
