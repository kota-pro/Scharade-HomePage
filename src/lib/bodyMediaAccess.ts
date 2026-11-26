import { readActivities } from "./activities.ts";
import { isStaff, type User } from "./auth.ts";
import { bodyAssetReferences, stagedForUser, type BodyAsset } from "./bodyMedia.ts";
import { participationState } from "./exhibitionParticipation.ts";
import { currentSchema } from "./exhibitionTypes.ts";
import { readExhibitions } from "./exhibitions.ts";
import { findTool, publicationOpen, viewQuestion } from "./memberTools.ts";

export function canReadBodyAsset(asset: BodyAsset, user?: User | null) {
  const staff = isStaff(user);
  if (staff && stagedForUser(asset, user?.id)) return true;
  const references = (html?: string) => bodyAssetReferences(html).has(asset.id);
  const { kind, id } = asset.scope;
  switch (kind) {
    case "event": {
      const event = readActivities().events.find(item => item.id === id);
      return !!event && (staff || event.status !== "draft") &&
        (references(event.descriptionHtml) || references(event.itineraryHtml));
    }
    case "notification":
    case "exhibition-notice":
      return !!user?.approved && readActivities().notifications.some(notice =>
        (kind === "notification" ? notice.id === id : notice.exhibitionId === id) &&
        (staff || notice.recipientIds.includes(user.id)) && references(notice.bodyHtml));
    case "exhibition-section": {
      if (!user?.approved) return false;
      const data = readExhibitions();
      const exhibition = data.exhibitions.find(item => item.id === id);
      if (!exhibition) return false;
      const version = currentSchema(exhibition).version;
      const ownerVersion = participationState(exhibition, user).eligible
        ? data.submissions.find(submission =>
            submission.exhibitionId === id && submission.userId === user.id && !submission.inactive)?.schemaVersion
        : undefined;
      return (staff || !!exhibition.participation?.recipientIds.includes(user.id)) &&
        exhibition.schemas.some(schema => (staff || schema.version === (ownerVersion ?? version)) &&
          schema.sections.some(section => references(section.descriptionHtml)));
    }
    case "tool": {
      const tool = findTool(id);
      return !!tool && (viewQuestion(tool, user) || publicationOpen(tool, user)) && references(tool.questionHtml);
    }
  }
}
