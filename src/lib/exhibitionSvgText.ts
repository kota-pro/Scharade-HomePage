import {glyphOutlines,measureVectorText} from './exhibitionVectorText.ts';
const decode=(s:string)=>s.replace(/&(amp|lt|gt|quot|apos|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'"}[key as string]!));
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const attrs=(s:string)=>Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
/** Generated SVG text uses explicit x/y and line tspans; keep every glyph independent of installed fonts. */
export function outlineSvgText(svg:string){return svg.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/g,(_tag,attributes,inner)=>{
  const a=attrs(attributes),size=Number(a['font-size']??a.style?.match(/font-size:([\d.]+)px/)?.[1]??12),bold=a['font-weight']==='700',color=a.fill&&a.fill!=='currentColor'?a.fill:'#251f1c',lines=[...inner.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)];let x=Number(a.x??0),y=Number(a.y??0),paths='';
  const render=(text:string,b:Record<string,string>)=>{if(b.x!==undefined)x=Number(b.x);if(b.y!==undefined)y=Number(b.y);x+=Number(b.dx??0);y+=Number(b.dy??0);const value=decode(text.replace(/<[^>]+>/g,'')),width=measureVectorText(value,size,bold),anchor=b['text-anchor']??a['text-anchor'],offset=anchor==='middle'?-width/2:anchor==='end'?-width:0;paths+=`<g transform="translate(${x+offset} ${y})">${glyphOutlines(value,size,bold)}</g>`;x+=width;};
  if(lines.length)for(const line of lines)render(line[2],attrs(line[1]));else render(inner,{});
  return `<g data-output-outline="" aria-label="${esc(decode(inner.replace(/<[^>]+>/g,'')))}" fill="${esc(color)}" stroke="none"${a.transform?` transform="${esc(a.transform)}"`:''}>${paths}</g>`;
});}
