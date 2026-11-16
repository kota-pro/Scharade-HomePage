import { AsyncLocalStorage } from "node:async_hooks";
import type { User } from "./auth.ts";

type Identity = { actorId: string; user: User | null; mode: "account" | "role"; key: string };
const identities = new AsyncLocalStorage<Identity>();
export const requestIdentity = () => identities.getStore();
export function withRequestIdentity<T>(identity: Identity | undefined, task: () => T): T {
  return identity ? identities.run(identity, task) : task();
}
/** Resolve the synthetic preview identity without inserting it into the account store. */
export function previewActor(userId: string | undefined) {
  const identity = identities.getStore();
  return identity?.mode === "role" && identity.user?.id === userId ? identity.user : undefined;
}
