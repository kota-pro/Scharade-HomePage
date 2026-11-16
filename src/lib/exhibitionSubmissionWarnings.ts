import {deadlinePassed} from './advisoryWarnings.ts';
import {effectiveSubmissionLimits,submissionLimitIssues} from './exhibitionSubmissionLimits.ts';
import type {FormSchema,SubmissionContent,LimitIssue} from './exhibitionTypes.ts';
export type SubmissionWarning={code:LimitIssue['code']|'deadline';message:string;tab:'content'|'history';sectionId?:string;workId?:string};
export function exhibitionSubmissionWarnings(exhibition:{schemas:FormSchema[];closesAt?:string},content:SubmissionContent|undefined,submittedAt?:string):SubmissionWarning[]{
 const warnings:SubmissionWarning[]=content?submissionLimitIssues(content,effectiveSubmissionLimits(exhibition.schemas)).map(issue=>({...issue,tab:'content'})):[];
 if(submittedAt&&deadlinePassed(exhibition.closesAt,Date.parse(submittedAt)))warnings.push({code:'deadline',tab:'history',message:'提出期限を過ぎて提出された回答です。'});
 return warnings;
}

/** Staff corrections do not reclassify an on-time member response as late. */
export const submissionWarningAt=(submission:{versions?:{at:string;source?:string}[]})=>submission.versions?.findLast(v=>v.source!=='staff')?.at;
