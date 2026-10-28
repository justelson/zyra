import { uuidv7 } from "../../providers/source/index.js";
import type { AgentEvent, AgentMessage, ModelRequestProgress } from "./types.ts";

/** Per-provider cancellation. The run controller remains owned by Agent. */
export class ModelRequestControl {
	private current?: {
		progress: ModelRequestProgress;
		controller: AbortController;
		root?: AbortSignal;
		onAbort: () => void;
		recovery?: AgentMessage;
		lastEmittedAt: number;
	};
	private events: Promise<void> = Promise.resolve();

	constructor(private readonly emit: (event: AgentEvent) => Promise<void> | void) {}

	get progress(): ModelRequestProgress | null {
		return this.current ? { ...this.current.progress } : null;
	}

	get recovery(): AgentMessage | undefined {
		return this.current?.recovery;
	}

	get requestId(): string | undefined {
		return this.current?.progress.requestId;
	}

	private publish(event: AgentEvent): void {
		this.events = this.events.then(() => this.emit(event));
		// Event listener failures are rethrown by flush(), never unhandled in ping().
		void this.events.catch(() => {});
	}

	async flush(): Promise<void> {
		await this.events;
	}

	async begin(root?: AbortSignal): Promise<AbortSignal> {
		if (this.current) throw new Error("A model request is already active");
		const controller = new AbortController();
		const now = Date.now();
		const progress: ModelRequestProgress = {
			requestId: uuidv7(), startedAt: now, lastActivityAt: now,
			phase: "waiting", canPing: !root?.aborted,
		};
		const onAbort = () => {
			progress.canPing = false;
			controller.abort();
			this.publish({ type: "model_request_progress", progress: { ...progress } });
		};
		this.current = { progress, controller, root, onAbort, lastEmittedAt: now };
		root?.addEventListener("abort", onAbort, { once: true });
		if (root?.aborted) controller.abort();
		this.publish({ type: "model_request_progress", progress: { ...progress } });
		await this.flush();
		return controller.signal;
	}

	/** Called before forwarding every provider event, including hidden reasoning. */
	async activity(unsafe: boolean): Promise<void> {
		const current = this.current;
		if (!current || current.recovery || current.root?.aborted) return;
		const previousPhase = current.progress.phase;
		const previousCanPing = current.progress.canPing;
		current.progress.lastActivityAt = Date.now();
		current.progress.phase = "streaming";
		if (unsafe) current.progress.canPing = false;
		if (previousPhase !== current.progress.phase || previousCanPing !== current.progress.canPing ||
			current.progress.lastActivityAt - current.lastEmittedAt >= 1000) {
			current.lastEmittedAt = current.progress.lastActivityAt;
			this.publish({ type: "model_request_progress", progress: { ...current.progress } });
		}
		await this.flush();
	}

	ping(requestId: string, message: AgentMessage): void {
		const current = this.current;
		if (!current || current.progress.requestId !== requestId) throw new Error("Stale model request");
		if (current.root?.aborted || !current.progress.canPing || current.recovery) {
			throw new Error("Model request cannot be pinged safely");
		}
		current.recovery = message;
		current.progress.phase = "recovering";
		current.progress.canPing = false;
		this.publish({ type: "model_ping", requestId, status: "accepted" });
		this.publish({ type: "model_request_progress", progress: { ...current.progress } });
		current.controller.abort();
	}

	/** No request remains advertised once execution leaves the provider stage. */
	async end(): Promise<void> {
		const current = this.current;
		if (!current) return;
		current.root?.removeEventListener("abort", current.onAbort);
		this.current = undefined;
		this.publish({ type: "model_request_progress", progress: null });
		await this.flush();
	}
}
