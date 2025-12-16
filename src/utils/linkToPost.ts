export type PostContext = 'activity' | 'gallery' | 'home';

function normalizeSlug(slug: string): string {
  return slug.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function linkToPost(slug: string, from?: PostContext): string {
  const cleanSlug = normalizeSlug(slug);
  const basePath = `/posts/${cleanSlug}`;
  return from ? `${basePath}?from=${from}` : basePath;
}
