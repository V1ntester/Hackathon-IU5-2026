/** Server-owned world object from a session snapshot. */
export interface WorldObjectState {
  id: string;
  state: "inactive" | "active";
}

export function isWorldObjectState(value: unknown): value is WorldObjectState {
  if (!value || typeof value !== "object") return false;
  const object = value as Partial<WorldObjectState>;
  return typeof object.id === "string" && object.id.length > 0 &&
    (object.state === "inactive" || object.state === "active");
}
