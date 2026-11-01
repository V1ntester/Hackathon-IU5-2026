/** Server-to-client event envelope; event-specific payloads can be added later. */
export interface ServerEvent {
  type: "event";
  name: string;
  payload: Record<string, unknown>;
}

export function isServerEvent(value: unknown): value is ServerEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<ServerEvent>;
  return event.type === "event" && typeof event.name === "string" &&
    event.name.length > 0 && event.name.length <= 100 &&
    event.payload !== null && typeof event.payload === "object" &&
    !Array.isArray(event.payload);
}
