import os from "node:os";
import { formatCodexUsageWindowLabel, listCodexUsageWindows } from "./codex-usage-windows.mjs";
import { buildTerminalTheme } from "./terminal-theme.mjs";
import { buildRecoveryPresentation } from "./network-recovery.mjs";

const bold = "\x1b[1m";
const reset = "\x1b[0m";
const fallbackTheme = buildTerminalTheme();
const standardPanelMinWidth = 64;
const standardPanelMaxWidth = 112;

function standardPanelWidth(terminalColumns = 100) {
  return Math.max(standardPanelMinWidth, Math.min(standardPanelMaxWidth, Number(terminalColumns || 100) - 1));
}

export function renderProgressBox(progress = {}, theme = fallbackTheme, terminalColumns = 100) {
  const width = Math.max(56, Math.min(92, Number(terminalColumns || 100) - 1));
  const contentWidth = width - 4;
  const percent = clamp(Number(progress.percent) || 0, 0, 100);
  const rows = [
    `${bold}${theme.primary}${progress.title ?? "Working"}${reset} ${theme.muted}${formatPercent(percent)}${reset}`,
    `${theme.warning}${truncatePlain(progress.label ?? "working", 26).padEnd(26)}${reset} ${progressBar(percent, theme)}`,
    `${theme.muted}${truncatePlain(progress.detail ?? "reading project", contentWidth)}${reset}`,
  ];
  const border = `${theme.primary}+${"-".repeat(width - 2)}+${reset}`;
  return [
    "",
    border,
    ...rows.map((row) => boxedStatusLine(row, contentWidth, theme)),
    border,
    "",
  ];
}

export function renderStatusBox(status = {}, theme = fallbackTheme, terminalColumns = 100) {
  const width = standardPanelWidth(terminalColumns);
  const contentWidth = Math.max(24, width - 4);
  const valueWidth = Math.max(16, contentWidth - 32);
  const rows = [
    `${bold}${theme.primary}>_ Zyra thread${reset} ${theme.muted}${status.sessionName ? status.sessionName : "live thread"}${reset}`,
    "",
    alignedField("Model", status.model, theme, valueWidth),
    alignedField("Directory", formatHomePath(status.project), theme, valueWidth),
    alignedField("Profile", status.profile ?? "auto", theme, valueWidth),
    alignedField("Thinking", status.thinking ?? "off", theme, valueWidth),
    alignedField("Mode", status.codexServiceTier ?? "normal", theme, valueWidth),
    alignedField("Web", formatWebStatus(status), theme, valueWidth),
    alignedField("Interrupt", formatInterruptMode(status.interruptMode), theme, valueWidth),
    alignedField("Theme", status.terminalTheme ?? "default", theme, valueWidth),
    alignedField("Thread", status.threadId ?? status.sessionId, theme, valueWidth),
    alignedField("Presence", formatPresence(status.presence), theme, valueWidth),
    alignedField("Thread file", formatHomePath(status.sessionFile), theme, valueWidth),
    alignedField("Threads dir", formatHomePath(status.sessions), theme, valueWidth),
    "",
    alignedField("Context", renderContextSummary(status, theme), theme, valueWidth),
    alignedField("Tokens", renderTokenSummary(status.usage), theme, valueWidth),
    alignedField("Cost", `$${Number(status.usage?.cost || 0).toFixed(4)}`, theme, valueWidth),
  ];

  if (status.projectMemory?.length) {
    rows.push(alignedField("Project memory", status.projectMemory.join(", "), theme, valueWidth));
  }
  if (status.customCommands?.length) {
    rows.push(alignedField("Custom commands", status.customCommands.map((command) => `/${command.name}`).join(", "), theme, valueWidth));
  }

  return renderBox(rows, theme, width, contentWidth);
}

export function renderCommandsBox(theme = fallbackTheme, terminalColumns = 100, commands = []) {
  const width = standardPanelWidth(terminalColumns);
  const contentWidth = Math.max(24, width - 4);
  const commandWidth = 25;
  const rows = [
    `${bold}${theme.primary}>_ Slash commands${reset}`,
    `${theme.muted}Type a command, or use Tab / arrow keys to complete suggestions.${reset}`,
    "",
    ...renderRegisteredCommandRows(commands, theme, commandWidth),
    commandRow("/reload --soft", "reload commands, themes, prompt, and memory only", theme, commandWidth),
    "",
    commandRow("@file", "search and attach project files in prompts", theme, commandWidth),
    commandRow("/<custom>", "run .zyra/commands/<custom>.md", theme, commandWidth),
    "",
    commandRow("zyra auth", "show account, plan, and Codex limits", theme, commandWidth),
    commandRow("zyra onboarding", "replay first-run setup", theme, commandWidth),
    commandRow("zyra --update", "update this Zyra install from GitHub", theme, commandWidth),
    commandRow("zyra -p \"...\"", "print one answer and exit", theme, commandWidth),
  ];
  return renderBox(rows, theme, width, contentWidth);
}

