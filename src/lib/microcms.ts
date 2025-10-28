import { createClient } from "microcms-js-sdk";

const serviceDomain = import.meta.env.MICROCMS_SERVICE_DOMAIN;
const apiKey = import.meta.env.MICROCMS_API_KEY;

if (!serviceDomain) {
  throw new Error("MICROCMS_SERVICE_DOMAIN が設定されていません。`.env` を確認してください。");
}

if (!apiKey) {
  throw new Error("MICROCMS_API_KEY が設定されていません。`.env` を確認してください。");
}

export const microcmsClient = createClient({
  serviceDomain,
  apiKey,
});

