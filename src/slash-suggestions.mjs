import { getZyraAvailableModels, getZyraAvailableThinkingLevels, getZyraThinkingLevel, listCustomCommands, listZyraProfiles, listZyraSkills, listZyraThemes } from "./zyra-sdk.mjs";
import { applyFileMentionSuggestion, getFileMentionSuggestions } from "./file-mentions.mjs";
import { getModelCompatibilityLabel } from "./model-compatibility.mjs";
import { ACCESS_MODES, CODEX_MODES, getSlashCommand, INTERRUPT_MODES, listSlashCommandSuggestions, NOTIFICATION_MODES, STATUS_LINE_MODES } from "./slash-commands.mjs";

export function getSlashSuggestions(runtime, text) {
  const agentMentions = getAgentMentionSuggestions(runtime, text);
  if (agentMentions.length > 0) return agentMentions;
  const fileMentions = getFileMentionSuggestions(runtime, text);
  if (fileMentions.length > 0) return fileMentions;

  if (!text.startsWith("/")) return [];

  const query = text.toLowerCase();
  if (query.startsWith("/agent ")) {
    const prefix = query.slice("/agent ".length);
    if (!prefix.includes(" ")) {
      return (runtime.fleet?.listDefinitions?.().active ?? [])
        .filter((entry) => entry.name.startsWith(prefix))
        .map((entry) => ({
          value: entry.name,
          label: entry.name,
          description: entry.definition?.description ?? "agent definition",
          kind: "agent-definition",
          submitOnEnter: false,
        }));
    }
  }

  if (query.startsWith("/workflow ")) {
    const prefix = query.slice("/workflow ".length);
    if (!prefix.includes(" ")) {
      return (runtime.workflows?.listDefinitions?.().active ?? [])
        .filter((entry) => entry.definition.name.startsWith(prefix))
        .map((entry) => ({
          value: entry.definition.name,
          label: entry.definition.name,
          description: entry.definition.description,
          kind: "workflow-definition",
          submitOnEnter: false,
        }));
    }
  }

  if (query.startsWith("/auth ") || query.startsWith("/account ") || query.startsWith("/login ") || query.startsWith("/logout ")) {
    const command = query.slice(0, query.indexOf(" ") + 1);
    return buildSimpleArgumentSuggestions(["subscription", "api"], query.slice(command.length), "authentication method");
  }

  if (query.startsWith("/thinking ")) {
    const prefix = query.slice("/thinking ".length);
    const active = getZyraThinkingLevel(runtime);
    return getZyraAvailableThinkingLevels(runtime)
      .filter((level) => level.startsWith(prefix))
      .map((level) => ({
        value: level,
        label: level,
        description: level === active ? "active" : "thinking effort",
        kind: "argument",
        selected: level === active,
        submitOnEnter: true,
      }));
  }

  if (query.startsWith("/profile ")) {
    const prefix = query.slice("/profile ".length);
    return listZyraProfiles(runtime.project)
      .filter((profile) => profile.name.startsWith(prefix))
      .map((profile) => ({
        value: profile.name,
        label: profile.name,
        description: profile.description,
        kind: "argument",
        submitOnEnter: true,
      }));
  }

  if (query.startsWith("/web ")) {
    const prefix = query.slice("/web ".length);
    return ["all", "none", "websearch", "webfetch"]
      .filter((value) => value.startsWith(prefix))
      .map((value) => ({
        value,
        label: value,
        description: "web tools",
        kind: "argument",
        submitOnEnter: true,
      }));
  }

  if (query.startsWith("/websearch ") || query.startsWith("/web-search ") || query.startsWith("/webfetch ") || query.startsWith("/web-fetch ")) {
    const command = query.startsWith("/web-search ")
      ? "/web-search "
      : query.startsWith("/webfetch ")
        ? "/webfetch "
        : query.startsWith("/web-fetch ")
          ? "/web-fetch "
          : "/websearch ";
    const prefix = query.slice(command.length);
    return ["on", "off"]
      .filter((value) => value.startsWith(prefix))
      .map((value) => ({
        value,
        label: value,
        description: "web search",
        kind: "argument",
        submitOnEnter: true,
      }));
  }

  if (query.startsWith("/statusline ") || query.startsWith("/status-line ")) {
    const command = query.startsWith("/status-line ") ? "/status-line " : "/statusline ";
    return buildSimpleArgumentSuggestions(STATUS_LINE_MODES, query.slice(command.length), "status line mode");
  }

  if (query.startsWith("/mode ") || query.startsWith("/tier ") || query.startsWith("/service-tier ") || query.startsWith("/codex-mode ")) {
    const command = query.startsWith("/tier ")
      ? "/tier "
      : query.startsWith("/service-tier ")
        ? "/service-tier "
        : query.startsWith("/codex-mode ")
          ? "/codex-mode "
          : "/mode ";
    return buildSimpleArgumentSuggestions(CODEX_MODES, query.slice(command.length), "Codex mode");
  }

  if (query.startsWith("/notifications ") || query.startsWith("/notify ")) {
    const command = query.startsWith("/notify ") ? "/notify " : "/notifications ";
    return buildSimpleArgumentSuggestions(NOTIFICATION_MODES, query.slice(command.length), "notification mode");
  }

  if (query.startsWith("/interrupt ") || query.startsWith("/interupt ") || query.startsWith("/interruption ") || query.startsWith("/midrun ") || query.startsWith("/mid-run ")) {
    const command = query.startsWith("/interupt ")
      ? "/interupt "
      : query.startsWith("/interruption ")
        ? "/interruption "
        : query.startsWith("/midrun ")
          ? "/midrun "
          : query.startsWith("/mid-run ")
            ? "/mid-run "
            : "/interrupt ";
    return buildSimpleArgumentSuggestions(INTERRUPT_MODES, query.slice(command.length), "mid-run Enter behavior");
  }

  if (query.startsWith("/themes ") || query.startsWith("/theme ")) {
    const command = query.startsWith("/theme ") ? "/theme " : "/themes ";
    const prefix = query.slice(command.length);
    return listZyraThemes(runtime)
      .filter((theme) => `${theme.name} ${theme.displayName ?? ""} ${theme.description ?? ""}`.toLowerCase().includes(prefix))
      .map((theme) => ({
        value: theme.name,
        label: theme.name,
        description: theme.name === runtime.terminalTheme?.name ? "active" : (theme.displayName ?? theme.description ?? theme.source),
        kind: "theme",
        selected: theme.name === runtime.terminalTheme?.name,
        previewTheme: theme,
        preview: buildThemePreview(theme),
        submitOnEnter: true,
      }));
  }

  if (query.startsWith("/models ")) {
    const prefix = query.slice("/models ".length);
    const custom = {
      value: "",
      label: "custom",
      description: "type provider/model",
      kind: "custom-model",
    };
    const models = getZyraAvailableModels(runtime.session.modelRegistry)
      .filter((model) => `${model.provider}/${model.id} ${model.name ?? ""}`.toLowerCase().includes(prefix))
      .map((model) => {
        const compatibilityLabel = getModelCompatibilityLabel(model);
        return {
          value: `${model.provider}/${model.id}`,
          label: `${model.provider}/${model.id}`,
          description: compatibilityLabel
            ?? (model.provider === runtime.session.model?.provider && model.id === runtime.session.model?.id
              ? "active"
              : (model.name ?? model.id)),
          kind: "argument",
          submitOnEnter: true,
        };
      });
    return prefix ? models : [...models, custom];
  }

  const prefix = query.slice(1);
  const customCommands = listCustomCommands(runtime)
    .filter((command) => !getSlashCommand(command.name))
    .map((command) => ({
      value: `/${command.name}`,
      label: `/${command.name}`,
      description: command.description,
      kind: "command",
      submitOnEnter: false,
    }));
  const skills = listZyraSkills(runtime).map((skill) => ({
    value: `/skill:${skill.name}`,
    label: `/skill:${skill.name}`,
    description: skill.description,
    kind: "skill",
    submitOnEnter: false,
  }));
  return [...listSlashCommandSuggestions(prefix), ...customCommands, ...skills]
    .filter((item) => item.label.slice(1).startsWith(prefix));
}

