export const bodyMediaKinds = ["event", "notification", "exhibition-notice", "exhibition-section", "tool"] as const;
export type BodyMediaScope = { kind: typeof bodyMediaKinds[number]; id: string };

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const prefix = "/api/member/body-media/";

export function bodyMediaPath(value: string) {
  return value.startsWith(prefix) && uuid.test(value.slice(prefix.length)) ? value : "";
}

export function bodyMediaId(value: string) {
  return bodyMediaPath(value).slice(prefix.length);
}
