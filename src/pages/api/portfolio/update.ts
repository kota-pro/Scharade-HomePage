import type { APIRoute } from "astro";
import { getUserFromRequest } from "../../../lib/auth";

const SERVICE_DOMAIN =
  (import.meta as any).env?.MICROCMS_SERVICE_DOMAIN ??
  process.env.MICROCMS_SERVICE_DOMAIN;
const API_KEY =
  (import.meta as any).env?.MICROCMS_API_KEY ?? process.env.MICROCMS_API_KEY;
const PORTFOLIO_ENDPOINT =
  (import.meta as any).env?.MICROCMS_PORTFOLIO_ENDPOINT ??
  process.env.MICROCMS_PORTFOLIO_ENDPOINT ??
  "portfolio";
const GRADE_FIELD_ID =
  (import.meta as any).env?.MICROCMS_PORTFOLIO_GRADE_FIELD ?? "grade";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!SERVICE_DOMAIN || !API_KEY) {
    return jsonResponse({ ok: false, message: "Server misconfigured." }, 500);
  }

  const { user } = getUserFromRequest(request);
  if (!user)
    return jsonResponse({ ok: false, message: "Authentication required." }, 401);
  if (!user.approved)
    return jsonResponse(
      { ok: false, message: "Your account is pending approval." },
      403,
    );
  if (!user.portfolioId)
    return jsonResponse(
      { ok: false, message: "No portfolio assigned to this account." },
      400,
    );

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, message: "Invalid payload." }, 400);
  }

  console.log("[portfolio/update] payload", {
    iconUrl: payload.iconUrl,
    pictures: payload.pictures,
    grade: payload.grade,
  });

  const normalizeUrlInput = (value: unknown) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return trimmed;
      }
    } catch {
      return "";
    }
    return "";
  };

  const updateBody: Record<string, unknown> = {};

  if (typeof payload.name === "string") updateBody.name = payload.name.trim();
  if (typeof payload.self_introduction === "string")
    updateBody.self_introduction = payload.self_introduction.trim();
  if (typeof payload.instagram === "string")
    updateBody.instagram = payload.instagram.trim();
  if (typeof payload.x_url === "string") updateBody.x_url = payload.x_url.trim();
  if (typeof payload.camera === "string")
    updateBody.camera = payload.camera.trim();

    if (typeof payload.iconUrl === "string") {
      const trimmedIcon = payload.iconUrl.trim();
      if (trimmedIcon) {
        const iconUrl = normalizeUrlInput(trimmedIcon);
        if (iconUrl) {
          updateBody.icon = iconUrl;
        }
      }
    }

  if (Array.isArray(payload.hashtags)) {
    updateBody.hashtags = payload.hashtags
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, 30);
  }

  let gradeValue: string | null = null;
  if (GRADE_FIELD_ID) {
    if (typeof payload.grade === "string") {
      const v = payload.grade.trim();
      if (v) {
        gradeValue = v;
        updateBody[GRADE_FIELD_ID] = v;
      }
    } else if (Array.isArray(payload.grade)) {
      const arr = payload.grade.map((x) => String(x).trim()).filter(Boolean);
      if (arr.length) {
        updateBody[GRADE_FIELD_ID] = arr;
      }
    }
  }

  if (Array.isArray(payload.pictures)) {
    const urls = payload.pictures
      .map((entry) => normalizeUrlInput(entry))
      .filter(Boolean);
    if (urls.length) {
      updateBody.pictures = urls;
    }
  }

  if (!Object.keys(updateBody).length) {
    return jsonResponse(
      { ok: false, message: "No fields provided to update." },
      400,
    );
  }

  const targetUrl = `https://${SERVICE_DOMAIN}.microcms.io/api/v1/${PORTFOLIO_ENDPOINT}/${encodeURIComponent(
    user.portfolioId,
  )}`;

  console.log("[portfolio/update] SERVICE_DOMAIN", SERVICE_DOMAIN);
  console.log("[portfolio/update] targetUrl", targetUrl);

  const isGradeTypeError = (errorText: string) => {
    try {
      const parsed = JSON.parse(errorText);
      const msg =
        parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as any).message)
          : "";
      return msg.includes("'grade' has unexpected data type") || msg.includes("unexpected data type");
    } catch {
      return false;
    }
  };

  const doPatch = (bodyObj: Record<string, unknown>) =>
    fetch(targetUrl, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "X-API-KEY": API_KEY,
      },
      body: JSON.stringify(bodyObj),
    });

  let response = await doPatch(updateBody);

  if (!response.ok) {
    const errorText = await response
      .text()
      .catch(() => "Unable to reach microCMS.");

    if (response.status === 400 && gradeValue && isGradeTypeError(errorText)) {
      const retryBody: Record<string, unknown> = {
        ...updateBody,
        [GRADE_FIELD_ID]: [gradeValue],
      };

      console.warn("[portfolio/update] retrying with grade as array", {
        gradeValue,
      });

      response = await doPatch(retryBody);
      if (response.ok) {
        return jsonResponse({ ok: true });
      }

      const retryText = await response.text().catch(() => "Unable to reach microCMS.");
      console.error("[portfolio/update] microCMS error (retry)", {
        status: response.status,
        body: retryText,
        sent: retryBody,
      });

      return jsonResponse(
        {
          ok: false,
          message: `microCMS error: ${retryText}`,
          microcms_status: response.status,
          microcms_body: retryText,
        },
        response.status,
      );
    }

    console.error("[portfolio/update] microCMS error", {
      status: response.status,
      body: errorText,
      sent: updateBody,
    });

    return jsonResponse(
      {
        ok: false,
        message: `microCMS error: ${errorText}`,
        microcms_status: response.status,
        microcms_body: errorText,
      },
      response.status,
    );
  }

  return jsonResponse({ ok: true });
};
