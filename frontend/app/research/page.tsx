'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Database, FileDown, FlaskConical, Lock, MessageSquareText, RefreshCw, ShieldCheck } from 'lucide-react';
import type { CoreChatReply, CoreResult, CoreState } from '@/domain/core-contracts';

const card = 'rounded-2xl border border-[#29455A] bg-[#0D2031] p-5 sm:p-7';
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#548299] px-4 py-2 text-sm font-semibold text-[#F1F7FD] hover:bg-[#17374A] disabled:opacity-50 disabled:cursor-wait';
const primary = `${button} bg-[#72E4F1] !text-[#081521] hover:!bg-[#a5f1f8]`;
const input = 'w-full rounded-xl border border-[#548299] bg-[#07111F] px-3 py-3 text-[#F1F7FD]';

interface PublicDemoPayload {
  schema: string;
  readOnly: boolean;
  scope: string;
  notice: string;
  serviceStatus: {
    scientificStatus: string;
    protectedBaselineFiles: number | null;
    pinnedNativeRuntimeVerified: boolean;
    sourceSnapshotPresent: boolean;
    adaptiveEvidence: { enabled: boolean; reason: string };
    chat: { available: boolean; liveInferenceVerified: boolean; mode: string };
  };
  researchExample: {
    demo_case: string;
    demo_label: string;
    execution_kind: string;
    state: string;
    phase: string;
    scientific_status: string;
    report_available: boolean;
    pdfDownloadUrl: string;
    result: CoreResult;
  };
  blockedExample: {
    demo_case: string;
    demo_label: string;
    execution_kind: string;
    state: string;
    scientific_status: string;
    status: string;
    farm_id: string;
    summary: string | null;
    missing_requirements: { path?: string; reason?: string; action?: string }[];
    warnings: string[];
  } | null;
}

