export type WorkKind = 'coding' | 'debugging' | 'research' | 'music' | 'audio' | 'video' | 'design' | 'writing' | 'data' | 'planning' | 'general';
export type WorkContextInput = { folderPath: string | null; kind: WorkKind; /** Required for new tool reports; absent only in legacy metadata. */ shortName?: string };
export type ChatWorkContext = WorkContextInput & { updatedAt: string };
export const WORK_KINDS: readonly WorkKind[];
export function normalizeWorkContextInput(value: unknown): WorkContextInput;
export function readChatWorkContext(value: unknown): ChatWorkContext | null;
