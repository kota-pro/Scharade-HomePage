export type Post = {
  slug: string;
  title: string;
  contentHtml: string;
  publishedAt: string;
  heroImage?: string;
};

const mockPosts: Post[] = [
  {
    slug: 'post-1',
    title: 'Mock Post 1',
    contentHtml:
      '<p>これはモック記事 1 です。Activity や Gallery から遷移したときの戻り導線を検証できます。</p>',
    publishedAt: '2024-03-01'
  },
  {
    slug: 'post-2',
    title: 'Mock Post 2',
    contentHtml:
      '<p>2 件目のモック記事です。?from=gallery を試してみましょう。</p>',
    publishedAt: '2024-03-15'
  }
];

export async function getAllPostSlugs(): Promise<string[]> {
  return mockPosts.map((post) => post.slug);
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const post = mockPosts.find((item) => item.slug === slug);
  return post ?? null;
}
