import { notFound } from 'next/navigation';
import { PostContent } from './PostContent';
import { getAllPostSlugs, getPostBySlug } from '../../../lib/posts';

type PageProps = {
  params: {
    slug: string;
  };
};

export async function generateStaticParams() {
  const slugs = await getAllPostSlugs();
  return slugs.map((slug) => ({ slug }));
}

export default async function PostPage({ params }: PageProps) {
  const post = await getPostBySlug(params.slug);

  if (!post) {
    notFound();
  }

  return <PostContent post={post} />;
}