function renderRegisteredCommandRows(commands, theme, commandWidth) {
  if (!commands.length) return [];
  return commands.map((command) => {
    return commandRow(command.panelLabel ?? `/${command.name}`, command.description, theme, commandWidth);
  });
}

export function renderAccountStatusBox(account = {}, theme = fallbackTheme, terminalColumns = 100) {
  const width = standardPanelWidth(terminalColumns);
  const contentWidth = Math.max(24, width - 4);
  const valueWidth = Math.max(16, contentWidth - 10);
  const status = account.status?.configured ? "logged in" : "not logged in";
  const source = account.status?.source ? ` (${account.status.source})` : "";
  const rows = [
    `${bold}${theme.primary}ChatGPT / Codex account${reset} ${theme.muted}${account.provider ?? "openai-codex"}${reset}`,
    `${theme.muted}account, token, plan, and quota windows${reset}`,
    "",
    statusField("status", `${status}${source}`, theme, valueWidth, account.status?.configured ? theme.success : theme.error),
    statusField("email", `${account.email ?? "unknown"}${account.emailVerified === true ? " ✓" : ""}`, theme, valueWidth, theme.info),
    statusField("plan", account.plan ?? "unknown", theme, valueWidth, theme.accent),
    statusField("account", shortAccountId(account.accountId), theme, valueWidth),
    statusField("token", account.tokenExpiresAt ? `expires ${formatAccountDateTime(account.tokenExpiresAt)}` : "unknown", theme, valueWidth),
    "",
  ];

  if (account.usage) {
    rows.push(...renderLimitRows(account.usage, theme));
  } else if (account.usageError) {
    rows.push(statusField("limits", `unavailable - ${account.usageError}`, theme, valueWidth, theme.warning));
  } else {
    rows.push(statusField("limits", "not checked", theme, valueWidth));
  }
  rows.push("", statusField("updated", formatAccountDateTime(account.updatedAt), theme, valueWidth));

  return renderBox(rows, theme, width, contentWidth);
}

export function renderCodexUsageBox(stats = {}, theme = fallbackTheme, terminalColumns = 100) {
  const width = standardPanelWidth(terminalColumns);
  const contentWidth = Math.max(24, width - 4);
  const valueWidth = Math.max(16, contentWidth - 10);
  const rows = [
    `${bold}${theme.primary}Codex usage${reset} ${theme.muted}quota + reset windows${reset}`,
    "",
  ];
  if (stats.account) rows.push(statusField("account", stats.account, theme, valueWidth, theme.info));
  rows.push(
    statusField("source", stats.source ?? "unknown", theme, valueWidth),
    statusField("plan", stats.plan ?? "unknown", theme, valueWidth, theme.accent),
    ...(stats.availableResetCount === undefined
      ? []
      : [statusField("banked", `${stats.availableResetCount} reset${stats.availableResetCount === 1 ? "" : "s"}`, theme, valueWidth, theme.info)]),
    "",
    ...renderLimitRows(stats, theme),
    "",
    statusField("updated", formatAccountDateTime(stats.updatedAt), theme, valueWidth),
  );
  return renderBox(rows, theme, width, contentWidth);
}

export function renderRetryBlock(event, theme = fallbackTheme, terminalColumns = 100) {
  const width = Math.max(24, Number(terminalColumns || 100) - 1);
  const presentation = buildRecoveryPresentation(event);
  const color = presentation.status === "recovered"
    ? theme.success
    : presentation.status === "paused"
      ? theme.warning
      : theme.accent;
  const marker = presentation.status === "recovered" ? "✓" : presentation.status === "paused" ? "!" : "↻";
  const line = `  ${color}${marker} ${truncatePlain(presentation.label, Math.max(1, width - 4))}${reset}`;
  return ["", line];
}

function progressBar(percent, theme = fallbackTheme) {
  const width = 24;
  const value = clamp(Number(percent) || 0, 0, 100);
  const filled = Math.round((value / 100) * width);
  const color = value >= 90 ? theme.success : value >= 55 ? theme.accent : theme.warning;
  return `[${color}${"#".repeat(filled)}${theme.muted}${"-".repeat(width - filled)}${reset}]`;
}

