export const STATUS_LINE_MODES = ["default", "minimal", "full", "off"];
export const NOTIFICATION_MODES = ["unfocused", "always", "off"];
export const INTERRUPT_MODES = ["steer", "queue"];
export const CODEX_MODES = ["normal", "fast", "cheap", "auto"];
export const ACCESS_MODES = ["supervised", "auto", "edits", "full"];

const slashCommands = [
  {
    name: "commands",
    aliases: ["help"],
    description: "show controls",
    submitOnEnter: true,
  },
  {
    name: "agents",
    description: "inspect and manage child agents",
    panelLabel: "/agents [doctor|import claude]",
    submitOnEnter: true,
  },
  {
    name: "agent",
    description: "run or control a named child agent",
    panelLabel: "/agent <name> <task>",
    submitOnEnter: true,
  },
  {
    name: "subtask",
    description: "fork this chat into a focused child task",
    panelLabel: "/subtask <task>",
    submitOnEnter: true,
  },
  {
    name: "workflows",
    description: "inspect and manage workflow runs",
    submitOnEnter: true,
  },
  {
    name: "workflow",
    description: "run a saved workflow",
    panelLabel: "/workflow <name> [json args]",
    submitOnEnter: true,
  },
  {
    name: "compact",
    description: "compact active context",
    panelLabel: "/compact [notes]",
    submitOnEnter: true,
    terminalState: "compacting",
  },
  {
    name: "consolidate",
    description: "consolidate Zyra memory",
    submitOnEnter: true,
    terminalState: "compacting",
  },
  {
    name: "analytics",
    description: "view or change product analytics",
    panelLabel: "/analytics [status|on|off]",
    inlineArgs: ["status", "on", "off"],
  },
  {
    name: "statusline",
    aliases: ["status-line"],
    description: "edit the bottom status line",
    panelLabel: "/statusline [mode]",
    inlineArgs: STATUS_LINE_MODES,
  },
  {
    name: "notifications",
    aliases: ["notify"],
    description: "set terminal bell behavior",
    panelLabel: "/notifications [mode]",
    inlineArgs: NOTIFICATION_MODES,
  },
  {
    name: "interrupt",
    aliases: ["interupt", "interruption", "midrun", "mid-run"],
    description: "set mid-run Enter behavior",
    panelLabel: "/interrupt [steer|queue]",
    inlineArgs: INTERRUPT_MODES,
  },
  {
    name: "start",
    description: "ask for the repo starting point",
    submitOnEnter: true,
    availableDuringTask: false,
    terminalState: "working",
  },
  {
    name: "new",
    description: "start a fresh chat",
    submitOnEnter: true,
    availableDuringTask: false,
  },
  {
    name: "session",
    description: "project, model, usage, and thread ID",
    panelLabel: "/session [copy]",
    submitOnEnter: true,
  },
  {
    name: "chat",
    description: "browse or inspect canonical chats",
    submitOnEnter: true,
  },
  {
    name: "older",
    aliases: ["history"],
    description: "load the previous transcript page",
    submitOnEnter: true,
    availableDuringTask: false,
  },
  {
    name: "profile",
    description: "show or switch profile overlay",
    panelLabel: "/profile [name]",
    inlineArgs: ["auto", "default", "learner", "builder"],
  },
  {
    name: "thinking",
    aliases: ["effort"],
    description: "cycle or set thinking effort",
    panelLabel: "/thinking [level]",
  },
  {
    name: "mode",
    aliases: ["tier", "service-tier", "codex-mode"],
    description: "set Codex mode",
    panelLabel: "/mode [normal|fast|cheap|auto]",
    inlineArgs: CODEX_MODES,
  },
  {
    name: "access",
    aliases: ["permissions"],
    description: "set tool approval mode",
    panelLabel: "/access [supervised|auto|edits|full]",
    inlineArgs: ACCESS_MODES,
  },
  {
    name: "themes",
    aliases: ["theme"],
    description: "pick a theme",
    panelLabel: "/themes [name]",
  },
  {
    name: "models",
    description: "pick or refresh models",
    panelLabel: "/models [provider/model|refresh]",
  },
  {
    name: "memory",
    description: "toggle memory logging for this chat",
    submitOnEnter: true,
  },
  {
    name: "browser",
    description: "open Zyra Browser",
    panelLabel: "/browser [url|list|show] [--background]",
    submitOnEnter: true,
  },
  {
    name: "details-ui",
    description: "open graphical chat details",
    submitOnEnter: true,
  },
  {
    name: "explore-files",
    description: "open the graphical file explorer",
    panelLabel: "/explore-files [path]",
    submitOnEnter: true,
  },
  {
    name: "resources",
    description: "open graphical chat resources",
    submitOnEnter: true,
  },
  {
    name: "subagents-ui",
    aliases: ["agents-ui"],
    description: "open graphical agents and workflows",
    submitOnEnter: true,
  },
  {
    name: "diff-ui",
    description: "open graphical chat diffs",
    submitOnEnter: true,
  },
  {
    name: "terminal-ui",
    description: "open a graphical terminal",
    panelLabel: "/terminal-ui [path]",
    submitOnEnter: true,
  },
  {
    name: "web",
    description: "choose web tools",
    inlineArgs: ["all", "none", "websearch", "webfetch"],
    submitOnEnter: true,
  },
  {
    name: "websearch",
    aliases: ["web-search"],
    description: "toggle web search",
    panelLabel: "/websearch [on|off]",
    inlineArgs: ["on", "off"],
    submitOnEnter: true,
  },
  {
    name: "webfetch",
    aliases: ["web-fetch"],
    description: "toggle page fetching",
    panelLabel: "/webfetch [on|off]",
    inlineArgs: ["on", "off"],
    submitOnEnter: true,
  },
  {
    name: "auth",
    aliases: ["account"],
    description: "show or switch API/subscription",
    panelLabel: "/auth [subscription|api]",
    inlineArgs: ["subscription", "api"],
    submitOnEnter: true,
  },
  {
    name: "codexusage",
    aliases: ["usage"],
    description: "show Codex quota, reset windows, and banked resets",
    submitOnEnter: true,
  },
  {
    name: "codexresets",
    aliases: ["resets"],
    description: "select and redeem a banked Codex reset",
    submitOnEnter: true,
    availableDuringTask: false,
  },
  {
    name: "codexresetlist",
    aliases: ["resetlist"],
    description: "list banked Codex reset status and expiry",
    submitOnEnter: true,
  },
  {
    name: "login",
    description: "connect API or subscription",
    panelLabel: "/login [subscription|api]",
    inlineArgs: ["subscription", "api"],
    submitOnEnter: true,
  },
  {
    name: "logout",
    description: "disconnect API or subscription",
    panelLabel: "/logout [subscription|api]",
    inlineArgs: ["subscription", "api"],
    submitOnEnter: true,
  },
  {
    name: "reload",
    aliases: ["realod"],
    description: "reload Zyra from disk and resume",
    submitOnEnter: true,
  },
  {
    name: "exit",
    aliases: ["quit"],
    description: "leave",
    panelLabel: "/exit, /quit",
    submitOnEnter: true,
  },
];

