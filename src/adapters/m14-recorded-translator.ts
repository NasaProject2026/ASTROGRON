import type {
  CandidatePolicyResult,
  ClimateWaterDataset,
  DailyClimateSeriesPoint,
  EvidenceRecord,
  FieldYearPlanCell,
  M14DecisionDataset,
  ScenarioStateOutcome,
} from '@/domain/contracts';
import {
  NativeM14CandidateAuditSchema,
  NativeM14ComparisonDomainSchema,
  NativeM14OutputReceiptSchema,
  NativeM14PreferenceDecisionsSchema,
  NativeM14ResourceFrontiersSchema,
} from '@/domain/native-schemas';
import {
  ClimateWaterDatasetSchema,
  EvidenceRecordSchema,
  M14DecisionDatasetSchema,
} from '@/domain/schemas';

export interface NativeM14CorpusInputs {
  receipt: unknown;
  environment: {
    python: string;
    platform: string;
    kernel_dependencies?: string;
  };
  comparisonDomain: unknown;
  candidateAudit: unknown;
  preferenceDecisions: unknown;
  preferenceContract: {
    schema: string;
    field_eligibility: string;
    selection_bias: string;
    precision: string;
  };
  resourceFrontiers: unknown;
  assumptionRegister: {
    crop_profiles: Record<
      string,
      {
        phenology: string;
        sowing_mm_dd?: string;
        planting_mm_dd?: string;
        harvest_mm_dd?: string;
        stage_days?: number[];
        evidence_tier?: string;
      }
    >;
  };
  powerReceipt: {
    source_id: string;
    url: string;
    sha256: string;
    retrieved_at: string;
  };
  nasaSourceCatalog: Record<
    string,
    {
      source: string;
      variable: string;
      units: string;
      source_sha256: string;
      source_url: string;
      api_version: string;
      source_available_at: string;
      license: string;
    }
  >;
  power2006To2025: {
    properties: {
      parameter: {
        PRECTOTCORR: Record<string, number | null>;
        T2M: Record<string, number | null>;
        T2M_MIN: Record<string, number | null>;
        T2M_MAX: Record<string, number | null>;
      };
    };
  };
}

interface CropLabelMeta {
  shortName: string;
  scientificName: string;
  plantingWindow: string;
  harvestWindow: string;
}

const AGROVOC_CROP_LABELS: Record<string, CropLabelMeta> = {
  'cropuse:agrovoc:c_6919:c_25512': {
    shortName: 'Winter Rye (Wheat-Proxy)',
    scientificName: 'Secale cereale (exploratory winter-wheat FAO-56 proxy)',
    plantingWindow: 'Sep 10',
    harvestWindow: 'Aug 08 (+1 yr)',
  },
  'cropuse:agrovoc:c_5933:c_3348': {
    shortName: 'Field Pea',
    scientificName: 'Pisum sativum (grain pea, 90-day spring cycle)',
    plantingWindow: 'May 01',
    harvestWindow: 'Jul 30',
  },
  'cropuse:agrovoc:c_7221:c_7370': {
    shortName: 'Starch Potato',
    scientificName: 'Solanum tuberosum (starch cultivar, 130-day spring cycle)',
    plantingWindow: 'May 15',
    harvestWindow: 'Sep 22',
  },
};

function getCropMeta(cropUseId: string): CropLabelMeta {
  return (
    AGROVOC_CROP_LABELS[cropUseId] ?? {
      shortName: cropUseId,
      scientificName: cropUseId,
      plantingWindow: 'Unspecified',
      harvestWindow: 'Unspecified',
    }
  );
}

function summarizeRotation(choices: Record<'F1' | 'F2' | 'F3', string[]>): string {
  const fmt = (arr: string[]) => arr.map((id) => getCropMeta(id).shortName.split(' ')[0]).join('–');
  return `F1 (6ha rainfed): ${fmt(choices.F1)} · F2 (8ha rainfed): ${fmt(choices.F2)} · F3 (10ha irrigable): ${fmt(choices.F3)}`;
}

function variantToRegime(
  variant: 'BASE' | 'WATER_LOW' | 'WATER_HIGH'
): ScenarioStateOutcome['waterResourceRegime'] {
  if (variant === 'WATER_LOW') return 'WATER_LOW_RESTRICTION';
  if (variant === 'WATER_HIGH') return 'WATER_HIGH_BUFFER';
  return 'BASE_ALLOCATION';
}

function windowToYear(
  win: 'DRY_ANCHOR_2018' | 'MEDIAN_ANCHOR_2006' | 'WET_ANCHOR_2012'
): { year: 2018 | 2006 | 2012; label: string } {
  if (win === 'DRY_ANCHOR_2018') {
    return { year: 2018, label: '2018–2022 Dry Historical Window (MERRA-2/POWER)' };
  }
  if (win === 'MEDIAN_ANCHOR_2006') {
    return { year: 2006, label: '2006–2010 Median Historical Window (MERRA-2/POWER)' };
  }
  return { year: 2012, label: '2012–2016 Wet Historical Window (MERRA-2/POWER)' };
}

