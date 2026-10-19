import {getAllContents,microcmsClient} from './microcms.ts';
import type {Blog} from '../types/microcms.ts';

export async function getBlogBySlug(slug: string): Promise<Blog | undefined> {
  // microCMS filters cannot escape literal syntax such as [or]. Match the
  // stored slug exactly instead of interpolating a visitor's URL into filters.
  const entries=await getAllContents<Pick<Blog,'id'|'slug'>>('blog', {
    fields:['id','slug'],
  });
  const entry=entries.find(post=>post.slug===slug);
  if(!entry)return undefined;
  const {contents}=await microcmsClient.getList<Blog>({
    endpoint:'blog',
    queries:{ids:entry.id,limit:1,depth:2},
  });
  return contents.find(post=>post.id===entry.id&&post.slug===slug);
}
