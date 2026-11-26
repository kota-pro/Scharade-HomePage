import { isStaff, readUsers, type User } from "./auth.ts";
import { requestIdentity } from "./requestIdentity.ts";
import { readData, writeData } from "./store.ts";

type State = "draft" | "pending" | "returned" | "approved";
type Identity = { userId: string; actorId: string };

export type BlogReview = {
  revision: number;
  state: State;
  author?: Identity;
  bylineUserId?: string | null;
  submittedBy?: Identity;
  approvedVersion?: { updatedAt: string; digest: string };
  returnReason?: string;
};

const file = "blog-review.json";
export const blogReviewLabels: Record<State, string> = {
  draft: "下書き", pending: "承認待ち", returned: "差し戻し", approved: "承認済み",
};

export function readBlogReviews() {
  return readData<Record<string, BlogReview>>(file, {});
}

export function blogReview(id: string, updatedAt: string, reviews = readBlogReviews()): BlogReview {
  const result = Object.hasOwn(reviews, id) ? reviews[id] : { revision: 0, state: "draft" as const };
  if (result.state === "approved" && result.approvedVersion?.updatedAt !== updatedAt) {
    return { ...result, state: "pending", approvedVersion: undefined };
  }
  return result;
}

// Call while holding the blog-management lock.
export function saveBlogReview(id: string, current: BlogReview, change: Partial<BlogReview>) {
  writeData(file, {
    ...readBlogReviews(), [id]: { ...current, ...change, revision: current.revision + 1 },
  });
}

export function removeBlogReview(id: string) {
  const reviews = readBlogReviews();
  if (!Object.hasOwn(reviews, id)) return;
  delete reviews[id];
  writeData(file, reviews);
}

export function blogIdentity(user: User): Identity {
  return { userId: user.id, actorId: requestIdentity()?.actorId ?? user.id };
}

export function canSubmitBlog(review: BlogReview, user: User) {
  if (review.state !== "draft" && review.state !== "returned") return false;
  return user.approved && (review.author?.userId === user.id ||
    (isStaff(user) && (!review.author || !readUsers().some(account => account.id === review.author?.userId && account.approved))));
}

export function canReviewBlog(review: BlogReview, user: User) {
  if (!isStaff(user) || review.state !== "pending") return false;
  const { userId, actorId } = blogIdentity(user);
  return review.bylineUserId !== userId && review.bylineUserId !== actorId &&
    ![review.author, review.submittedBy].some(identity =>
    identity && [identity.userId, identity.actorId].some(id => id === userId || id === actorId));
}
