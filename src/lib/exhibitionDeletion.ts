import {layoutAssetPath} from "./exhibitionLayoutAssets.ts";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataPath } from "./store.ts";
import { audit } from "./audit.ts";
import { exhibitionAssetPath, readExhibitions, requireStaff, findExhibition, updateExhibitionStore } from "./exhibitions.ts";
import { ExhibitionError, id } from "./exhibitionValidation.ts";
import { exhibitionOutputPath } from "./exhibitionDrive.ts";
import { exhibitionGoogleConfigured, postExhibitionGas, type ExhibitionGoogleConnection } from "./exhibitionGoogleGateway.ts";
import { deleteExhibitionAlbum } from "./exhibitionIntegrations.ts";
import { readShiftStore, updateShiftStore } from "./exhibitionShiftStore.ts";
import { removeExhibitionNotices } from "./activities.ts";

export async function deleteExhibition(actorId: string, exhibitionId: string, revision: unknown, confirmation: unknown) {
  requireStaff(actorId); id(exhibitionId);
  const result = await updateExhibitionStore(async data => {
    requireStaff(actorId);
    const queued = data.deletions?.find(d => d.id === exhibitionId);
    if (queued) { if (confirmation !== queued.title) throw new ExhibitionError("写真展名を入力して削除を確認してください。"); return {ok:true,deletion:queued}; }
    const e = findExhibition(data,exhibitionId);
    if (e.revision !== revision) throw new ExhibitionError("写真展が変更されています。再読み込みしてください。",409);
    if (confirmation !== e.title) throw new ExhibitionError("写真展名を入力して削除を確認してください。");
    const submissions=data.submissions.filter(s=>s.exhibitionId===e.id),assets=data.assets.filter(a=>a.exhibitionId===e.id),outputs=(data.outputs??[]).filter(o=>o.exhibitionId===e.id),layoutAssets=(data.layoutAssets??[]).filter(a=>a.exhibitionId===e.id);
    const shifts = readShiftStore().records.find(r => r.exhibitionId === e.id);
    const backupDir=path.join(path.dirname(dataPath("exhibitions.json")),"exhibition-backups",`${e.id}-${Date.now()}`);
    fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
    const files = [...assets.flatMap(a=>[exhibitionAssetPath(a.id),exhibitionAssetPath(a.id,true)]),...outputs.map(o=>exhibitionOutputPath(o.id)),...layoutAssets.flatMap(a=>[layoutAssetPath(a.id),layoutAssetPath(a.id,true)])];
    const hashes: Record<string,string>={};
    for (const source of files) {
      const target=path.join(backupDir,path.basename(source));fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);fs.chmodSync(target,0o600);
      const digest=(file: string)=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      const expected=digest(source);if(digest(target)!==expected)throw new Error("backup-checksum");hashes[path.basename(source)]=expected;
    }
    fs.writeFileSync(path.join(backupDir,"exhibition.json"),JSON.stringify({exhibition:e,submissions,assets,layoutAssets,outputs,shifts,hashes},null,2),{mode:0o600,flag:"wx"});
    const now=Date.now();
    const deletion={id:e.id,title:e.title,actorId,createdAt:new Date(now).toISOString(),backupDir,status:"pending" as const,nextAttemptAt:0,attempts:0,
      notBefore:Math.max(now+30000,shifts?.sync.leaseUntil??0,e.googleSync?.leaseUntil??0,e.albumSync?.leaseUntil??0,...submissions.flatMap(s=>s.versions.map(v=>v.leaseUntil??0)),...assets.map(a=>a.drive?.leaseUntil??0),...outputs.map(o=>o.drive.leaseUntil??0),...layoutAssets.map(a=>a.drive?.leaseUntil??0)),
      googleForms:structuredClone(e.googleForms),folderId:e.driveFolders?.folderId,fileIds:[shifts?.sync.spreadsheetId,...assets.map(a=>a.drive?.fileId),...outputs.map(o=>o.drive.fileId),...layoutAssets.map(a=>a.drive?.fileId)].filter((v):v is string=>!!v),uploadKeys:[...assets.map(a=>a.id),...outputs.map(o=>o.id),...layoutAssets.map(a=>a.id)],albumId:e.albumId,albumCreated:!!e.albumCreated || !!e.albumSync,assetIds:assets.map(a=>a.id),outputIds:outputs.map(o=>o.id),layoutAssetIds:layoutAssets.map(a=>a.id)};
    (data.deletions??=[]).push(deletion);
    data.exhibitions=data.exhibitions.filter(e=>e.id!==exhibitionId);data.submissions=data.submissions.filter(s=>s.exhibitionId!==exhibitionId);data.assets=data.assets.filter(a=>a.exhibitionId!==exhibitionId);data.layoutAssets=(data.layoutAssets??[]).filter(a=>a.exhibitionId!==exhibitionId);data.outputs=(data.outputs??[]).filter(o=>o.exhibitionId!==exhibitionId);
    await updateShiftStore(store => { store.records = store.records.filter(r => r.exhibitionId !== exhibitionId); });
    return {ok:true,deletion};
  });
  await audit(actorId,"exhibition.delete",exhibitionId);
  return {ok:true,deleted:true,cleanup:result.deletion.status};
}