function statusField(label, value, theme = fallbackTheme, valueWidth = 80, valueStyle = "") {
  return `${theme.warning}${label.padEnd(8)}${reset} ${valueStyle}${truncatePlain(String(value ?? "none"), valueWidth)}${reset}`;
}

function alignedField(label, value, theme = fallbackTheme, valueWidth = 80) {
  const labelText = `${String(label ?? "").padEnd(27)}:`;
  return `  ${theme.warning}${labelText}${reset} ${truncateVisible(String(value ?? "none"), valueWidth)}`;
}

function commandRow(command, description, theme = fallbackTheme, commandWidth = 24) {
  const descriptionStyle = theme.menuDescriptionFg ?? theme.muted;
  return `  ${theme.primary}${String(command ?? "").padEnd(commandWidth)}${reset} ${descriptionStyle}${description ?? ""}${reset}`;
}

function renderContextSummary(status = {}, theme = fallbackTheme) {
  const usage = status.usage ?? {};
  const context = status.contextUsage ?? {};
  const percent = typeof context.percent === "number" && Number.isFinite(context.percent) ? clamp(context.percent, 0, 100) : undefined;
  const used = percent ?? (usage.total ? 0 : 0);
  const left = percent === undefined ? "unknown" : `${formatPercent(Math.max(0, 100 - used))} left`;
  return `${contextBar(used, theme)} ${left}`;
}

function renderTokenSummary(usage = {}) {
  const total = formatNumber(usage.total);
  const input = formatNumber(usage.input);
  const output = formatNumber(usage.output);
  return `${total} total (${input} in / ${output} out)`;
}

function formatWebStatus(status = {}) {
  if (status.webSearch && status.webFetch) return "all on";
  if (!status.webSearch && !status.webFetch) return "off";
  if (status.webSearch) return "search";
  return "fetch";
}

function formatPresence(presence) {
  if (!presence || typeof presence !== "object") return "local";
  const surfaces = [...new Set((Array.isArray(presence.clients) ? presence.clients : [])
    .map((client) => String(client?.surface || "").trim().toLowerCase())
    .filter(Boolean))]
    .map((surface) => surface === "desktop" ? "Desktop" : surface === "tui" ? "TUI" : surface);
  const state = String(presence.state || "detached");
  return surfaces.length ? `${state} · ${surfaces.join(" + ")}` : state;
}

function formatInterruptMode(mode) {
  if (mode === "queue") return "queue follow-up";
  return "steer active run";
}

function formatHomePath(value) {
  const text = String(value ?? "");
  const home = os.homedir();
  if (!text || !home) return text || "none";
  if (text.toLowerCase() === home.toLowerCase()) return "~";
  if (text.toLowerCase().startsWith(`${home.toLowerCase()}\\`) || text.toLowerCase().startsWith(`${home.toLowerCase()}/`)) {
    return `~${text.slice(home.length)}`;
  }
  return text;
}

function renderContextLine(status = {}, theme = fallbackTheme) {
  const usage = status.usage ?? {};
  const context = status.contextUsage ?? {};
  const percent = typeof context.percent === "number" && Number.isFinite(context.percent) ? clamp(context.percent, 0, 100) : undefined;
  const used = percent ?? (usage.total ? 0 : 0);
  const left = percent === undefined ? undefined : Math.max(0, 100 - used);
  const label = percent === undefined
    ? "context use unknown"
    : `${formatPercent(used)} used / ${formatPercent(left)} left`;
  return `${theme.accent}${"context ".padEnd(8)}${reset} ${contextBar(used, theme)} ${label}  tokens ${formatNumber(usage.total)}`;
}

function contextBar(percent, theme = fallbackTheme) {
  const width = 26;
  const value = clamp(Number(percent) || 0, 0, 100);
  const filled = Math.round((value / 100) * width);
  const color = value >= 90 ? theme.error : value >= 70 ? theme.warning : theme.success;
  return `[${color}${"#".repeat(filled)}${theme.muted}${"-".repeat(width - filled)}${reset}]`;
}

function boxedStatusLine(text, contentWidth, theme = fallbackTheme) {
  return `${theme.primary}│${reset} ${padDisplay(truncateVisible(text, contentWidth), contentWidth)} ${theme.primary}│${reset}`;
}

