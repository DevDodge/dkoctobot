import { env } from "../config/env";

const LEVELS: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const threshold = LEVELS[env.logLevel] ?? 2;

function emit(level: string, args: unknown[]): void {
  if ((LEVELS[level] ?? 2) > threshold) return;
  const ts = new Date().toISOString();
  const prefix = `${ts} [followup-service] ${level.toUpperCase()}:`;
  if (level === "error") console.error(prefix, ...args);
  else if (level === "warn") console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}

export const logger = {
  error: (...args: unknown[]) => emit("error", args),
  warn: (...args: unknown[]) => emit("warn", args),
  info: (...args: unknown[]) => emit("info", args),
  debug: (...args: unknown[]) => emit("debug", args),
};