const commandLookup = new Map();

for (const command of slashCommands) {
  const normalized = normalizeSlashCommand(command.name);
  commandLookup.set(normalized, command);
  for (const alias of command.aliases ?? []) {
    commandLookup.set(normalizeSlashCommand(alias), command);
  }
}

export function listSlashCommands(options = {}) {
  const includeHidden = Boolean(options.includeHidden);
  return slashCommands.filter((command) => includeHidden || !command.hidden);
}

export function listSlashCommandSuggestions(prefix = "") {
  const normalizedPrefix = normalizeSlashCommand(prefix);
  return listSlashCommands()
    .filter((command) => command.suggest !== false)
    .flatMap((command) => {
      const matchingNames = [command.name, ...(command.aliases ?? [])]
        .filter((name) => normalizeSlashCommand(name).startsWith(normalizedPrefix));
      const name = matchingNames.includes(command.name) ? command.name : matchingNames[0];
      if (!name) return [];
      return [{
        value: `/${name}`,
        label: `/${name}`,
        description: command.description,
        kind: "command",
        submitOnEnter: command.submitOnEnter === true,
      }];
    });
}

export function getSlashCommand(command) {
  return commandLookup.get(normalizeSlashCommand(command));
}

export function parseSlashInput(input) {
  const text = String(input ?? "").trim();
  const [rawCommand, ...rest] = text.split(/\s+/);
  const commandName = normalizeSlashCommand(rawCommand);
  return {
    text,
    rawCommand,
    commandName,
    command: getSlashCommand(commandName),
    arg: rest.join(" "),
  };
}

export function normalizeSlashCommand(command) {
  return String(command ?? "").trim().replace(/^\/+/, "").toLowerCase();
}