export function applySlashSuggestion(text, item) {
  if (!item) return text;

  if (item.kind === "file-mention") {
    return applyFileMentionSuggestion(text, item);
  }

  if (item.kind === "agent-mention") {
    const token = findAgentMentionToken(text);
    return token ? `${text.slice(0, token.start)}${item.value}${text.slice(token.end)}` : `${text}${item.value}`;
  }

  if (item.kind === "agent-definition") return `/agent ${item.value} `;
  if (item.kind === "workflow-definition") return `/workflow ${item.value} `;

  if (item.kind === "command") {
    return item.submitOnEnter ? item.value : `${item.value} `;
  }

  if (query.startsWith("/access ") || query.startsWith("/permissions ")) {
    const command = query.startsWith("/permissions ") ? "/permissions " : "/access ";
    return buildSimpleArgumentSuggestions(ACCESS_MODES, query.slice(command.length), "permission mode");
  }

  if (item.kind === "skill") return `${item.value} `;

  if (item.kind === "custom-model") {
    return "/models ";
  }

  if (item.kind === "theme") {
    const command = text.toLowerCase().startsWith("/theme ") ? "/theme " : "/themes ";
    return `${command}${item.value}`;
  }

  const spaceIndex = text.indexOf(" ");
  if (spaceIndex === -1) {
    return item.value;
  }

  const command = text.slice(0, spaceIndex + 1);
  return `${command}${item.value}`;
}

function getAgentMentionSuggestions(runtime, text) {
  const token = findAgentMentionToken(text);
  if (!token) return [];
  const query = token.value.slice("@agent-".length).toLowerCase();
  return (runtime.fleet?.listDefinitions?.().active ?? [])
    .filter((entry) => entry.name.includes(query))
    .map((entry) => ({
      value: `@agent-${entry.name}`,
      label: `@agent-${entry.name}`,
      description: entry.definition?.description ?? "agent",
      kind: "agent-mention",
      agentName: entry.name,
    }));
}

function findAgentMentionToken(text) {
  const value = String(text ?? "");
  const matches = [...value.matchAll(/@agent-[a-z0-9-]*/gi)];
  const match = matches.at(-1);
  if (!match || match.index === undefined || match.index + match[0].length !== value.length) return null;
  return { value: match[0], start: match.index, end: match.index + match[0].length };
}

function buildThemePreview(theme) {
  const colors = theme?.colors ?? {};
  return [colors.primary, colors.accent, colors.success, colors.warning]
    .filter(Boolean)
    .slice(0, 4)
    .map((color) => colorBlock(color))
    .join("");
}

function colorBlock(color) {
  const rgb = parseHexColor(color);
  if (rgb) return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m  \x1b[0m`;
  const number = Number(color);
  if (Number.isFinite(number)) return `\x1b[48;5;${Math.max(0, Math.min(255, Math.round(number)))}m  \x1b[0m`;
  return "";
}

function buildSimpleArgumentSuggestions(values, prefix, description) {
  return values
    .filter((value) => value.startsWith(prefix))
    .map((value) => ({
      value,
      label: value,
      description,
      kind: "argument",
      submitOnEnter: true,
    }));
}

function parseHexColor(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return undefined;
  const hex = match[1].length === 3
    ? match[1].split("").map((char) => `${char}${char}`).join("")
    : match[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}
