const allowOnce = 'Allow once';
const deny = 'Deny';
const allowChat = 'Allow for this chat';

export function createPermissionQuestion(request) {
  const details = [...new Set([request.command, ...(request.paths || []), request.detail].filter(Boolean))].join('\n');
  const options = [{ label: deny, description: 'Leave this action unexecuted.' },
    { label: allowOnce, description: details || 'Run this action once.' }];
  if (request.grantLabel && request.grantLabel !== 'This exact app operation only') {
    options.push({ label: allowChat, description: request.grantLabel });
  }
  return { id: 'decision', type: 'confirm', header: 'Permission', question: request.title || `Allow ${request.toolName || 'this action'}?`,
    options, required: true, allowOther: false };
}

export function readPermissionDecision(question, answers, cancelled) {
  if (cancelled) return 'decline';
  const value = answers?.[question.id];
  const label = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (!question.options.some(option => option.label === label)) throw new Error('Select one of the permission choices.');
  return label === allowOnce ? 'acceptOnce' : label === allowChat ? 'acceptForSession' : 'decline';
}