function wrapStatusRow(text, width) {
  const raw = stripAnsi(String(text ?? ""));
  if (raw.length <= width) return [text];

  const indent = " ".repeat(9);
  const firstWidth = Math.max(12, width);
  const restWidth = Math.max(12, width - indent.length);
  const words = raw.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const targetWidth = lines.length === 0 ? firstWidth : restWidth;
    const next = current ? `${current} ${word}` : word;
    if (next.length > targetWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= 1) return lines;
  return [lines[0], ...lines.slice(1).map((line) => `${indent}${line}`)];
}

function wrapPlain(text, width) {
  const maxWidth = Math.max(1, width);
  const words = String(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [""];

  const lines = [];
  let current = "";
  for (const word of words) {
    if (stripAnsi(word).length > maxWidth) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxWidth) {
        lines.push(word.slice(index, index + maxWidth));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (stripAnsi(next).length > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function truncateVisible(text, max) {
  const value = String(text ?? "");
  if (stripAnsi(value).length <= max) return value;
  const plain = stripAnsi(value);
  return `${plain.slice(0, Math.max(0, max - 3))}...`;
}

function truncatePlain(value, max) {
  return String(value).length > max ? `${String(value).slice(0, Math.max(0, max - 3))}...` : String(value);
}

function padDisplay(text, width) {
  const value = String(text);
  return `${value}${" ".repeat(Math.max(0, width - stripAnsi(value).length))}`;
}

function renderBox(rows, theme, width, contentWidth) {
  const top = `${theme.primary}╭${"─".repeat(width - 2)}╮${reset}`;
  const bottom = `${theme.primary}╰${"─".repeat(width - 2)}╯${reset}`;
  const divider = `${theme.primary}│${reset}${theme.muted}${"─".repeat(width - 2)}${reset}${theme.primary}│${reset}`;
  return [
    "",
    top,
    ...rows.flatMap((row) => row === "__divider" ? [divider] : row === "" ? [boxedStatusLine("", contentWidth, theme)] : wrapStatusRow(row, contentWidth).map((line) => boxedStatusLine(line, contentWidth, theme))),
    bottom,
    "",
  ];
}

function renderLimitRows(usage = {}, theme = fallbackTheme) {
  const windows = listCodexUsageWindows(usage);
  if (windows.length === 0) {
    return [`${theme.accent}${"limits".padEnd(8)}${reset} ${theme.muted}No rate-limit windows returned by ChatGPT.${reset}`];
  }
  return windows.map((window, index) => {
    const prefix = index === 0 ? "limits" : "";
    return `${theme.accent}${prefix.padEnd(8)}${reset} ${formatAccountLimit(formatCodexUsageWindowLabel(window), window, theme)}`;
  });
}

function formatAccountLimit(label, bucket, theme = fallbackTheme) {
  if (!bucket) return `${label.padEnd(16)} ${theme.muted}unknown${reset}`;
  const used = clamp(Number(bucket.usedPercent) || 0, 0, 100);
  const left = Math.max(0, 100 - used);
  const tone = usageTone(used, theme);
  return [
    `${bold}${label.padEnd(16)}${reset}`,
    usageBar(used, theme),
    `${tone}${bold}${formatPercent(used).padStart(5)}${reset} ${theme.muted}used${reset}`,
    `${theme.success}${bold}${formatPercent(left).padStart(5)}${reset} ${theme.muted}left${reset}`,
    formatAccountReset(bucket.resetAt, theme),
  ].filter(Boolean).join("  ");
}

function usageBar(percent, theme = fallbackTheme) {
  const width = 18;
  const value = clamp(Number(percent) || 0, 0, 100);
  const filled = value > 0 ? Math.max(1, Math.round((value / 100) * width)) : 0;
  return `${usageTone(value, theme)}${"█".repeat(filled)}${theme.muted}${"░".repeat(width - filled)}${reset}`;
}

function usageTone(percent, theme = fallbackTheme) {
  if (percent >= 80) return theme.error;
  if (percent >= 55) return theme.warning;
  return theme.success;
}

function formatAccountReset(iso, theme = fallbackTheme) {
  if (!iso) return "";
  const millis = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(millis) || millis <= 0) return "";
  return `${theme.muted}resets in ${formatAccountDuration(millis)}${reset}`;
}

function formatAccountDuration(millis) {
  const minutes = Math.max(0, Math.round(millis / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${mins ? `${mins}m` : ""}`;
  return `${mins}m`;
}

function formatAccountDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso ?? "unknown") : date.toLocaleString();
}

function shortAccountId(value) {
  const text = String(value ?? "");
  if (!text) return "unknown";
  return text.length <= 14 ? text : `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "?%";
  return number >= 10 ? `${number.toFixed(0)}%` : `${number.toFixed(1)}%`;
}

function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-US");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
