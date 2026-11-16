import type { APIRoute } from 'astro';
import { staffShiftData, staffShiftAction } from '../../../../../lib/exhibitionShifts.ts';
import { ExhibitionError, exhibitionErrorBody } from '../../../../../lib/exhibitionValidation.ts';
import { json } from '../../../../../lib/http.ts';
const problem = (error: unknown) => json(exhibitionErrorBody(error), error instanceof ExhibitionError ? error.status : 503);
export const GET: APIRoute = async ({ params, locals }) => { try { return json(staffShiftData(params.id ?? '', locals.user?.id ?? '')); } catch (error) { return problem(error); } };
export const POST: APIRoute = async ({ params, request, locals }) => { try { return json(await staffShiftAction(params.id ?? '', locals.user?.id ?? '', await request.json().catch(() => null))); } catch (error) { return problem(error); } };
