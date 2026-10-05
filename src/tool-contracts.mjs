export const DEFAULT_MANAGED_BASH_AUTO_POLL_MS = 30000;
export const MANAGED_BASH_BACKGROUND_DESCRIPTION = "Optional boolean for action=run. Set true for an intentionally persistent server or watcher: return promptly, survive Stop turn, and disable automatic polling. Ordinary commands are also adopted as background jobs if the initial run yields, but retain completion polling.";
export const MANAGED_BASH_CONTROL_CONTRACT = Object.freeze({
  list: "managed_bash.list",
  stop: "managed_bash.stop",
  stopSelection: "Provide jobId OR all:true; all stops background jobs only. Optional ownerAgentRunId scopes list/stop to one child actor.",
  response: "{jobs:[{jobId,toolCallId,ownerAgentRunId?,command,status,background,startedAt,completedAt?,exitCode?,output?,errorMessage?}]}",
});
export const ZYRA_WEB_SEARCH_TOOL_NAME = "web_search";
export const ZYRA_WEB_FETCH_TOOL_NAME = "web_fetch";
