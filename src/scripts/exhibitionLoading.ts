import animated from "../assets/brand/loading-camera.svg?url";
import still from "../assets/brand/loading-camera-still.svg?url";

export function exhibitionLoadingHtml() {
  return `<div class="exhibition-loading" data-exhibition-loading role="status" aria-label="読み込んでいます">
    <picture class="exhibition-loading-symbol" aria-hidden="true">
      <source media="(prefers-reduced-motion: reduce)" srcset="${still}" />
      <img src="${animated}" alt="" width="146" height="99" />
    </picture>
  </div>`;
}
export function showExhibitionLoading(scope:ParentNode=document){
 let element=scope.querySelector<HTMLElement>('[data-exhibition-loading]'),timer:number|undefined;
 if(!element){const wrapper=document.createElement('div');wrapper.innerHTML=exhibitionLoadingHtml();element=wrapper.firstElementChild as HTMLElement;element.hidden=true;document.body.append(element);const target=element;timer=window.setTimeout(()=>target.hidden=false,150);}
 const target=element;return()=>{clearTimeout(timer);target.remove();};
}
