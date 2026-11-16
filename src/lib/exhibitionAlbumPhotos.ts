import {latestContent,type Exhibition,type ExhibitionAsset,type ExhibitionStore} from './exhibitionTypes.ts';
import {ExhibitionError,id} from './exhibitionValidation.ts';

export type ExhibitionAlbumPhoto={id:string;name:string;title:string;authorName:string;submissionName:string;width:number;height:number;bytes:number;current:true;albumAdded:boolean};

export function currentExhibitionPhotos(data:ExhibitionStore, exhibitionId:string) {
  const assets = new Map(data.assets.filter(asset => asset.exhibitionId === exhibitionId).map(asset => [asset.id, asset]));
  return data.submissions.filter(submission => submission.exhibitionId === exhibitionId && !submission.inactive).flatMap(submission => {
    const content = latestContent(submission);
    if (!content) return [];
    return content.works.flatMap(work => work.photos.flatMap(photo => {
      const asset = assets.get(photo.assetId);
      return asset?.submissionId === submission.id ? [{ submission, content, work, photo, asset }] : [];
    }));
  });
}
export function exhibitionAlbumPhotos(data:ExhibitionStore,exhibitionId:string):ExhibitionAlbumPhoto[] {
  const photos = new Map(currentExhibitionPhotos(data, exhibitionId).map(({ asset, content, work }) => [asset.id, {
    id:asset.id, name:asset.name, title:work.title, authorName:content.authorName, submissionName:content.name,
    width:asset.width, height:asset.height, bytes:asset.bytes, current:true as const, albumAdded:!!asset.albumAdded,
  }]));
  return [...photos.values()];
}
export function parseAlbumExclusions(value:unknown,data:ExhibitionStore,exhibition:Exhibition) {
  if(!Array.isArray(value)||value.length>5000)throw new ExhibitionError('除外する写真は5,000枚以内で選択してください。');
  const known=new Set([...exhibitionAlbumPhotos(data,exhibition.id).map(p=>p.id),...exhibition.albumExcludedAssetIds??[]]);
  const values=[...new Set(value.map(value=>id(value)))];
  if(values.some(value=>!known.has(value)))throw new ExhibitionError('この写真展の提出済み写真から選択してください。');
  return values;
}
export const albumPhotoExcluded=(exhibition:Exhibition,assetId:string)=>exhibition.albumExcludedAssetIds?.includes(assetId)??false;

export function albumPhotoEligible(data:ExhibitionStore, exhibition:Exhibition, asset:ExhibitionAsset) {
  if (asset.exhibitionId !== exhibition.id || albumPhotoExcluded(exhibition, asset.id)) return false;
  const submission = data.submissions.find(s => s.id === asset.submissionId && s.exhibitionId === exhibition.id && !s.inactive);
  return !!(submission && latestContent(submission)?.works.some(work => work.photos.some(photo => photo.assetId === asset.id)));
}
