// Display metadata only. Never use this value as an execution directory or grant.
export const WORK_KINDS = Object.freeze(['coding', 'debugging', 'research', 'music', 'audio', 'video', 'design', 'writing', 'data', 'planning', 'general']);

export function normalizeWorkContextInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['folderPath', 'kind'].includes(key))
    || !WORK_KINDS.includes(value.kind)) throw new Error('Choose a supported work category and optional absolute folderPath.');
  let folderPath = value.folderPath ?? null;
  if (folderPath !== null) {
    if (typeof folderPath !== 'string' || !folderPath.trim() || folderPath.length > 4096
      || /[\u0000-\u001f\u007f]/.test(folderPath)
      || !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(folderPath.trim())) throw new Error('Use an absolute folder path, or null when no specific folder applies.');
    folderPath = folderPath.trim().replace(/\\/g, '/');
    folderPath = folderPath.replace(/\/+$/, '') || '/';
    if (/^[a-z]:$/i.test(folderPath)) folderPath += '/';
  }
  return { folderPath, kind: value.kind };
}

export function readChatWorkContext(value) {
  try {
    if (!value || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
    return { ...normalizeWorkContextInput({ folderPath: value.folderPath, kind: value.kind }), updatedAt: value.updatedAt };
  } catch { return null; }
}
