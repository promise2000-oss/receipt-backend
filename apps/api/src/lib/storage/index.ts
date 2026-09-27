import { env } from "../env";
import type { Storage } from "./types";
import { LocalDiskStorage } from "./local";
import { S3Storage } from "./s3";

export * from "./types";

let instance: Storage | null = null;

export function getStorage(): Storage {
  if (instance) return instance;
  instance = env.storageDriver === "s3" ? new S3Storage() : new LocalDiskStorage(env.storageDir);
  return instance;
}

/** Test hook — lets the suite point at a scratch directory. */
export function setStorage(storage: Storage | null): void {
  instance = storage;
}
