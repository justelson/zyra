import { Type } from "typebox";
import { CONTROL_CAPABILITIES } from "./contracts.mjs";

const capability = Type.Union(CONTROL_CAPABILITIES.map((entry) => Type.Literal(entry)));
const sideEffectClass = Type.Union([
  "none", "send-or-publish", "purchase", "account-change", "security-change", "destructive-delete",
  "file-upload", "sensitive-data-submit", "software-install", "legal-acceptance",
].map((entry) => Type.Literal(entry)));
const common = {
  operation: Type.String({ description: "Bounded control operation." }),
  targetId: Type.Optional(Type.String()),
  windowToken: Type.Optional(Type.String({ description: "Opaque Windows candidate from open_app or list_windows. Use it with request_grant to select and request access in one step." })),
  application: Type.Optional(Type.String({ description: "Registered Windows app name. Paths, arguments, files, and URLs are not accepted." })),
  primaryTargetId: Type.Optional(Type.String()),
  secondaryTargetId: Type.Optional(Type.String()),
  grantId: Type.Optional(Type.String()),
  observationRevision: Type.Optional(Type.Number()),
  elementRef: Type.Optional(Type.String()),
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  fromX: Type.Optional(Type.Number()),
  fromY: Type.Optional(Type.Number()),
  toX: Type.Optional(Type.Number()),
  toY: Type.Optional(Type.Number()),
  durationMs: Type.Optional(Type.Number()),
  width: Type.Optional(Type.Number({ description: "Requested Inspector width in CSS pixels." })),
  button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("middle"), Type.Literal("right")])),
  clickCount: Type.Optional(Type.Number()),
  includeScreenshot: Type.Optional(Type.Boolean()),
  reveal: Type.Optional(Type.Boolean({ description: "Reveal the in-app Browser workspace. Root agent only." })),
  sessionMode: Type.Optional(Type.Union([
    Type.Literal("normal"),
    Type.Literal("incognito"),
  ], { description: "Storage mode for a new in-app Browser tab. Defaults to incognito for agent-opened tabs." })),
  capabilities: Type.Optional(Type.Array(capability, { maxItems: CONTROL_CAPABILITIES.length })),
  maxActions: Type.Optional(Type.Number()),
  allowedOrigins: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
  allowedExecutableIdentities: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
  url: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  replace: Type.Optional(Type.Boolean()),
  key: Type.Optional(Type.String()),
  modifiers: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
  deltaX: Type.Optional(Type.Number()),
  deltaY: Type.Optional(Type.Number()),
  values: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })),
  condition: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  timeoutMs: Type.Optional(Type.Number()),
  sideEffect: Type.Optional(sideEffectClass),
};

export const browserControlSchema = Type.Object(common, { additionalProperties: false });
export const computerControlSchema = Type.Object(common, { additionalProperties: false });

export const BROWSER_CONTROL_OPERATIONS = Object.freeze([
  "list_targets", "open_tab", "reveal_tab", "close_tab", "refresh_tab", "open_external", "set_tab_layout", "resize_inspector", "request_grant", "observe", "navigate", "move", "click", "drag", "type", "key", "scroll", "select", "wait", "release",
]);
export const COMPUTER_CONTROL_OPERATIONS = Object.freeze([
  "open_app", "list_windows", "request_grant", "observe", "focus", "click", "type", "key", "scroll", "wait", "release",
]);
