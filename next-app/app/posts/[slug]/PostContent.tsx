'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Post } from '../../../lib/posts';

const backLinkMap = {
  activity: { href: '/Activity', label: '◀︎ Activityへ戻る' },
  gallery: { href: '/Gallery', label: '◀︎ Galleryへ戻る' }
} as const;

type PostContext = keyof typeof backLinkMap;

function isPostContext(value: string | null): value is PostContext {
  return value === 'activity' || value === 'gallery';
}

export function PostContent({ post }: { post: Post }) {
  const searchParams = useSearchParams();
  const from = searchParams.get('from');
  const backLink = isPostContext(from) ? backLinkMap[from] : null;

  return (
    <article className="post">
      {backLink ? (
        <div className="back-link">
          <Link href={backLink.href}>{backLink.label}</Link>
        </div>
      ) : null}

      <header>
        <p className="post-date">{post.publishedAt}</p>
        <h1>{post.title}</h1>
      </header>

      <section
        className="post-body"
        dangerouslySetInnerHTML={{ __html: post.contentHtml }}
      />

      <style jsx>{`
        .post {
          padding: 64px 5vw;
          max-width: 840px;
          margin: 0 auto;
        }
        .back-link {
          margin-bottom: 32px;
        }
        .back-link a {
          font-size: 15px;
          text-decoration: none;
        }
        .post-date {
          margin: 0 0 8px;
          letter-spacing: 1px;
        }
        .post-body :global(p) {
          margin-bottom: 1.6em;
        }
      `}</style>
    </article>
  );
}
