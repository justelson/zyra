import type { AgentEvent, AgentMessage, ModelRequestProgress } from "./types.js";
/** Per-provider cancellation. The run controller remains owned by Agent. */
export declare class ModelRequestControl {
    private readonly emit;
    private current?;
    private events;
    constructor(emit: (event: AgentEvent) => Promise<void> | void);
    get progress(): ModelRequestProgress | null;
    get recovery(): AgentMessage | undefined;
    get requestId(): string | undefined;
    private publish;
    flush(): Promise<void>;
    begin(root?: AbortSignal): Promise<AbortSignal>;
    /** Called before forwarding every provider event, including hidden reasoning. */
    activity(unsafe: boolean): Promise<void>;
    ping(requestId: string, message: AgentMessage): void;
    /** No request remains advertised once execution leaves the provider stage. */
    end(): Promise<void>;
}
