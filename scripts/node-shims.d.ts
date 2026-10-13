// The few Node APIs the scripts use; the project has no @types/node.
declare const process: { argv: string[] };
declare module 'node:fs/promises' {
  export function readdir(path: string): Promise<string[]>;
  export function access(path: string): Promise<void>;
}
declare module 'node:os' {
  export function homedir(): string;
}
