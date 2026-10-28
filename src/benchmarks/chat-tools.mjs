import { isDeepStrictEqual } from 'node:util';
import { Compile } from 'typebox/compile';
import { createAssistantActionBatchTool, ASSISTANT_ACTION_BATCH_INTENT_MAX_LENGTH } from '../assistant-action-batch-tool.mjs';
import { createFleetTools } from '../agents/tools.mjs';

const knownNames = new Set(['read', 'bash', 'edit', 'write', 'begin_action_batch', 'agent', 'workflow', 'thread', 'app', 'settings', 'settings_action', 'usage', 'context', 'plugin_mcp', 'web_search', 'web_fetch', 'browser_use', 'tool_search', 'zyra_tool_search', 'browser_tabs', 'browser_access', 'browser_observe', 'browser_act', 'browser_perform', 'browser_session', 'computer_use_app', 'computer_open_app', 'computer_list_windows', 'computer_request_access', 'computer_observe', 'computer_move', 'computer_click', 'computer_drag', 'computer_stroke', 'computer_sequence', 'computer_type', 'computer_key', 'computer_scroll', 'computer_focus', 'computer_wait', 'computer_release', 'request_user_input']);

/** Offline replay only. Never dispatch historical commands or contact a model. */
export function createChatToolBenchmark(baseline) {
  const marker = createAssistantActionBatchTool();
  const before = Compile(baseline.actionBatchSchema);
  const after = Compile(marker.parameters);
  const seenCalls = new Set();
  const seenResults = new Set();
  const tools = new Map();
  const report = {
    version: 1, mode: 'offline historical argument and response replay',
    calls: 0, results: 0, duplicateCalls: 0, duplicateResults: 0,
    marker: { calls: 0, beforeAccepted: 0, afterAccepted: 0, recovered: 0, regressions: 0, normalizationFailures: 0 },
    fleet: { results: 0, compared: 0, excludedErrors: 0, excludedNonJson: 0, beforeChars: 0, afterChars: 0, changedValues: 0 },
    limitations: ['Historical tool errors are observations, not task-success labels.', 'No live model inference or external tool execution.', 'Character counts are not provider token counts; image data is counted separately.', 'Inherited tool-call IDs and result IDs are counted once across files.'],
  };
  const stat = name => {
    const safeName = knownNames.has(name) ? name : 'other';
    if (!tools.has(safeName)) tools.set(safeName, { name: safeName, calls: 0, results: 0, errors: 0, textChars: 0, imageDataChars: 0 });
    return tools.get(safeName);
  };
  return {
    async accept(entry, source) {
      const message = entry?.type === 'message' ? entry.message : null;
      if (!message) return;
      if (message.role === 'assistant') {
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (block?.type !== 'toolCall') continue;
          const identity = block.id || `${source}:${entry.id}`;
          if (seenCalls.has(identity)) { report.duplicateCalls++; continue; }
          seenCalls.add(identity);
          report.calls++; stat(block.name).calls++;
          if (block.name !== 'begin_action_batch') continue;
          const input = block.arguments;
          const acceptedBefore = before.Check(input), acceptedAfter = after.Check(input);
          report.marker.calls++;
          report.marker.beforeAccepted += Number(acceptedBefore);
          report.marker.afterAccepted += Number(acceptedAfter);
          report.marker.recovered += Number(!acceptedBefore && acceptedAfter);
          report.marker.regressions += Number(acceptedBefore && !acceptedAfter);
          if (acceptedAfter) {
            try {
              const result = await marker.execute('offline-replay', input);
              const title = result.details?.actionBatchIntent;
              if (!title || title.length > ASSISTANT_ACTION_BATCH_INTENT_MAX_LENGTH) report.marker.normalizationFailures++;
            } catch { report.marker.normalizationFailures++; }
          }
        }
      } else if (message.role === 'toolResult') {
        const identity = message.toolCallId || `${source}:${entry.id}`;
        if (seenResults.has(identity)) { report.duplicateResults++; return; }
        seenResults.add(identity);
        report.results++;
        const tool = stat(message.toolName);
        tool.results++; tool.errors += Number(message.isError === true);
        const content = Array.isArray(message.content) ? message.content : [];
        const text = content.filter(block => block.type === 'text').map(block => block.text || '').join('\n');
        tool.textChars += text.length;
        tool.imageDataChars += content.filter(block => block.type === 'image').reduce((n, block) => n + (block.data?.length || 0), 0);
        if (!['agent', 'workflow'].includes(message.toolName)) return;
        report.fleet.results++;
        if (message.isError) { report.fleet.excludedErrors++; return; }
        let value;
        try { value = JSON.parse(text); } catch { report.fleet.excludedNonJson++; return; }
        // Feed values through the real local serializer, with an inert status
        // controller. Historical spawn/send/commands are never executed.
        const [agent, workflow] = createFleetTools({ controller: { status: () => value }, workflowRuntime: { listRuns: () => value } });
        const result = await (message.toolName === 'agent' ? agent : workflow).execute('offline-replay', { action: 'status' });
        const encoded = result.content[0].text;
        report.fleet.compared++;
        report.fleet.beforeChars += text.length;
        report.fleet.afterChars += encoded.length;
        try { if (!isDeepStrictEqual(JSON.parse(encoded), value)) report.fleet.changedValues++; }
        catch { report.fleet.changedValues++; }
      }
    },
    finish() {
      return { ...report, fleet: { ...report.fleet, reductionPercent: report.fleet.beforeChars ? 100 * (1 - report.fleet.afterChars / report.fleet.beforeChars) : null }, tools: [...tools.values()].sort((a, b) => b.calls - a.calls) };
    },
  };
}
