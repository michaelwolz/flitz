import { readFileSync } from "node:fs";

export const version: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function optionalWebUrl(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name] || undefined;
  if (value && !/^https?:$/.test(URL.parse(value)?.protocol ?? "")) throw new Error(`${name} must be an http or https URL`);
  return value;
}

export function lowercaseList(env: NodeJS.ProcessEnv, name: string) {
  return (env[name] ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a whole number above 0`);
  return value;
}

export function wholeNumber(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number of 0 or more`);
  return value;
}
