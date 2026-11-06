export function readUserTurnRootMessageId(message: unknown): string | null;
export function createUserTurnContinuity(): { observe(event: unknown): void; expectSteeringMessage(): () => void };
