/**
 * Platform-aware re-export of the offline database layer.
 * Metro resolves `.web.ts` on web; native uses `database.ts` (expo-sqlite).
 */

export * from "./database";
export { default } from "./database";
export * from "./autoSync";
