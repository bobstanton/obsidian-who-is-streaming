export type Outcome =
  | { status: "ok" }
  | { status: "warning"; message: string }
  | { status: "failed"; message: string };

export const OK: Outcome = { status: "ok" };

export function failed(message: string): Outcome {
  return { status: "failed", message };
}

export function warned(message: string | undefined): Outcome {
  return message ? { status: "warning", message } : OK;
}