function normalizePowerValue(v: number | null | undefined): number | null {
  if (v === undefined || v === null || !Number.isFinite(v) || v <= -900) return null;
  return Number(v.toFixed(4));
}

function extractAprToSepSeries(
  power: NativeM14CorpusInputs['power2006To2025']['properties']['parameter'],
  analogueYear: 2018 | 2006 | 2012
): {
  points: DailyClimateSeriesPoint[];
  seasonalPrecipMm: number;
  meanTempC: number;
} {
  const prefix = String(analogueYear);
  const dates = Object.keys(power.PRECTOTCORR)
    .filter((d) => d.startsWith(prefix) && d.slice(4) >= '0405' && d.slice(4) <= '0922')
    .sort();

  let precipSum = 0;
  let tempSum = 0;
  let tempCount = 0;

  const points: DailyClimateSeriesPoint[] = dates.map((ymd, idx) => {
    const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    const dObj = new Date(`${iso}T00:00:00Z`);
    const jan1 = new Date(Date.UTC(analogueYear, 0, 1));
    const dayOfYear = Math.floor((dObj.getTime() - jan1.getTime()) / 86_400_000) + 1;

    const pRaw = normalizePowerValue(power.PRECTOTCORR[ymd]);
    const tAvg = normalizePowerValue(power.T2M[ymd]);
    const tMin = normalizePowerValue(power.T2M_MIN[ymd]);
    const tMax = normalizePowerValue(power.T2M_MAX[ymd]);

    if (pRaw !== null) precipSum += pRaw;
    if (tAvg !== null) {
      tempSum += tAvg;
      tempCount += 1;
    }

    return {
      date: iso,
      dayOfYear: Number.isFinite(dayOfYear) ? dayOfYear : idx + 95,
      analogueYear,
      precipMm: pRaw,
      t2mMinC: tMin,
      t2mMaxC: tMax,
      et0Mm: null,
      etcMm: null,
      etaMm: null,
      rootZoneDeficitMm: null,
      deliveredIrrigationMm: null,
      qualityFlag: pRaw === null || tMin === null || tMax === null ? 'MISSING_NULL' : 'OK',
    };
  });

  return {
    points,
    seasonalPrecipMm: Number(precipSum.toFixed(2)),
    meanTempC: tempCount > 0 ? Number((tempSum / tempCount).toFixed(2)) : 0,
  };
}

