import { readData, writeData, withStoreLock } from "./store.ts";
import type { PushDeviceStore } from "./pushTypes.ts";

export function readPushDevices(): PushDeviceStore {
  const data = readData<PushDeviceStore>("push-devices.json", {
    version: 1,
    devices: [],
  });
  if (
    data.version !== 1 ||
    !Array.isArray(data.devices) ||
    data.devices.some(
      (d) =>
        !d ||
        typeof d.id !== "string" ||
        typeof d.userId !== "string" ||
        typeof d.token !== "string" ||
        typeof d.secretHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(d.secretHash) ||
        typeof d.generation !== "string" ||
        typeof d.enabled !== "boolean" ||
        typeof d.remindersEnabled !== "boolean" ||
        !["ios", "android"].includes(d.platform) ||
        !Number.isInteger(d.authVersion),
    )
  ) {
    throw new Error(
      "通知端末データを読めません。バックアップを確認してください。",
    );
  }
  return data;
}
export function writePushDevices(data: PushDeviceStore) {
  writeData("push-devices.json", data);
}

/** The caller holds auth, before taking push-devices. Expiry alone does not unlink a device. */
export async function revokePushSession(sessionId: string) {
  await withStoreLock("push-devices", () => {
    const data = readPushDevices();
    const remaining = data.devices.filter((d) => d.sessionId !== sessionId);
    if (remaining.length !== data.devices.length)
      writePushDevices({ version: 1, devices: remaining });
  });
}
