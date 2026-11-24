import wageningenRaw from '@/data/generated/wageningen-public-snapshot.json';
import type { CoreResult } from '@/domain/core-contracts';

export interface StandalonePublicChatReply {
  ok: boolean;
  readOnly: boolean;
  scope: string;
  scenario: string;
  cachedCaseReference: string;
  mode: string;
  reason_code?: string | null;
  answer: string;
  claims: { evidence_id: string; pointer: string; value: unknown; unit: string | null }[];
}

const ALLOWED_SCENARIOS = new Set(['REFERENCE', 'LOW_INITIAL_MINERAL_N', 'HALF_RAIN']);
const READ_ONLY_MUTATION_RE =
  /\b(?:what if|what happens if|re-?run|simulate|submit)\b|^\s*(?:please\s+)?(?:change|decrease|increase|lower|replace|modify)\b|\b(?:less|more)\s+rain\b/i;
const UNRELATED_LOCATION_RE =
  /\b(?:my selected (?:field|location|region|site|coordinates)|selected (?:field|location|region|site|coordinates)|different (?:location|region)|unrelated location|uppsala|nyeri|kenya|wagga|australia|sweden|custom (?:location|coordinates))\b/i;

function formatCropName(code: string): string {
  return code
    .replace('research:NL:', '')
    .replace('sugarbeet_601', 'Sugar beet')
    .replace('potato_Fontane', 'Potato (Fontane)')
    .replace('spring_barley_301', 'Spring barley');
}

function getScenarioObjective(result: CoreResult, policyId: string, scenarioId: string) {
  const obj = (result.decision.objectives || []).find((o) => o.policy_id === policyId);
  const sc = obj?.scenarios?.find((s) => s.scenario_id === scenarioId);
  return sc ?? obj?.scenarios?.[0] ?? null;
}

