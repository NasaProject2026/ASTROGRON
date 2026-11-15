import { NextResponse } from 'next/server';
import {
  CoreProblem, CORE_COOKIE, SESSION_SECONDS, coreFetch, coreJson, grantAnalyses,
  grantConversation, login, logout, ownAnalysis, ownConversation, readBody,
  requireSameOrigin, secureBrowserCookie, sessionId,
} from '@/server/core-backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }); }

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const parts = (await context.params).path;
    const route = parts.join('/');
    const method = request.method;
    if (method !== 'GET') requireSameOrigin(request);
    if (route === 'session') {
      if (method === 'POST') {
        const body = await readBody(request);
        const id = login(body.code);
        const response = json({ authenticated: true });
        response.cookies.set(CORE_COOKIE, id, { httpOnly: true, sameSite: 'strict', secure: secureBrowserCookie(request), path: '/', maxAge: SESSION_SECONDS });
        return response;
      }
      if (method === 'DELETE') {
        logout(sessionId(request)); const response = json({ authenticated: false });
        response.cookies.set(CORE_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'strict' });
        return response;
      }
      if (method === 'GET') { sessionId(request); return json({ authenticated: true }); }
    }
    const owner = sessionId(request);
    if (route === 'status' && method === 'GET') {
      const ready = await coreJson('/ready');
      return json({ ...ready, adaptive: { enabled: false, reason: 'UPSTREAM_LOCK_MISMATCH', matching_files: 390, required_files: 398 }, release_scope: 'LOCAL_CONDITIONAL_RESEARCH' });
    }
    if (route === 'catalog' && method === 'GET') {
      const catalog = await coreJson('/v1/demo/catalog');
      // Only exact accepted, immutable D fixtures are shared across local sessions.
      catalog.analyses = catalog.analyses.filter((a: { demo_case?: string }) => ['research', 'blocked'].includes(a.demo_case || ''));
      grantAnalyses(owner, catalog.analyses.map((a: { analysis_id: string }) => a.analysis_id));
      return json(catalog);
    }
    if (parts[0] === 'requests' && parts.length === 2 && ['research', 'blocked'].includes(parts[1] || '') && method === 'GET') {
      return json(await coreJson(`/v1/demo/requests/${parts[1]}`));
    }
    if (route === 'analyses' && method === 'POST') {
      const body = await readBody(request);
      let payload = body.request;
      if (body.case === 'research' || body.case === 'blocked') payload = await coreJson(`/v1/demo/requests/${body.case}`);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new CoreProblem(422, 'SCIENTIFIC_REQUEST_REQUIRED');
      const job = await coreJson('/v1/analyses', 'POST', payload);
      grantAnalyses(owner, [job.analysis_id]);
      return json(job, 202);
    }
    if (parts[0] === 'analyses' && parts.length >= 2 && parts.length <= 3) {
      const aid = parts[1] || ''; ownAnalysis(owner, aid);
      const action = parts[2] || '';
      if (method === 'GET' && action === 'summary') {
        const result = await coreJson(`/v1/analyses/${aid}/result`);
        // An exact projection for display. All numbers still come from canonical D.
        const alts = Array.isArray(result.alternatives) ? result.alternatives : [];
        return json({ status: result.status, farm_id: result.farm_id, run_id: result.run_id,
          decision: result.decision, qualification: result.qualification, warnings: result.warnings,
          missing_requirements: result.missing_requirements, provenance: result.provenance,
          alternatives: alts.map((a: {
            policy_id: string;
            choices: unknown;
            important_uncertainty?: string;
            scenarios?: Array<{
              scenario_id?: string;
              status?: string;
              ET_shortfall_m3_equivalent?: string;
              source_withdrawal_m3?: string;
              worst_service_deficit_mm?: string;
              service_pass?: boolean;
              harvest_years?: number;
            }>;
          }) => ({
            policy_id: a.policy_id,
            choices: a.choices,
            important_uncertainty: a.important_uncertainty,
            ...(Array.isArray(a.scenarios) ? {
              scenarios: a.scenarios.map((s) => ({
                scenario_id: s.scenario_id,
                status: s.status,
                ET_shortfall_m3_equivalent: s.ET_shortfall_m3_equivalent,
                source_withdrawal_m3: s.source_withdrawal_m3,
                worst_service_deficit_mm: s.worst_service_deficit_mm,
                service_pass: s.service_pass,
                harvest_years: s.harvest_years,
              })),
            } : {}),
          })),
          engine_result: {
            scientific_result_sha256: result.engine_result?.scientific_result_sha256,
            location: result.engine_result?.normalized_request?.location ?? null,
            scenario_sources: result.engine_result?.scenario_sources ?? null,
          },
          report_dto: { limitations: result.report_dto?.limitations, summary: result.report_dto?.summary },
        });
      }
      if (method === 'GET' && (!action || ['queue', 'result', 'report', 'comparison', 'evidence', 'manifest', 'bindings', 'appendix', 'pdf', 'html', 'csv'].includes(action))) {
        // D /result serializes a DTO; /json returns its immutable, hash-bound bytes.
        const upstreamAction = action === 'result' ? 'json' : action;
        const response = await coreFetch(`/v1/analyses/${aid}${upstreamAction ? `/${upstreamAction}` : ''}`);
        const mime = response.headers.get('content-type') || 'application/json';
        return new Response(response.body, { status: response.status, headers: { ...headers, 'Content-Type': mime,
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
          ...(['pdf', 'csv'].includes(action) && response.ok ? { 'Content-Disposition': `attachment; filename="ASTROGRON-${aid}.${action}"` } : {}),
        } });
      }
      if (method === 'POST' && ['cancel', 'retry'].includes(action)) {
        const body = await readBody(request);
        if (Object.keys(body).length) throw new CoreProblem(422, 'EMPTY_CONTROL_BODY_REQUIRED');
        return json(await coreJson(`/v1/analyses/${aid}/${action}`, 'POST', {}), 202);
      }
    }
    if (route === 'conversations' && method === 'POST') {
      const body = await readBody(request);
      const aid = String(body.analysis_id || ''); ownAnalysis(owner, aid);
      const conversation = await coreJson('/v1/conversations', 'POST', { analysis_id: aid, locale: 'en' });
      grantConversation(owner, conversation.session_id, aid);
      return json(conversation, 201);
    }
    if (parts[0] === 'conversations' && parts.length === 3 && parts[2] === 'messages' && method === 'POST') {
      ownConversation(owner, parts[1] || '');
      const body = await readBody(request);
      if (typeof body.message !== 'string' || body.message.length > 4000) throw new CoreProblem(422, 'INVALID_CHAT_MESSAGE');
      const reply = await coreJson(`/v1/conversations/${parts[1]}/messages`, 'POST', body);
      if (reply.analysis_job) grantAnalyses(owner, [reply.analysis_job.analysis_id]);
      return json(reply, reply.analysis_job ? 202 : 200);
    }
    throw new CoreProblem(404, 'ROUTE_NOT_FOUND');
  } catch (error) {
    return error instanceof CoreProblem ? json({ error: error.code }, error.status) : json({ error: 'LOCAL_GATEWAY_ERROR' }, 503);
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
