import type { APIRoute } from 'astro';
import { getUserFromRequest, isStaff } from '../../../../../../lib/auth.ts';
import { json } from '../../../../../../lib/http.ts';
import { layoutPresence,readLayoutSnapshot,collaborationEpoch } from '../../../../../../lib/exhibitionCollaboration.ts';
export const GET:APIRoute=({locals,params,request,url})=>{
 if(!isStaff(locals.user))return json({ok:false,message:'運営以上の権限が必要です。'},locals.user?403:401);
 const clientId=url.searchParams.get('clientId'),exhibitionId=params.id??'';
 if(!layoutPresence(exhibitionId).peers.some(p=>p.clientId===clientId&&p.actorId===locals.user!.id))return json({ok:false,message:'共同編集へ接続してください。'},409);
 let interval:ReturnType<typeof setInterval>|undefined,closed=false;const encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({start(controller){let lastValue:ReturnType<typeof readLayoutSnapshot>|undefined,lastState='',lastPresence='',lastCheck=0,lastBeat=0;const send=(type:string,value:unknown)=>{if(!closed)controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`));};
  const finish=()=>{if(closed)return;closed=true;clearInterval(interval);try{controller.close();}catch{}};
  const tick=()=>{try{const now=Date.now();if(now-lastCheck>=5000){const u=getUserFromRequest(request).user;if(!isStaff(u)||u?.id!==locals.user!.id){send('ended',{message:'ログインまたは権限の有効期限が切れました。未送信の内容を控えて再ログインしてください。'});finish();return;}lastCheck=now;}
   const state=readLayoutSnapshot(locals.user!.id,exhibitionId);if(state!==lastValue){lastValue=state;const stateKey=JSON.stringify(state);if(stateKey!==lastState){send('layout',state);lastState=stateKey;}}
   const presence=layoutPresence(exhibitionId);if(!presence.peers.some(p=>p.clientId===clientId&&p.actorId===locals.user!.id)){send('ended',{message:'共同編集へ再接続しています。未送信の変更は保持しています。'});finish();return;}const presenceKey=JSON.stringify(presence);if(presenceKey!==lastPresence){send('presence',presence);lastPresence=presenceKey;}
   if(now-lastBeat>=10000){send('heartbeat',{epoch:collaborationEpoch});lastBeat=now;}
  }catch{send('ended',{message:'写真展が削除されたか、共同編集の接続を確認できません。未送信の内容を控えてください。'});finish();}};
  controller.enqueue(encoder.encode('retry: 1500\n\n'));tick();if(!closed)interval=setInterval(tick,250);request.signal.addEventListener('abort',finish,{once:true});},cancel(){closed=true;clearInterval(interval);}});
 return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store','X-Accel-Buffering':'no','X-Robots-Tag':'noindex, nofollow'}});
};