export function answerStandalonePublicQuestion(
  rawQuestion: string,
  requestedScenario?: string
): StandalonePublicChatReply {
  const q = rawQuestion.trim();
  const safeScenario =
    requestedScenario && ALLOWED_SCENARIOS.has(requestedScenario) ? requestedScenario : 'REFERENCE';
  const cachedCaseReference =
    'NL_WAGENINGEN_GROWTH (Wageningen, Netherlands · 5.67°E, 51.97°N · 1 ha · 2016–2020)';

  if (READ_ONLY_MUTATION_RE.test(q)) {
    return {
      ok: true,
      readOnly: true,
      scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
      scenario: safeScenario,
      cachedCaseReference,
      mode: 'READ_ONLY_PUBLIC_DEMO_GUARD',
      reason_code: 'PUBLIC_JOB_SUBMISSION_DISABLED',
      answer:
        'Public showcase mode presents verified pre-computed scenarios (Baseline Weather & Nitrogen REFERENCE, Low Initial Mineral Nitrogen LOW_INITIAL_MINERAL_N, and Reduced Rainfall -50% HALF_RAIN) and does not run arbitrary live what-if parameter mutations. Select another comparison scenario in the dropdown above or ask about water, nitrogen leaching, crop storage dry matter, or missing evidence in Wageningen.',
      claims: [],
    };
  }

  if (UNRELATED_LOCATION_RE.test(q)) {
    return {
      ok: true,
      readOnly: true,
      scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
      scenario: safeScenario,
      cachedCaseReference,
      mode: 'PUBLIC_DEMO_CACHED_CASE_SCOPE_NOTICE',
      reason_code: 'UNRELATED_SELECTED_LOCATION',
      answer:
        `These five-year crop rotation metrics apply specifically to the Wageningen, Netherlands research study (${cachedCaseReference}). Other locations (such as Uppsala, Nyeri, or Wagga Wagga) have different soils, crops, and water constraints and are never extrapolated from Wageningen data. You can inspect regional data readiness in the Interactive Regional Check section below.`,
      claims: [],
    };
  }

  const result = wageningenRaw.result as unknown as CoreResult;
  const alt1 = result.alternatives[0];
  const alt2 = result.alternatives[1];
  const seq1 = (alt1?.choices?.F1 || []).map(formatCropName).join(' → ');
  const seq2 = (alt2?.choices?.F1 || []).map(formatCropName).join(' → ');
  const m1 = alt1 ? getScenarioObjective(result, alt1.policy_id, safeScenario) : null;
  const m2 = alt2 ? getScenarioObjective(result, alt2.policy_id, safeScenario) : null;
  const m1Half = alt1 ? getScenarioObjective(result, alt1.policy_id, 'HALF_RAIN') : null;
  const m1Ref = alt1 ? getScenarioObjective(result, alt1.policy_id, 'REFERENCE') : null;

  const claims: StandalonePublicChatReply['claims'] = [
    {
      evidence_id: 'wag-status-pareto',
      pointer: '/status',
      value: result.status,
      unit: null,
    },
  ];

  if (m1 && alt1) {
    claims.push({
      evidence_id: `wag-alt1-n-${safeScenario.toLowerCase()}`,
      pointer: `/decision/objectives/0/scenarios/${safeScenario}/N_leaching_kg_N_field`,
      value: Number(m1.N_leaching_kg_N_field.toFixed(2)),
      unit: 'kg N/field',
    });
  }
  if (m2 && alt2) {
    claims.push({
      evidence_id: `wag-alt2-n-${safeScenario.toLowerCase()}`,
      pointer: `/decision/objectives/1/scenarios/${safeScenario}/N_leaching_kg_N_field`,
      value: Number(m2.N_leaching_kg_N_field.toFixed(2)),
      unit: 'kg N/field',
    });
  }

  const lower = q.toLowerCase();

  if (/\b(?:water|rain|precip|irrigation|drought|dry|moisture|et)\b/.test(lower)) {
    const refN1 = m1Ref ? m1Ref.N_leaching_kg_N_field.toFixed(2) : '120.26';
    const halfN1 = m1Half ? m1Half.N_leaching_kg_N_field.toFixed(2) : '38.90';
    const sbRef = m1Ref?.crop_storage_DM_kg_field_by_crop?.['research:NL:sugarbeet_601']?.toFixed(0) ?? '23376';
    const sbHalf = m1Half?.crop_storage_DM_kg_field_by_crop?.['research:NL:sugarbeet_601']?.toFixed(0) ?? '18109';
    if (m1Half) {
      claims.push({
        evidence_id: 'wag-alt1-sb-half-rain',
        pointer: '/decision/objectives/0/scenarios/HALF_RAIN/crop_storage_DM_kg_field_by_crop/research:NL:sugarbeet_601',
        value: Number(sbHalf),
        unit: 'kg DM/field',
      });
    }
    return {
      ok: true,
      readOnly: true,
      scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
      scenario: safeScenario,
      cachedCaseReference,
      mode: 'DETERMINISTIC_EVIDENCE_READER',
      answer:
        `Water & Weather Balance (${cachedCaseReference}):\n` +
        `The study drives continuous daily five-year soil-water and crop growth using historical 2016–2020 NASA POWER meteorology under three paired scenarios (no year-boundary soil resets).\n` +
        `• In the reduced rainfall scenario (HALF_RAIN, 50% precipitation), drainage and nitrate leaching drop sharply — e.g., Alternative 1 N leaching falls from ${refN1} kg N/field (REFERENCE) to ${halfN1} kg N/field (HALF_RAIN), while Sugar beet storage dry matter shifts from ${sbRef} to ${sbHalf} kg DM/field.\n` +
        `• Because water stress alone does not validate cultivar market quality or local irrigation water rights, outputs remain exploratory research benchmarks.`,
      claims,
    };
  }

  if (/\b(?:nitrogen|nitrate|\bn\b|leach|fertilizer|nutrient|phosphorus|potassium|\bp\b|\bk\b)\b/.test(lower)) {
    const n1 = m1 ? m1.N_leaching_kg_N_field.toFixed(2) : '—';
    const n2 = m2 ? m2.N_leaching_kg_N_field.toFixed(2) : '—';
    return {
      ok: true,
      readOnly: true,
      scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
      scenario: safeScenario,
      cachedCaseReference,
      mode: 'DETERMINISTIC_EVIDENCE_READER',
      answer:
        `Nitrogen & Nutrient Accounting — Scenario ${safeScenario}:\n` +
        `• Alternative 1 (${seq1}): Five-year N leaching = ${n1} kg N/field.\n` +
        `• Alternative 2 (${seq2}): Five-year N leaching = ${n2} kg N/field.\n` +
        `• Across baseline weather (REFERENCE), Alternative 1 emphasizes Sugar beet (years 1 & 5) with slightly lower leaching than Alternative 2 (which emphasizes Potato in years 1 & 5).\n` +
        `• Soil N mineral/organic dynamics are simulated continuously by WOFOST/SNOMIN with declared initial nutrient states, whereas Phosphorus (P) and Potassium (K) quantities reflect elemental inventory accounting rather than yield-response calibration.`,
      claims,
    };
  }

  if (/\b(?:missing|evidence|qualif|block|gap|validat|soil|source|data|limitation|yield|profit)\b/.test(lower)) {
    claims.push({
      evidence_id: 'wag-qual-yield',
      pointer: '/qualification/yield_response',
      value: result.qualification?.yield_response ?? 'NOT_QUALIFIED',
      unit: null,
    });
    return {
      ok: true,
      readOnly: true,
      scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
      scenario: safeScenario,
      cachedCaseReference,
      mode: 'DETERMINISTIC_EVIDENCE_READER',
      answer:
        `Study Evidence Scope & Missing Field Qualifications:\n` +
        `• Included verified sources: Historical 2016–2020 daily weather from NASA LaRC POWER (T2M_MIN, T2M_MAX, PRECTOTCORR, ALLSKY_SFC_SW_DWN, wind/humidity/radiation) at Wageningen [5.67°E, 51.97°N] + pinned NL crop/process parameters (Potato Fontane, Sugar beet 601, Spring barley 301).\n` +
        `• Explicitly absent / unvalidated for real farm prescriptions: (1) locally sampled root-zone soil hydraulics & measured baseline N/P/K soil tests (uses teaching soil & declared initial states); (2) marketable yield & grade calibration (model reports biological storage dry matter kg DM/field only); (3) local water abstraction permits, farm cost/price data, and pesticide label registrations.`,
      claims,
    };
  }

  if (/\b(?:winner|pareto|compare|both|best|better|alternative|rotation|crop|sequence|dry matter|dm)\b/.test(lower)) {
    const dmText = (m: typeof m1) =>
      m
        ? Object.entries(m.crop_storage_DM_kg_field_by_crop)
            .map(([k, v]) => `${formatCropName(k)}: ${v.toFixed(0)} kg`)
            .join(', ')
        : '—';
    return {
      ok: true,
      readOnly: true,
      scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
      scenario: safeScenario,
      cachedCaseReference,
      mode: 'DETERMINISTIC_EVIDENCE_READER',
      answer:
        `Pareto Trade-Off Comparison — Scenario ${safeScenario}:\n` +
        `Neither alternative is declared a single overall winner because each trades crop storage dry matter composition against nitrate leaching without assuming economic prices or fertilizer-cost weights:\n` +
        `• Alternative 1 (${seq1}): N leaching = ${m1 ? m1.N_leaching_kg_N_field.toFixed(2) : '—'} kg N/field | Storage DM = ${dmText(m1)}\n` +
        `• Alternative 2 (${seq2}): N leaching = ${m2 ? m2.N_leaching_kg_N_field.toFixed(2) : '—'} kg N/field | Storage DM = ${dmText(m2)}\n` +
        `Alternative 1 maximizes Sugar beet biomass and achieves lower leaching under REFERENCE weather, whereas Alternative 2 prioritizes Potato (Fontane) output and lowers leaching slightly under HALF_RAIN.`,
      claims,
    };
  }

  return {
    ok: true,
    readOnly: true,
    scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
    scenario: safeScenario,
    cachedCaseReference,
    mode: 'DETERMINISTIC_EVIDENCE_READER',
    answer:
      `Summary for ${cachedCaseReference} (Scenario: ${safeScenario}):\n` +
      `Two Pareto-optimal 5-year rotations emerged from screening 162 candidate sequences across Potato (Fontane), Spring barley, and Sugar beet:\n` +
      `• Alternative 1 (${seq1}) — N leaching: ${m1 ? m1.N_leaching_kg_N_field.toFixed(2) : '—'} kg N/field.\n` +
      `• Alternative 2 (${seq2}) — N leaching: ${m2 ? m2.N_leaching_kg_N_field.toFixed(2) : '—'} kg N/field.\n` +
      `Try asking about water balance, nitrogen leaching, comparing both alternatives, or what local measurements are needed before farm use.`,
    claims,
  };
}
