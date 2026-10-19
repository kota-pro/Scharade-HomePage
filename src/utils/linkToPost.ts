export type PostContext = 'activity' | 'gallery' | 'home';

export function linkToPost(slug: string, from?: PostContext): string {
  const basePath = `/posts/${encodeURIComponent(slug)}`;
  return from ? `${basePath}?from=${from}` : basePath;
}