async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/core/${path}`, { cache: 'no-store', method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP_${response.status}`);
  return value;
}
function crop(value: string) {
  return value.replace('research:NL:', '').replace('sugarbeet_601', 'Sugar beet').replace('potato_Fontane', 'Potato (Fontane)').replace('spring_barley_301', 'Spring barley');
}
function JsonDetails({ title, value }: { title: string; value: unknown }) {
  return <details className="rounded-xl border border-[#29455A] p-4"><summary className="cursor-pointer text-sm text-[#72E4F1]">{title}</summary>
    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-[#AEC4D3]">{JSON.stringify(value, null, 2)}</pre></details>;
}

function ScientificResultView({
  result,
  scenario,
  onScenarioChange,
  reportAvailable,
  pdfHref,
  pdfLabel = 'Download scientific PDF',
  headingText = '3. Five-year alternatives & evidence',
  headingId = 'comparison-heading',
  extraLinks,
}: {
  result: CoreResult;
  scenario: string;
  onScenarioChange: (value: string) => void;
  reportAvailable: boolean;
  pdfHref: string;
  pdfLabel?: string;
  headingText?: string;
  headingId?: string;
  extraLinks?: { aid: string };
}) {
  const objectives = result.decision.objectives || [];
  const scenarios = [...new Set(objectives.flatMap(o => o.scenarios.map(s => s.scenario_id)))];
  return (
    <section className={`${card} space-y-5`} aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">{headingText}</h2>
      <p data-testid="research-verdict" className="text-lg text-[#FFCE7B]">
        {result.status === 'EVIDENCE_BLOCKED'
          ? 'Blocked: evidence is missing. No recommendation.'
          : `${result.decision.pareto_ids.length} Pareto alternatives · no scientific or economic winner`}
      </p>
      <p className="text-sm text-[#AEC4D3]">Marketable yield: unavailable. Profit: unavailable. Field agronomy: unqualified. P/K quantities are elemental inventory accounting, not a plant-response prediction.</p>
      {result.alternatives.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {result.alternatives.map((alternative, index) => (
            <article key={alternative.policy_id} className="rounded-xl border border-[#29455A] bg-[#07111F] p-4 space-y-3">
              <h3 className="font-semibold text-[#72E4F1]">Alternative {index + 1}</h3>
              {Object.entries(alternative.choices).map(([field, crops]) => (
                <div key={field}>
                  <p className="text-xs text-[#90A8BA]">{field}</p>
                  <ol className="mt-2 space-y-2 text-sm">
                    {crops.map((c, i) => <li key={i}><span className="text-[#90A8BA]">Year {i + 1}</span> · {crop(c)}</li>)}
                  </ol>
                </div>
              ))}
              <p className="text-xs text-[#AEC4D3]">{alternative.important_uncertainty}</p>
            </article>
          ))}
        </div>
      )}
      {scenarios.length > 0 && (
        <div className="space-y-4">
          <label className="block text-sm">
            Scenario
            <select aria-label="Comparison scenario" className={`${input} mt-2`} value={scenario} onChange={e => onScenarioChange(e.target.value)}>
              {scenarios.map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="pb-3 text-left text-xs text-[#90A8BA]">Five-year crop storage dry matter (kg DM/field); crop components remain separate. Not marketable yield.</caption>
              <thead>
                <tr className="border-b border-[#29455A]">
                  <th className="p-2">Alternative</th>
                  <th className="p-2">N leaching (kg N/field)</th>
                  <th className="p-2">Storage DM by crop (kg/field)</th>
                </tr>
              </thead>
              <tbody>
                {objectives.map((o, i) => {
                  const s = o.scenarios.find(sc => sc.scenario_id === scenario);
                  return s ? (
                    <tr className="border-b border-[#29455A]" key={o.policy_id}>
                      <td className="p-2">{i + 1}</td>
                      <td className="p-2">{s.N_leaching_kg_N_field.toFixed(2)}</td>
                      <td className="p-2">{Object.entries(s.crop_storage_DM_kg_field_by_crop).map(([c, n]) => <div key={c}>{crop(c)}: {n.toFixed(2)}</div>)}</td>
                    </tr>
                  ) : null;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {reportAvailable && <a className={primary} href={pdfHref} data-testid="download-scientific-pdf"><FileDown className="h-4 w-4" />{pdfLabel}</a>}
        {extraLinks && (
          <>
            <a className={button} href={`/api/core/analyses/${extraLinks.aid}/manifest`} target="_blank" rel="noreferrer">Provenance manifest</a>
            <a className={button} href={`/api/core/analyses/${extraLinks.aid}/result`} target="_blank" rel="noreferrer">Canonical JSON</a>
            <a className={button} href={`/api/core/analyses/${extraLinks.aid}/csv`}>Evidence CSV</a>
          </>
        )}
      </div>
      <p className="break-all font-mono text-xs text-[#90A8BA]">Scientific SHA-256: {result.engine_result.scientific_result_sha256 || 'No qualified scientific computation'}</p>
      <JsonDetails title="Qualification & missing requirements" value={{ qualification: result.qualification, missing_requirements: result.missing_requirements, limitations: result.report_dto.limitations }} />
      <JsonDetails title="Source provenance & warnings" value={{ provenance: result.provenance, warnings: result.warnings }} />
    </section>
  );
}

export default function ResearchPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checked, setChecked] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<CoreState[]>([]);
  const [service, setService] = useState<{ status: string; chat?: { available: boolean; live_inference_verified: boolean } } | null>(null);
  const [selectedCase, setSelectedCase] = useState('research');
  const [requestText, setRequestText] = useState('');
  const [job, setJob] = useState<CoreState | null>(null);
  const [result, setResult] = useState<CoreResult | null>(null);
  const [scenario, setScenario] = useState('REFERENCE');
  const [publicScenario, setPublicScenario] = useState('REFERENCE');
  const [publicDemo, setPublicDemo] = useState<PublicDemoPayload | null>(null);
  const [publicDemoError, setPublicDemoError] = useState('');
  const [publicDemoLoading, setPublicDemoLoading] = useState(false);
  const [conversation, setConversation] = useState('');
  const [question, setQuestion] = useState('Explain water');
  const [answers, setAnswers] = useState<{ question: string; reply: CoreChatReply }[]>([]);
  const [sending, setSending] = useState(false);

  const loadServices = useCallback(async () => {
    const [catalogData, status] = await Promise.all([
      api<{ analyses: CoreState[] }>('catalog'), api<NonNullable<typeof service>>('status'),
    ]);
    setCatalog(catalogData.analyses); setService(status);
  }, []);
  useEffect(() => {
    let active = true;
    api<{ authenticated: boolean }>('session').then(async () => {
      if (!active) return; setAuthenticated(true);
      try { await loadServices(); } catch (e) { if (active) setError((e as Error).message); }
    }).catch(() => {}).finally(() => { if (active) setChecked(true); });
    return () => { active = false; };
  }, [loadServices]);
  useEffect(() => {
    if (!checked || authenticated) return;
    let active = true;
    setPublicDemoLoading(true);
    setPublicDemoError('');
    fetch('/api/public-demo', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP_${res.status}`);
        return data as PublicDemoPayload;
      })
      .then((payload) => { if (active) setPublicDemo(payload); })
      .catch((e: Error) => { if (active) setPublicDemoError(e.message || 'PUBLIC_DEMO_UNAVAILABLE'); })
      .finally(() => { if (active) setPublicDemoLoading(false); });
    return () => { active = false; };
  }, [checked, authenticated]);

  const chooseJob = useCallback((next: CoreState) => {
    setJob(next); setResult(null); setConversation(''); setAnswers([]); setError('');
    sessionStorage.setItem('astrogron_core_analysis', next.analysis_id);
  }, []);
  useEffect(() => {
    if (!authenticated || !catalog.length || job) return;
    const aid = sessionStorage.getItem('astrogron_core_analysis');
    if (aid) api<CoreState>(`analyses/${aid}`).then(chooseJob).catch(() => sessionStorage.removeItem('astrogron_core_analysis'));
  }, [authenticated, catalog, job, chooseJob]);
  const aid = job?.analysis_id;
  const pending = job?.state === 'pending';
  useEffect(() => {
    if (!aid || !pending) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const state = await api<CoreState>(`analyses/${aid}`); if (active) { setJob(state); setError(''); } }
      catch (e) { if (active) setError(`Status refresh: ${(e as Error).message}. Your admitted job remains on D.`); }
      if (active) timer = setTimeout(poll, 1800);
    };
    timer = setTimeout(poll, 800);
    return () => { active = false; clearTimeout(timer); };
  }, [aid, pending]);
  useEffect(() => {
    if (!aid || pending || job?.state === 'failed') return;
    let active = true;
    api<CoreResult>(`analyses/${aid}/summary`).then(value => { if (active) setResult(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [aid, pending, job?.state]);

  async function unlock(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('session', { code }); setCode(''); setAuthenticated(true); await loadServices(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function submitFresh() {
    setBusy(true); setError('');
    try {
      const body = selectedCase === 'custom' ? { request: JSON.parse(requestText) } : { case: selectedCase };
      chooseJob(await api<CoreState>('analyses', body));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function control(action: 'cancel' | 'retry') {
    if (!aid) return; setBusy(true); setError('');
    try { setJob(await api<CoreState>(`analyses/${aid}/${action}`, {})); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function ask(event: React.FormEvent) {
    event.preventDefault(); if (!aid || !question.trim()) return;
    setSending(true); setError('');
    try {
      let sid = conversation;
      if (!sid) { const created = await api<{ session_id: string }>('conversations', { analysis_id: aid }); sid = created.session_id; setConversation(sid); }
      const scope = result?.alternatives[0] ? { field_id: Object.keys(result.alternatives[0].choices)[0], source_year: 2017, scenario_id: scenario, policy_id: result.alternatives[0].policy_id } : {};
      const reply = await api<CoreChatReply>(`conversations/${sid}/messages`, { message: question.trim(), scope });
      setAnswers(previous => [...previous, { question, reply }]); setQuestion('');
    } catch (e) {
      const message = (e as Error).message;
      if (message === 'SESSION_NOT_FOUND') setConversation('');
      setError(message);
    } finally { setSending(false); }
  }

  const isCached = job?.execution_kind === 'VERIFIED_CACHED_REPLAY';
  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl space-y-3">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#72E4F1]">Connected research workspace</p>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Your field, the evidence, the alternatives.</h1>
        <p className="text-[#AEC4D3]">Inspect an accepted five-year teaching example, run a scientific request, and ask about that same analysis. Research only; field qualification is required before farm decisions.</p>
      </div>
      {authenticated && <button className={button} onClick={async () => { await api('session', undefined, 'DELETE'); setAuthenticated(false); setJob(null); setResult(null); setCatalog([]); }}>Lock workspace</button>}
    </div>
    {error && <div role="alert" className="rounded-xl border border-[#FF9299]/50 bg-[#FF9299]/10 p-4 text-sm text-[#FF9299] break-words">{error}</div>}
    {!authenticated ? <div className="space-y-6" data-testid="public-judging-demo">
      <section className={`${card} space-y-4`} aria-labelledby="public-demo-intro-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <FlaskConical className="h-6 w-6 text-[#72E4F1]" />
            <h2 id="public-demo-intro-heading" className="text-xl font-semibold">Public Read-Only Scientific Demonstration</h2>
          </div>
          <span className="rounded-full border border-[#57D9A7]/50 bg-[#0D2B2A] px-3 py-1 font-mono text-xs text-[#57D9A7]">
            No access code required · Read-only NASA judging view
          </span>
        </div>
        <p className="text-sm text-[#AEC4D3]">
          Judges and reviewers can inspect verified cached five-year scientific outputs and download the genuine sample scientific PDF directly below without authentication. Private farm drafts, unrestricted compute job submission, and operator credentials remain protected.
        </p>
        {publicDemo?.serviceStatus && (
          <div className="flex flex-wrap gap-2.5 text-xs" aria-label="Public service verification status">
            <span className="rounded-full border border-[#29455A] px-3 py-1.5 text-[#57D9A7]">
              Scientific service: {publicDemo.serviceStatus.scientificStatus}
              {publicDemo.serviceStatus.protectedBaselineFiles ? ` · ${publicDemo.serviceStatus.protectedBaselineFiles} baseline files verified` : ''}
            </span>
            <span className="rounded-full border border-[#29455A] px-3 py-1.5 text-[#FFCE7B]">
              Adaptive Evidence: disabled · {publicDemo.serviceStatus.adaptiveEvidence.reason.toLowerCase().replaceAll('_', ' ')}
            </span>
            <span className="rounded-full border border-[#29455A] px-3 py-1.5 text-[#AEC4D3]">
              Live Gemini: unverified · offline evidence fallback in operator mode
            </span>
          </div>
        )}
      </section>

      {publicDemoLoading && !publicDemo && (
        <section className={card}><p className="text-sm text-[#AEC4D3]">Loading verified cached Wageningen five-year research demonstration…</p></section>
      )}
      {publicDemoError && !publicDemo && (
        <section className={`${card} border-[#FFCE7B]/50`}><p className="text-sm text-[#FFCE7B]">Public demonstration temporarily unavailable ({publicDemoError}).</p></section>
      )}

      {publicDemo?.researchExample && (
        <>
          <section className={`${card} space-y-3`} aria-labelledby="public-case-scope-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="public-case-scope-heading" className="text-lg font-semibold text-[#72E4F1]">
                Wageningen teaching field · 1 ha · potato, spring barley, sugar beet (2016–2020)
              </h2>
              <span className="rounded-full border border-[#548299]/60 bg-[#07111F] px-3 py-1 font-mono text-xs text-[#72E4F1]">
                {publicDemo.researchExample.execution_kind}
              </span>
            </div>
            <p className="text-sm text-[#AEC4D3]">
              Uses public NASA POWER historical daily weather (2016–2020) with unmeasured teaching soil and declared initial nutrient states across three paired weather/nitrogen scenarios. Historical research scenarios are NOT field-validated farming recommendations.
            </p>
          </section>

          <ScientificResultView
            result={publicDemo.researchExample.result}
            scenario={publicScenario}
            onScenarioChange={setPublicScenario}
            reportAvailable={publicDemo.researchExample.report_available}
            pdfHref={publicDemo.researchExample.pdfDownloadUrl}
            pdfLabel="Download sample scientific PDF"
            headingText="Verified five-year Pareto alternatives, scenario metrics & sample PDF"
            headingId="public-comparison-heading"
          />
        </>
      )}

      {publicDemo?.blockedExample && (
        <section className={`${card} space-y-4`} aria-labelledby="public-blocked-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="public-blocked-heading" className="text-lg font-semibold text-[#FFCE7B]">
              Fail-Closed Abstention Example · Missing Local Evidence ({publicDemo.blockedExample.farm_id})
            </h2>
            <span className="rounded-full border border-[#FFCE7B]/50 bg-[#2B2212] px-3 py-1 font-mono text-xs text-[#FFCE7B]">
              {publicDemo.blockedExample.status}
            </span>
          </div>
          <p className="text-sm text-[#AEC4D3]">
            {publicDemo.blockedExample.summary || 'Satellite climate context alone never qualifies a farm decision when local soil hydraulics, calibrated crop coefficients, or shared water supply bounds are absent.'}
          </p>
          {publicDemo.blockedExample.missing_requirements.length > 0 && (
            <JsonDetails
              title={`${publicDemo.blockedExample.missing_requirements.length} documented missing evidence requirements`}
              value={publicDemo.blockedExample.missing_requirements}
            />
          )}
        </section>
      )}

      <section className={`${card} mx-auto max-w-xl space-y-4`} aria-labelledby="local-access-heading">
        <div className="flex items-center justify-between gap-2">
          <ShieldCheck className="h-8 w-8 text-[#72E4F1]" />
          <span className="inline-flex items-center gap-1 rounded-full border border-[#29455A] px-2.5 py-1 font-mono text-[11px] text-[#90A8BA]">
            <Lock className="h-3 w-3" /> Operator / Private Workspace
          </span>
        </div>
        <h2 id="local-access-heading" className="text-xl font-semibold">Open the local demonstration</h2>
        <p className="text-sm text-[#AEC4D3]">Judges do not need an access code for the public scientific demonstration above. Enter the private local access code only to unlock operator job submission, custom requests, private farms, and evidence-grounded Q&amp;A.</p>
        <form onSubmit={unlock} className="space-y-4"><label className="block text-sm" htmlFor="access-code">Local access code</label>
          <input id="access-code" className={input} type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} required maxLength={200} />
          <button className={primary} disabled={busy || !checked}>Open workspace <ArrowRight className="h-4 w-4" /></button></form>
      </section>
    </div> : <>
      <section className="flex flex-wrap gap-3 text-xs" aria-label="Service status">
        <span className="rounded-full border border-[#29455A] px-3 py-2 text-[#57D9A7]">Scientific service: {service?.status || 'checking'}</span>
        <span className="rounded-full border border-[#29455A] px-3 py-2 text-[#AEC4D3]">Chat: {service?.chat?.available ? 'evidence-grounded offline fallback available' : 'unavailable'}</span>
        <span className="rounded-full border border-[#29455A] px-3 py-2 text-[#FFCE7B]">Adaptive Evidence: disabled · upstream version mismatch</span>
        <button className="text-[#72E4F1] underline" onClick={() => loadServices().catch(e => setError(e.message))}>Refresh services</button>
      </section>
      <section className={`${card} space-y-5`} aria-labelledby="select-field-heading">
        <div className="flex items-center gap-3"><FlaskConical className="h-6 w-6 text-[#72E4F1]" /><h2 id="select-field-heading" className="text-xl font-semibold">1. Select a research field</h2></div>
        <label className="block space-y-2 text-sm"><span>Scientific request</span><select className={input} value={selectedCase} onChange={e => setSelectedCase(e.target.value)}>
          <option value="research">Wageningen teaching field · 1 ha · potato, barley, sugar beet</option>
          <option value="blocked">Missing local evidence · Australian teaching fields · expected blocked</option>
          <option value="custom">Supply a canonical scientific request (JSON)</option>
        </select></label>
        {selectedCase === 'research' && <p className="text-sm text-[#AEC4D3]">Public NASA POWER weather, 2016–2020. Unmeasured teaching soil and declared initial states. Two bounded rotations under three scenarios; these inputs do not represent an observed farm.</p>}
        {selectedCase === 'blocked' && <p className="text-sm text-[#FFCE7B]">Climate context alone does not qualify a field. Missing soil and local measurements must produce an evidence-gap abstention.</p>}
        {selectedCase === 'custom' && <div className="space-y-3 text-sm"><p className="text-[#AEC4D3]">Requests stay local. D validates its scientific contract, farm authorization, source provenance and eligibility. Estimated soil data never becomes a field observation.</p>
          <button className={button} onClick={async () => { try { setRequestText(JSON.stringify(await api('requests/research'), null, 2)); } catch (e) { setError((e as Error).message); } }}>Load accepted request to inspect</button>
          <label className="block">Canonical request JSON<textarea aria-label="Canonical request JSON" className={`${input} mt-2 min-h-52 font-mono text-xs`} maxLength={524288} value={requestText} onChange={e => setRequestText(e.target.value)} /></label>
        </div>}
        <div className="flex flex-wrap gap-3">
          {selectedCase !== 'custom' && <button className={primary} disabled={busy || !catalog.some(c => c.demo_case === selectedCase)} onClick={() => { const cached = catalog.find(c => c.demo_case === selectedCase); if (cached) chooseJob(cached); }}><Database className="h-4 w-4" />Open verified cached example</button>}
          <button className={button} disabled={busy || pending || service?.status !== 'ready' || (selectedCase === 'custom' && !requestText.trim())} onClick={submitFresh}><RefreshCw className="h-4 w-4" />Submit new scientific job</button>
        </div>
        <p className="text-xs text-[#90A8BA]">Cached examples are labeled explicitly. A new job uses the single durable science queue; it may take several minutes. Unsupported requests remain blocked.</p>
      </section>
      {job && <section className={`${card} space-y-4`} aria-live="polite" aria-labelledby="job-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="job-heading" className="text-xl font-semibold">2. Analysis status</h2><strong data-testid="core-state" className={job.state === 'blocked' || job.state === 'failed' ? 'text-[#FFCE7B]' : 'text-[#57D9A7]'}>{job.state} · {job.phase}</strong></div>
        <p data-testid="execution-kind" className="text-sm text-[#72E4F1]">{isCached ? 'Verified cached replay · no new simulation executed' : 'New request processed by the scientific service'}</p>
        <p className="break-all font-mono text-xs text-[#90A8BA]">Analysis {job.analysis_id}</p>
        {job.queue && <div className="grid gap-3 sm:grid-cols-3 text-sm" data-testid="core-queue">
          <p>Queue: <strong>{job.queue.status}</strong></p><p>Analyses ahead: <strong>{job.queue.analyses_ahead}</strong></p>
          <p>Estimated START wait: <strong>{!pending ? 'not applicable' : job.queue.status === 'running' ? 'already started' : job.queue.estimated_start_wait_interval_seconds ? `${job.queue.estimated_start_wait_interval_seconds.lower}–${job.queue.estimated_start_wait_interval_seconds.upper} seconds` : 'Estimating · insufficient host history'}</strong></p>
        </div>}
        {pending && <><p className="text-xs text-[#90A8BA]">The wait estimates when computation starts. Completion time and percentage are not known.</p><button className={button} disabled={busy} onClick={() => control('cancel')}>Cancel this job</button></>}
        {job.error && <p className="text-[#FF9299]">{job.error}</p>}
        {job.state === 'failed' && <button className={button} disabled={busy} onClick={() => control('retry')}>Retry at queue tail</button>}
        {job.report_error && <p className="text-[#FFCE7B]">Report availability: {job.report_error}</p>}
      </section>}
      {result && job && aid && <>
        <ScientificResultView
          result={result}
          scenario={scenario}
          onScenarioChange={setScenario}
          reportAvailable={!job.report_error}
          pdfHref={`/api/core/analyses/${aid}/pdf`}
          extraLinks={{ aid }}
        />
        <section className={`${card} space-y-5`} aria-labelledby="chat-heading">
          <div className="flex items-center gap-3"><MessageSquareText className="h-6 w-6 text-[#72E4F1]" /><h2 id="chat-heading" className="text-xl font-semibold">4. Ask about this analysis</h2></div>
          <p className="text-sm text-[#AEC4D3]">Answers use the attached evidence. Hosted AI is off by default; the deterministic fallback retains scientific citations. Live Gemini has not been verified for this release.</p>
          <div className="flex flex-wrap gap-2">{['Explain water', 'Why is there no winner?', 'Explain nitrogen', 'What evidence is missing?'].map(q => <button key={q} className={button} onClick={() => setQuestion(q)}>{q}</button>)}</div>
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={ask}><label className="sr-only" htmlFor="core-question">Question about this analysis</label><input id="core-question" className={input} value={question} onChange={e => setQuestion(e.target.value)} maxLength={4000} required /><button className={primary} disabled={sending || !question.trim()}>{sending ? 'Reading evidence…' : 'Ask'}</button></form>
          <div className="space-y-4" data-testid="core-answers">{answers.map((a, i) => <article key={i} className="space-y-3 rounded-xl border border-[#29455A] bg-[#07111F] p-4"><p className="font-semibold">{a.question}</p><p className="whitespace-pre-wrap text-sm text-[#AEC4D3]">{a.reply.answer || a.reply.text || 'A new scientific scenario was admitted to the queue.'}</p><p className="text-xs text-[#72E4F1]">{a.reply.mode || 'SCIENTIFIC_JOB_PENDING'} · analysis {a.reply.scientific_analysis_reference}</p>
            {a.reply.claims?.length ? <JsonDetails title={`${a.reply.claims.length} evidence citations`} value={a.reply.claims} /> : null}
            {a.reply.analysis_job && <button className={button} onClick={() => chooseJob(a.reply.analysis_job!)}>Track new scenario job</button>}</article>)}</div>
        </section>
      </>}
      <p className="text-sm text-[#90A8BA]">Save and draw your own fields in <Link className="text-[#72E4F1] underline" href="/farms">My Farms</Link>. A saved location or satellite coverage never grants scientific eligibility.</p>
    </>}
  </main>;
}
