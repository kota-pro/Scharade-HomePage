import { placedPhotos, layoutBounds } from './exhibitionGeometry.ts';
import type { TitleBoardPlacement, Work } from './exhibitionTypes.ts';
export const titleBoardSize = { width:105, height:74.25 };
/** The stored bottom is measured to the rotated bounding box, just like a work. */
export function titleBoardPhoto(card:TitleBoardPlacement,height:number) {
  const work={photos:[{assetId:'',x:0,y:0,...titleBoardSize,rotation:0}]} as Work;
  return placedPhotos(work,card,height)[0];
}
export function titleBoardBounds(card:TitleBoardPlacement,height:number) {return layoutBounds([titleBoardPhoto(card,height)]);}
