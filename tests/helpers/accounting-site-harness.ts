import { harness, Sheet } from "./accounting-harness.ts";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { signedEnvelope } from "../../src/lib/signedEnvelope.ts";

export function siteHarness() {
  const h = harness();
  h.props.ACCOUNTING_ADMIN_WEBHOOK_SECRET = "accounting-admin-fixture-secret-32-characters";
  h.props.ACCOUNTING_ROSTER_MODE = "website";
  h.ctx.Utilities.formatDate = () => "2026-11-03";
  for (const name of ["会計操作履歴", "共通名簿記録"]) h.sheets[name] = new Sheet([["記録JSON"]]);
  vm.runInContext(fs.readFileSync("gas/accounting/SiteGateway.gs", "utf8"), h.ctx);
  const actor = { id: "executive", name: "会計確認", role: "executive" };
  const send = (payload: object) => JSON.parse(JSON.stringify(h.ctx.doPost({ postData: { contents: JSON.stringify(signedEnvelope(payload, h.props.ACCOUNTING_ADMIN_WEBHOOK_SECRET)) } })));
  const read = () => send({ action: "bootstrap", actor }).data;
  const act = (value: object, operationId = crypto.randomUUID()) => send({ operationId, expectedRevision: read().revision, actor, ...value });
  return { ...h, actor, send, read, act };
}