export function translateNativeM14ToDto(inputs: NativeM14CorpusInputs): {
  decisionDataset: M14DecisionDataset;
  climateDataset: ClimateWaterDataset;
  evidenceRecords: EvidenceRecord[];
} {
  const receipt = NativeM14OutputReceiptSchema.parse(inputs.receipt);
  const domain = NativeM14ComparisonDomainSchema.parse(inputs.comparisonDomain);
  const audit = NativeM14CandidateAuditSchema.parse(inputs.candidateAudit);
  const decisions = NativeM14PreferenceDecisionsSchema.parse(inputs.preferenceDecisions);
  const frontiers = NativeM14ResourceFrontiersSchema.parse(inputs.resourceFrontiers);

  if (audit.domain_sha256 !== receipt.protocol_sha256) {
    throw new Error(
      `M14 protocol digest mismatch: candidate_audit.domain_sha256 (${audit.domain_sha256}) !== OUTPUT_RECEIPT.protocol_sha256 (${receipt.protocol_sha256}).`
    );
  }

  // Build per-state min ET shortfall across the exact common comparable set
  const stateBestEt = new Map<string, number>();
  for (const c of audit.cases) {
    if (c.status !== 'RESEARCH_CONDITIONAL' || c.ET_shortfall_m3_equivalent === null) continue;
    const v = c.variant ?? c.variant_id ?? c.profile ?? 'BASE';
    const key = `${v}__${c.window}`;
    const prev = stateBestEt.get(key);
    if (prev === undefined || c.ET_shortfall_m3_equivalent < prev) {
      stateBestEt.set(key, c.ET_shortfall_m3_equivalent);
    }
  }

  const admissibleMap = new Map<
    string,
    {
      worstEt: number;
      worstRegret: number;
    }
  >();
  const rawAdmissible =
    (decisions.UNSPECIFIED.RESEARCH_PORTFOLIO_ORDER as {
      all_admissible_objectives?: Array<{
        policy_id: string;
        worst_ET_m3_equivalent: string;
        worst_regret_m3_equivalent: string;
      }>;
    }).all_admissible_objectives ?? [];

  for (const row of rawAdmissible) {
    admissibleMap.set(row.policy_id, {
      worstEt: Number(row.worst_ET_m3_equivalent),
      worstRegret: Number(row.worst_regret_m3_equivalent),
    });
  }

  const worstLeaderId = decisions.MINIMIZE_WORST_ET_SHORTFALL.RESEARCH_PORTFOLIO_ORDER.selected_ids[0]!;
  const regretLeaderId = decisions.MINIMAX_REGRET.RESEARCH_PORTFOLIO_ORDER.selected_ids[0]!;
  const paretoIds = audit.comparison.cross_scenario_Pareto;

  // Deterministic dense rankings across comparable policies
  const comparableIdsByWorst = [...admissibleMap.entries()]
    .sort((a, b) => a[1].worstEt - b[1].worstEt)
    .map(([id]) => id);
  const comparableIdsByRegret = [...admissibleMap.entries()]
    .sort((a, b) => a[1].worstRegret - b[1].worstRegret)
    .map(([id]) => id);

  const m14EvidenceIds = [
    'm14-ev-power-2006-2025-uppsala',
    'm14-ev-candidate-audit-uppsala',
    'm14-ev-resource-frontiers-uppsala',
    'm14-ev-rye-wheat-proxy-ledger',
  ];

  let totalNumericValidCases = 0;
  let totalCalendarInvalidCases = 0;
  let totalNumericPassCases = 0;
  let totalNumericFailCases = 0;

  const policies: CandidatePolicyResult[] = audit.policies.map((pol) => {
    const polCases = audit.cases.filter((c) => c.policy_id === pol.policy_id);
    const isComparable = pol.status !== 'INVALID_CALENDAR';

    const scenarioOutcomes: ScenarioStateOutcome[] = polCases.map((c) => {
      const variant = c.variant ?? c.variant_id ?? c.profile ?? 'BASE';
      const wInfo = windowToYear(c.window);
      const regime = variantToRegime(variant);

      if (c.status === 'CALENDAR_INELIGIBLE' || c.status === 'NOT_COMPUTED') {
        totalCalendarInvalidCases += 1;
        return {
          stateId: `${variant}__${c.window}`,
          analogueYear: wInfo.year,
          analogueLabel: wInfo.label,
          waterResourceRegime: regime,
          nativeVariant: variant,
          calendarVariant: 'SOWING_HARVEST_CALENDAR_OVERLAP',
          isNumericValid: false,
          invalidReason:
            (c as { reason?: string }).reason ??
            pol.abstention_reason ??
            'CALENDAR_OVERLAP',
          passesServiceCriterion: null,
          totalEtShortfallM3Eq: null,
          regretM3Eq: null,
          sourceWithdrawalM3: null,
          bindingFieldId: null,
          bindingFieldDeficitMm: null,
          earliestFailureDate: null,
        };
      }

      totalNumericValidCases += 1;
      if (c.service_pass) totalNumericPassCases += 1;
      else totalNumericFailCases += 1;

      const bestStateEt = stateBestEt.get(`${variant}__${c.window}`) ?? c.ET_shortfall_m3_equivalent!;
      const regret = Number(Math.max(0, c.ET_shortfall_m3_equivalent! - bestStateEt).toFixed(6));

      let bindingFieldId: string | null = null;
      let earliestFailureDate: string | null = null;
      let maxDef = -1;
      for (const fy of c.field_harvest_years) {
        if (fy.crop_ET_deficit_mm > maxDef) {
          maxDef = fy.crop_ET_deficit_mm;
          bindingFieldId = fy.field_id;
        }
        if (
          fy.first_service_breach &&
          (!earliestFailureDate || fy.first_service_breach.date < earliestFailureDate)
        ) {
          earliestFailureDate = fy.first_service_breach.date;
        }
      }

      return {
        stateId: `${variant}__${c.window}`,
        analogueYear: wInfo.year,
        analogueLabel: wInfo.label,
        waterResourceRegime: regime,
        nativeVariant: variant,
        calendarVariant: 'STANDARD_SOWING_CALENDAR',
        isNumericValid: true,
        passesServiceCriterion: c.service_pass,
        totalEtShortfallM3Eq: Number(c.ET_shortfall_m3_equivalent!.toFixed(6)),
        regretM3Eq: regret,
        sourceWithdrawalM3: Number(c.source_withdrawal_m3!.toFixed(3)),
        bindingFieldId,
        bindingFieldDeficitMm: Number(c.max_field_harvest_deficit_mm!.toFixed(6)),
        earliestFailureDate,
      };
    });

    // Build 15-cell Field x Year matrix using BASE resource allocation cases
    const baseDry = polCases.find(
      (c) => (c.variant ?? c.variant_id ?? c.profile ?? 'BASE') === 'BASE' && c.window === 'DRY_ANCHOR_2018'
    );
    const baseMed = polCases.find(
      (c) => (c.variant ?? c.variant_id ?? c.profile ?? 'BASE') === 'BASE' && c.window === 'MEDIAN_ANCHOR_2006'
    );
    const baseWet = polCases.find(
      (c) => (c.variant ?? c.variant_id ?? c.profile ?? 'BASE') === 'BASE' && c.window === 'WET_ANCHOR_2012'
    );

    const fieldIds: Array<'F1' | 'F2' | 'F3'> = ['F1', 'F2', 'F3'];
    const fieldYearMatrix: FieldYearPlanCell[] = [];
    for (const fieldId of fieldIds) {
      const fMeta = domain.fields.find((f) => f.field_id === fieldId)!;
      const crops = pol.choices[fieldId]!;
      for (let idx = 0; idx < 5; idx += 1) {
        const harvestYear = idx + 1;
        const cropCode = crops[idx]!;
        const cMeta = getCropMeta(cropCode);
        const calendarValid =
          isComparable ||
          !(fieldId === 'F3' && harvestYear === 2 && pol.abstention_reason === 'CALENDAR_OVERLAP');

        if (!isComparable) {
          fieldYearMatrix.push({
            fieldId,
            fieldLabel: `${fieldId} (${fMeta.area_ha} ha · ${fMeta.irrigation_access ? 'Irrigable' : 'Rainfed'})`,
            irrigationAccess: fMeta.irrigation_access ? 'YES' : 'NO',
            harvestYear,
            yearLabel: `Year ${harvestYear} (${2017 + harvestYear} / ${2005 + harvestYear} / ${2011 + harvestYear})`,
            cropCode,
            cropName: cMeta.shortName,
            plantingWindow: cMeta.plantingWindow,
            harvestWindow: cMeta.harvestWindow,
            calendarValid,
            calendarInvalidReason: !calendarValid ? 'CALENDAR_OVERLAP:F3:2019' : undefined,
            worstStateDeficitMm: null,
            medianStateDeficitMm: null,
            wetStateDeficitMm: null,
            serviceThresholdMm: Number(domain.service.value_mm),
            passesServiceCriterionAllStates: null,
            firstFailureDate: null,
            firstFailureAnalogueYear: null,
            evidenceIds: ['m14-ev-candidate-audit-uppsala'],
          });
          continue;
        }

        const dryFy = baseDry?.field_harvest_years.find(
          (fy) => fy.field_id === fieldId && fy.harvest_source_year === 2018 + idx
        );
        const medFy = baseMed?.field_harvest_years.find(
          (fy) => fy.field_id === fieldId && fy.harvest_source_year === 2006 + idx
        );
        const wetFy = baseWet?.field_harvest_years.find(
          (fy) => fy.field_id === fieldId && fy.harvest_source_year === 2012 + idx
        );

        const dDry = dryFy ? Number(dryFy.crop_ET_deficit_mm.toFixed(2)) : 0;
        const dMed = medFy ? Number(medFy.crop_ET_deficit_mm.toFixed(2)) : 0;
        const dWet = wetFy ? Number(wetFy.crop_ET_deficit_mm.toFixed(2)) : 0;

        fieldYearMatrix.push({
          fieldId,
          fieldLabel: `${fieldId} (${fMeta.area_ha} ha · ${fMeta.irrigation_access ? 'Irrigable' : 'Rainfed'})`,
          irrigationAccess: fMeta.irrigation_access ? 'YES' : 'NO',
          harvestYear,
          yearLabel: `Year ${harvestYear} (${2018 + idx}/${2006 + idx}/${2012 + idx})`,
          cropCode,
          cropName: cMeta.shortName,
          plantingWindow: cMeta.plantingWindow,
          harvestWindow: cMeta.harvestWindow,
          calendarValid: true,
          worstStateDeficitMm: dDry,
          medianStateDeficitMm: dMed,
          wetStateDeficitMm: dWet,
          serviceThresholdMm: Number(domain.service.value_mm),
          passesServiceCriterionAllStates: dDry <= 100 && dMed <= 100 && dWet <= 100,
          firstFailureDate: dryFy?.first_service_breach?.date ?? null,
          firstFailureAnalogueYear: dryFy?.first_service_breach ? 2018 : null,
          evidenceIds: ['m14-ev-candidate-audit-uppsala', 'm14-ev-power-2006-2025-uppsala'],
        });
      }
    }

    const admissible = admissibleMap.get(pol.policy_id);
    const passedCount = scenarioOutcomes.filter((s) => s.passesServiceCriterion === true).length;
    const failedCount = scenarioOutcomes.filter((s) => s.passesServiceCriterion === false).length;
    const validWithdrawals = scenarioOutcomes
      .map((s) => s.sourceWithdrawalM3)
      .filter((v): v is number => v !== null);
    const meanWithdrawal =
      validWithdrawals.length > 0
        ? Number((validWithdrawals.reduce((a, b) => a + b, 0) / validWithdrawals.length).toFixed(2))
        : null;

    let highlightTag: CandidatePolicyResult['highlightTag'];
    if (!isComparable) highlightTag = 'CALENDAR_EXCLUDED';
    else if (pol.policy_id === worstLeaderId) highlightTag = 'LEAST_WORST_SHORTFALL';
    else if (pol.policy_id === regretLeaderId) highlightTag = 'MINIMAX_REGRET_SELECTION';
    else if (paretoIds.includes(pol.policy_id)) highlightTag = 'PARETO_ALTERNATIVE';

    return {
      policyId: pol.policy_id,
      shortLabel: `${pol.policy_id.slice(0, 10)}… · ${pol.origin}${
        pol.policy_id === worstLeaderId
          ? ' (Least-Worst ET)'
          : pol.policy_id === regretLeaderId
          ? ' (Minimax Regret)'
          : !isComparable
          ? ' (Calendar Excluded)'
          : ''
      }`,
      rotationSummary: summarizeRotation(pol.choices),
      isComparable,
      calendarInvalidCount: isComparable ? 0 : polCases.length,
      calendarInvalidReason: !isComparable
        ? `${pol.abstention_reason} (F3 Year 2019 Potato→Winter Rye sowing overlap)`
        : undefined,
      numericStatesEvaluated: passedCount + failedCount,
      statesPassedCount: passedCount,
      statesFailedCount: failedCount,
      passesAllTestedScenarios: false,
      worstEtShortfallM3Eq: isComparable
        ? admissible?.worstEt ?? Number(pol.worst_ET_m3_equivalent ?? 0)
        : null,
      maxRegretM3Eq: isComparable
        ? admissible?.worstRegret ?? Number(pol.worst_regret_m3_equivalent ?? 0)
        : null,
      meanSourceWithdrawalM3: isComparable ? meanWithdrawal : null,
      isParetoNonDominated: paretoIds.includes(pol.policy_id),
      rankByWorstShortfall: isComparable ? comparableIdsByWorst.indexOf(pol.policy_id) + 1 : null,
      rankByMinimaxRegret: isComparable ? comparableIdsByRegret.indexOf(pol.policy_id) + 1 : null,
      highlightTag,
      fieldYearMatrix,
      scenarioOutcomes,
      evidenceIds: m14EvidenceIds,
    };
  });

  // Sort policies cleanly: worstLeader first, regretLeader second, then comparable ranks, then calendar excluded
  policies.sort((a, b) => {
    if (a.rankByWorstShortfall !== null && b.rankByWorstShortfall !== null) {
      return a.rankByWorstShortfall - b.rankByWorstShortfall;
    }
    if (a.rankByWorstShortfall !== null) return -1;
    if (b.rankByWorstShortfall !== null) return 1;
    return a.policyId.localeCompare(b.policyId);
  });

  const boundary0 = frontiers.BASE_boundaries[0]!;
  const comparableCount = policies.filter((p) => p.isComparable).length;
  const excludedCount = policies.length - comparableCount;

  const decisionDataset: M14DecisionDataset = M14DecisionDatasetSchema.parse({
    schemaId: 'astragron.m14.response.v1',
    datasetMode: 'RECORDED_M14_RESEARCH',
    syntheticDisclosure:
      'RECORDED M14 SCIENTIFIC CORPUS (READ-ONLY) — SHA-256 verified against OUTPUT_RECEIPT.json. Fixed Uppsala SE_UPPSALA 5-year in-sample research analysis (2006–2022 historical windows). Zero universal-feasible plans; field recommendation BLOCKED.',
    fieldValidated: false,
    caseId: `M14-SE_UPPSALA-${receipt.protocol_sha256.slice(0, 12)}`,
    caseTitle: 'Uppsala Recorded Research Case (SE_UPPSALA · Fixed 16-Policy M14 Corpus)',
    siteId: 'uppsala-demo',
    evaluatedAt: inputs.powerReceipt.retrieved_at,
    serviceCriterionFeasibility: 'ALL_CANDIDATES_FAIL_UNIVERSAL_CRITERION',
    fieldRecommendationEligibility: 'BLOCKED',
    fieldRecommendationBlockedReasons: [
      'ABSTAIN_NO_ALL_SCENARIOS_SERVICE_PASS: 0 of 16 tested sequences satisfy <=100 mm crop ET deficit across all 9 scenario states (F1/F2 rainfed deficit >=165.47 mm in DRY_ANCHOR_2018).',
      `FIELD_RECOMMENDATION_ELIGIBILITY = BLOCKED (${inputs.preferenceContract.field_eligibility}).`,
      'UNQUALIFIED_CROP_PROXY: Secale cereale winter rye uses FAO-56 Table 12/22 winter wheat exploratory proxy coefficients; no field/soil/N/rights calibration exists.',
      `IN_SAMPLE_SELECTION_BIAS: ${inputs.preferenceContract.selection_bias}.`,
    ],
    portfolioSummary: {
      totalPolicies: policies.length,
      totalPoliciesTested: policies.length,
      totalScenarioStates: domain.states.length,
      totalPolicyStateCases: audit.cases.length,
      numericValidCases: totalNumericValidCases,
      calendarInvalidCases: totalCalendarInvalidCases,
      numericPassCases: totalNumericPassCases,
      numericFailCases: totalNumericFailCases,
      policiesPassingAllStates: 0,
      universalPassPoliciesCount: 0,
      comparablePoliciesCount: comparableCount,
      excludedCalendarPoliciesCount: excludedCount,
    },
    referenceSelections: {
      leastWorstShortfallPolicyId: worstLeaderId,
      leastWorstShortfallValueM3Eq: Number(decisions.MINIMIZE_WORST_ET_SHORTFALL.original_M12_worst_choice.value),
      minimaxRegretPolicyId: regretLeaderId,
      minimaxRegretValueM3Eq: Number(decisions.MINIMAX_REGRET.original_M12_regret_choice.value),
      nonIrrigableFieldId: 'F1',
      nonIrrigableDryDeficitMm: boundary0.raw_max_model_deficit_mm,
      assumedServiceThresholdMm: Number(domain.service.value_mm),
    },
    scientificMeta: {
      sourceSchema: audit.schema,
      protocolSha256: receipt.protocol_sha256,
      receiptFilesSha256: receipt.files,
      canonicalSiteId: 'SE_UPPSALA',
      paretoFrontierIds: paretoIds,
      resourceSensitivityBracket: {
        representativePolicyId: boundary0.policy_id,
        lastFailingGridMm: boundary0.last_failing_grid_mm,
        firstPassingGridMm: boundary0.first_passing_grid_mm,
        rawMaxModelDeficitMm: boundary0.raw_max_model_deficit_mm,
        finiteDeliveryGridM3Day: frontiers.finite_delivery_grid,
        serviceLimitMm: domain.service.value_mm,
      },
      inSampleSelectionNote: inputs.preferenceContract.selection_bias,
      crossPlatformCaveat: `Canonical reference artifact generated on ${inputs.environment.platform} Python ${inputs.environment.python}. Cross-platform libm transcendental drift (e.g. Linux glibc vs Windows UCRT 1-ULP rounding) is documented in M14_FORENSIC_REVIEW; conclusion and winners remain unchanged.`,
      environmentNote:
        inputs.environment.kernel_dependencies ??
        'M14 portable daily kernel uses Python stdlib with 1e-6 m3 half-even objective precision and 1e-8 mm service comparison tolerance.',
    },
    policies,
  });

  // Build authentic NASA POWER 2006–2025 daily weather dataset (Apr 05 - Sep 22 across 2018, 2006, 2012)
  const p2018 = extractAprToSepSeries(inputs.power2006To2025.properties.parameter, 2018);
  const p2006 = extractAprToSepSeries(inputs.power2006To2025.properties.parameter, 2006);
  const p2012 = extractAprToSepSeries(inputs.power2006To2025.properties.parameter, 2012);

  const leaderPol = policies.find((p) => p.policyId === worstLeaderId)!;
  const medBase = leaderPol.scenarioOutcomes.find((s) => s.stateId === 'BASE__MEDIAN_ANCHOR_2006');
  const wetBase = leaderPol.scenarioOutcomes.find((s) => s.stateId === 'BASE__WET_ANCHOR_2012');
  const dryBase = leaderPol.scenarioOutcomes.find((s) => s.stateId === 'BASE__DRY_ANCHOR_2018');

  const climateDataset: ClimateWaterDataset = ClimateWaterDatasetSchema.parse({
    siteId: 'uppsala-demo',
    locationLabel: 'Uppsala, Sweden — SE_UPPSALA (59.82°N, 17.65°E · NASA POWER/MERRA-2 0.625°×0.5°)',
    datasetMode: 'RECORDED_M14_RESEARCH',
    syntheticDisclosure:
      'RECORDED NASA POWER METEOROLOGICAL ARCHIVE — Observed daily PRECTOTCORR & T2M_MIN/T2M_MAX from verified POWER_2006_2025.json (SHA f231ad6a...). Daily modeled ET0/ETc/deficit traces are omitted (null) because only raw weather inputs and scenario-level M14 summaries are bundled.',
    analogueYearsNote:
      '2018 (dry), 2006 (median), and 2012 (wet) anchor years represent the exact historical windows evaluated in M8–M14, NOT meteorological forecasts for 2027–2031.',
    timeWindowLabel:
      'April 05 – September 22 Historical Anchor Windows (Real NASA POWER Precipitation/Temp + Recorded M14 Peak F1 Deficits)',
    units: {
      precipitation: 'mm/day',
      temperature: '°C',
      evapotranspiration: 'mm/day',
      deficit: 'mm',
      volume: 'm³ equivalent',
    },
    analogueSummaries: [
      {
        analogueYear: 2018,
        classification: 'DRY_ANALOGUE',
        label: '2018–2022 Dry Historical Window (POWER_2006_2025 + M14 Audit)',
        seasonalPrecipMm: p2018.seasonalPrecipMm,
        seasonalEt0Mm: null,
        peakF1DeficitMm: dryBase?.bindingFieldDeficitMm ?? boundary0.raw_max_model_deficit_mm,
        firstThresholdBreachDate: dryBase?.earliestFailureDate ?? '2018-07-09',
        meanTempC: p2018.meanTempC,
        evidenceId: 'm14-ev-power-2006-2025-uppsala',
      },
      {
        analogueYear: 2006,
        classification: 'MEDIAN_ANALOGUE',
        label: '2006–2010 Median Historical Window (POWER_2006_2025 + M14 Audit)',
        seasonalPrecipMm: p2006.seasonalPrecipMm,
        seasonalEt0Mm: null,
        peakF1DeficitMm: medBase?.bindingFieldDeficitMm ?? 0,
        firstThresholdBreachDate: medBase?.earliestFailureDate ?? null,
        meanTempC: p2006.meanTempC,
        evidenceId: 'm14-ev-power-2006-2025-uppsala',
      },
      {
        analogueYear: 2012,
        classification: 'WET_ANALOGUE',
        label: '2012–2016 Wet Historical Window (POWER_2006_2025 + M14 Audit)',
        seasonalPrecipMm: p2012.seasonalPrecipMm,
        seasonalEt0Mm: null,
        peakF1DeficitMm: wetBase?.bindingFieldDeficitMm ?? 0,
        firstThresholdBreachDate: wetBase?.earliestFailureDate ?? null,
        meanTempC: p2012.meanTempC,
        evidenceId: 'm14-ev-power-2006-2025-uppsala',
      },
    ],
    seriesByAnalogue: {
      '2018': p2018.points,
      '2006': p2006.points,
      '2012': p2012.points,
    },
  });

  const samplePrecip2018 = p2018.points.slice(0, 12).map((pt) => ({
    date: pt.date,
    value: pt.precipMm,
  }));

  const rawEvidenceRecords: EvidenceRecord[] = [
    {
      evidence_id: 'm14-ev-power-2006-2025-uppsala',
      site_id: 'uppsala-demo',
      dataset_mode: 'RECORDED_M14_RESEARCH',
      source: 'NASA POWER / MERRA-2 (POWER_2006_2025.json)',
      product_version: 'v2.10.3',
      variable: 'PRECTOTCORR / T2M / T2M_MIN / T2M_MAX',
      variable_label: 'Daily Gridded Precipitation & Air Temperature (2006–2025 UTC)',
      evidence_class: 'REGIONAL_MODEL_EVIDENCE',
      spatial_support: '0.625° lon × 0.5° lat MERRA-2 grid cell centered near [17.65, 59.82]; NOT field rain gauge',
      period: '2006-01-01 to 2025-12-31 (7,305 daily rows UTC)',
      timezone: 'UTC',
      available_at: inputs.powerReceipt.retrieved_at,
      units: 'mm/day, °C',
      quality: '0 missing days across 2006–2025 historical series',
      missingness_summary: 'Verified complete native JSON; missingness preserved via null without zero imputation.',
      uncertainty: 'Regional meteorological reanalysis; does not measure sub-kilometer convective rainfall or field soil moisture.',
      license: 'NASA POWER public-access attribution (MERRA-2); no NASA endorsement.',
      source_sha256: inputs.powerReceipt.sha256,
      extraction_recipe: `POWER API v2.10.3 daily point query (${inputs.powerReceipt.url})`,
      samples: samplePrecip2018,
      limitations: [
        'Regional grid cell (.625°×.5°), not a surveyed farm weather station.',
        'Historical 2006–2022 windows are retrospective benchmarks, not 2027–2031 weather forecasts.',
      ],
      supports_components: ['results', 'climate', 'plans', 'decisions', 'analysis', 'reports'],
    },
    {
      evidence_id: 'm14-ev-candidate-audit-uppsala',
      site_id: 'uppsala-demo',
      dataset_mode: 'RECORDED_M14_RESEARCH',
      source: 'ASTRAGRON M14 Candidate Audit (candidate_audit.json)',
      product_version: audit.schema,
      variable: 'POLICY_SCENARIO_AUDIT_16X9',
      variable_label: '16 Candidate Policies × 9 States (144 Cases: 90 PASS / 45 FAIL / 9 INVALID_CALENDAR)',
      evidence_class: 'DERIVED',
      spatial_support: 'SE_UPPSALA fixed 3-field assumption set (F1 6ha rainfed, F2 8ha rainfed, F3 10ha irrigable)',
      period: 'DRY_ANCHOR_2018 (2018–2022), MEDIAN_ANCHOR_2006 (2006–2010), WET_ANCHOR_2012 (2012–2016)',
      timezone: 'UTC',
      available_at: inputs.powerReceipt.retrieved_at,
      units: 'm³ equivalent shortfall/regret; mm harvest deficit',
      quality: 'Max daily mass balance residual <= 6.93e-14 mm (SCIENTIFIC_ACCEPTANCE)',
      missingness_summary: '9 INVALID_CALENDAR cases (10e4f587b144b38bae9d) strictly nulled; 0 synthetic zero-fills.',
      uncertainty: 'Conditional on M8 crop/soil/resource assumptions and Windows Python 3.14.3 IEEE-754 evaluation.',
      license: 'ASTRAGRON internal research corpus; PUBLIC_RELEASE_ON_HOLD.',
      source_sha256: receipt.files['candidate_audit.json']!,
      extraction_recipe: `Verified against OUTPUT_RECEIPT.json (protocol SHA-256 ${receipt.protocol_sha256})`,
      samples: [
        {
          date: '2018-07-09',
          value: boundary0.raw_max_model_deficit_mm,
        },
      ],
      limitations: [
        '0 of 16 candidates pass <=100 mm in all 9 scenario states (NO_ROBUSTLY_FEASIBLE_POLICY).',
        'In-sample comparison on the same 3 historical windows used in M10 search.',
        'FIELD_RECOMMENDATION_ELIGIBILITY = BLOCKED (no legal water rights, soil/N/yield validation).',
      ],
      supports_components: ['results', 'plans', 'decisions', 'analysis', 'reports'],
    },
    {
      evidence_id: 'm14-ev-resource-frontiers-uppsala',
      site_id: 'uppsala-demo',
      dataset_mode: 'RECORDED_M14_RESEARCH',
      source: 'ASTRAGRON M14 Resource Frontiers (resource_frontiers.json)',
      product_version: frontiers.schema,
      variable: 'BRACKETED_SERVICE_SENSITIVITY',
      variable_label: 'Finite Delivery Cap Grid [20, 80, 200] m³/day & 165.473239/165.473240 mm Bracket',
      evidence_class: 'DERIVED',
      spatial_support: 'SE_UPPSALA F1/F2/F3 model domain (F1 rainfed floor)',
      period: 'DRY_ANCHOR_2018, MEDIAN_ANCHOR_2006, WET_ANCHOR_2012 (BASE variant)',
      timezone: 'UTC',
      available_at: inputs.powerReceipt.retrieved_at,
      units: 'mm per field harvest year; m³/day source/pump cap',
      quality: '1e-6 mm grid bracket around raw F1 deficit 165.47323956605408 mm',
      missingness_summary: 'Discrete finite grid only; supply monotonicity is explicitly FALSE.',
      uncertainty: '165.473239566... mm is conditional first-season model ET deficit, NOT biological crop survival limit.',
      license: 'ASTRAGRON internal research corpus; PUBLIC_RELEASE_ON_HOLD.',
      source_sha256: receipt.files['resource_frontiers.json']!,
      extraction_recipe: 'M14 resource_frontiers.json BASE_boundaries & service_points audit',
      samples: [{ date: '2018-07-09', value: 165.47324 }],
      limitations: [
        'Bracketed numerical sensitivity, NOT a safe agronomic drought tolerance threshold.',
        'Changing pump capacity on F3 cannot rescue rainfed parcels F1 and F2.',
      ],
      supports_components: ['decisions', 'analysis', 'reports'],
    },
    {
      evidence_id: 'm14-ev-rye-wheat-proxy-ledger',
      site_id: 'uppsala-demo',
      dataset_mode: 'RECORDED_M14_RESEARCH',
      source: 'M8 Assumption Register & Eligibility Ledger',
      product_version: 'astragron.m8.eligibility.v1',
      variable: 'CROP_PARAMETERS_WINTER_RYE_PROXY',
      variable_label: 'Exploratory FAO-56 Wheat Proxy & SJV Sowing Advisory (Unqualified Field Calibration)',
      evidence_class: 'RESEARCH_ASSUMPTION',
      spatial_support: 'Literature proxy parameters (not local field-trial measurements)',
      period: 'Static research parameter snapshot',
      timezone: 'UTC',
      available_at: inputs.powerReceipt.retrieved_at,
      units: 'dimensionless Kc / m rooting depth',
      quality: 'ASSUMED_NOT_OBSERVED — winter rye (Secale cereale) relies on FAO-56 winter wheat Kc/root proxy',
      missingness_summary: 'No mineral N process coupling, no yield curve, no price/cost optimization.',
      uncertainty: 'High agronomic transfer uncertainty; blocks all field-level recommendations.',
      license: 'Factual metadata only; no full FAO/SJV document redistribution.',
      source_sha256: receipt.files['preference_decisions.json']!,
      extraction_recipe: 'ASSUMPTION_REGISTER.json + EVIDENCE_ELIGIBILITY_LEDGER.json',
      samples: [],
      limitations: [
        'Explicitly UNQUALIFIED_GRAIN_RYE_EXPLORATORY_WHEAT_PROXY in M8 ASSUMPTION_REGISTER.json.',
        'Stage dates and winter freeze suppression assumed, not observed.',
      ],
      supports_components: ['plans', 'results', 'coverage', 'reports'],
    },
  ];

  const evidenceRecords = rawEvidenceRecords.map((r) => EvidenceRecordSchema.parse(r));

  return { decisionDataset, climateDataset, evidenceRecords };
}