export async function drainExhibitionDeletions(limit=20,stopped=()=>false) {
  let completed=0;
  for(const pending of (readExhibitions().deletions??[]).filter(d=>d.status==="pending" && Math.max(d.notBefore,d.nextAttemptAt,d.leaseUntil??0)<=Date.now()).slice(0,limit)) {
    if(stopped())break;
    const token=crypto.randomUUID();
    const job=await updateExhibitionStore(data=>{
      const d=data.deletions?.find(d=>d.id===pending.id);
      if(!d || d.status!=="pending" || (d.leaseUntil??0)>Date.now())return null;
      d.leaseToken=token;d.leaseUntil=Date.now()+300000;d.attempts++;return structuredClone(d);
    });
    if(!job)continue;
    const done=async(key: "googleDone"|"lightroomDone"|"localDone"|"noticeDone")=>updateExhibitionStore(data=>{const d=data.deletions?.find(d=>d.id===job.id);if(d?.leaseToken===token)d[key]=true;});
    try {
      if(!job.localDone){for(const file of [...job.assetIds.flatMap(id=>[exhibitionAssetPath(id),exhibitionAssetPath(id,true)]),...job.outputIds.map(id=>exhibitionOutputPath(id)),...(job.layoutAssetIds??[]).flatMap(id=>[layoutAssetPath(id),layoutAssetPath(id,true)])])fs.rmSync(file,{force:true});await done("localDone");}
      if(!job.noticeDone){await removeExhibitionNotices(job.id);await done("noticeDone");}
      if(!job.googleDone) {
        const connections=new Set<ExhibitionGoogleConnection>(job.googleForms.map(f=>f.connectionId??"legacy"));
        if(exhibitionGoogleConfigured("exhibition-drive") || job.folderId || job.fileIds.length) connections.add("exhibition-drive");
        for(const connection of connections) {
          if(!exhibitionGoogleConfigured(connection))throw new Error("Google接続が未設定です。");
          const forms=job.googleForms.filter(f=>(f.connectionId??"legacy")===connection);
          await postExhibitionGas({action:"exhibition.delete",exhibitionId:job.id,formIds:[...new Set(forms.map(f=>f.formId))],spreadsheetIds:[...new Set(forms.map(f=>f.spreadsheetId))],fileIds:connection==="exhibition-drive"?job.fileIds:[],...(connection==="exhibition-drive"&&job.folderId?{folderId:job.folderId}:{})},60000,connection);
        }
        await done("googleDone");
      }
      if(!job.lightroomDone){await deleteExhibitionAlbum(job.albumId,job.id,job.albumCreated);await done("lightroomDone");}
      await updateExhibitionStore(data=>{const d=data.deletions?.find(d=>d.id===job.id);if(d?.leaseToken===token){d.status="complete";delete d.error;}});completed++;
    }catch(error){await updateExhibitionStore(data=>{const d=data.deletions?.find(d=>d.id===job.id);if(d?.leaseToken===token){d.error=error instanceof Error?error.message.slice(0,150):"削除を再試行しています。";d.nextAttemptAt=Date.now()+Math.min(900000,30000*2**Math.min(d.attempts-1,5));}});}
    finally{await updateExhibitionStore(data=>{const d=data.deletions?.find(d=>d.id===job.id);if(d?.leaseToken===token){delete d.leaseToken;delete d.leaseUntil;}});}
  }
  return {completed};
}
