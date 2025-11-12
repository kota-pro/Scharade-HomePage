import Link from 'next/link';

export default function NotFound() {
  return (
    <section style={{ padding: '64px 5vw', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '16px' }}>404 - Post Not Found</h1>
      <p style={{ marginBottom: '32px' }}>
        探している記事は見つかりませんでした。
      </p>
      <Link href="/">トップへ戻る</Link>
    </section>
  );
}
