import { z } from 'zod';

/**
 * Native M14 & M4 Strict Upstream Contract Validators (Gate G1)
 * Directly mirrors `astragron.m14.*` and `astragron.global-evidence.v1` JSON artifacts.
 * Rejects `NaN`, `Infinity`, missing keys, calendar-invalid numeric scores, negative flows,
 * missing-source conflated with zero rain, and foreign-site contamination.
 */

const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const PolicyIdSchema = z.string().regex(/^[a-f0-9]{20}$/);
const DecimalStringSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const NativeM14OutputReceiptSchema = z
  .object({
    files: z.record(z.string().min(1), Sha256HexSchema),
    protocol_sha256: Sha256HexSchema,
  })
  .strict();

export const NativeM14PolicyChoicesSchema = z
  .object({
    F1: z.array(z.string().min(1)).length(5),
    F2: z.array(z.string().min(1)).length(5),
    F3: z.array(z.string().min(1)).length(5),
  })
  .strict();

export const NativeM14CalendarWitnessSchema = z
  .object({
    reason: z.string().min(1),
    field_id: z.enum(['F1', 'F2', 'F3']),
    harvest_source_year: z.number().int().min(2006).max(2025),
    numeric_water_trace: z.null(),
  })
  .strict();

export const NativeM14NumericWitnessSchema = z
  .object({
    variant: z.enum(['BASE', 'WATER_LOW', 'WATER_HIGH']),
    window: z.enum(['DRY_ANCHOR_2018', 'MEDIAN_ANCHOR_2006', 'WET_ANCHOR_2012']),
    first_service_breach_date: IsoDateSchema.nullable(),
    first_binding_resource: z
      .object({
        date: IsoDateSchema,
        groups: z.array(z.string().min(1)),
        allocated_litres: z.number().finite().nonnegative(),
        allocation_evidence_id: Sha256HexSchema,
      })
      .passthrough()
      .nullable(),
    field_day_witness: z
      .object({
        field_id: z.enum(['F1', 'F2', 'F3']),
        date: IsoDateSchema,
        harvest_source_year: z.number().int().min(2006).max(2025),
        crop_use_id: z.string().min(1),
        irrigation_access: z.boolean(),
        cumulative_before_mm: z.number().finite().nonnegative(),
        cumulative_after_mm: z.number().finite().nonnegative(),
        native_weather_id: Sha256HexSchema,
      })
      .passthrough()
      .nullable(),
  })
  .strict();

export const NativeM14FirstFailureWitnessSummarySchema = z.union([
  NativeM14CalendarWitnessSchema,
  NativeM14NumericWitnessSchema,
]);

export const NativeM14PolicySummarySchema = z
  .object({
    policy_id: PolicyIdSchema,
    origin: z.enum(['ORIGINAL_M8', 'M10_GENERATED_IN_SAMPLE']),
    choices: NativeM14PolicyChoicesSchema,
    status: z.enum(['FAIL', 'INVALID_CALENDAR', 'PASS']),
    scenario_count: z.number().int().positive(),
    completed_scenarios: z.number().int().nonnegative(),
    hard_constraints_pass: z.boolean(),
    service_all_scenarios_pass: z.boolean(),
    not_computed: z.boolean(),
    field_recommendation: z.null(),
    abstention_reason: z.string().min(1),
    M13_detailed_before_M14: z.boolean(),
    numeric_objectives: z.null().optional(),
    worst_ET_m3_equivalent: DecimalStringSchema.nullable().optional(),
    worst_regret_m3_equivalent: DecimalStringSchema.nullable().optional(),
    worst_breach_field_year_count: z.number().int().nonnegative().nullable().optional(),
    robust_service_pass: z.boolean().optional(),
    rainfed_service_floor_mm: z.number().finite().nonnegative().optional(),
    first_failure_witnesses: z.array(NativeM14FirstFailureWitnessSummarySchema),
  })
  .passthrough()
  .superRefine((p, ctx) => {
    if (p.status === 'INVALID_CALENDAR') {
      if (
        p.completed_scenarios !== 0 ||
        p.hard_constraints_pass ||
        p.service_all_scenarios_pass ||
        (p.worst_ET_m3_equivalent !== undefined && p.worst_ET_m3_equivalent !== null) ||
        (p.worst_regret_m3_equivalent !== undefined && p.worst_regret_m3_equivalent !== null)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'INVALID_CALENDAR native policy must preserve zero completed scenarios and null numeric objectives.',
        });
      }
    }
  });

export const NativeM14FieldHarvestYearSchema = z
  .object({
    field_id: z.enum(['F1', 'F2', 'F3']),
    harvest_source_year: z.number().int().min(2006).max(2025),
    crop_use_id: z.string().min(1),
    active_days: z.number().int().positive(),
    crop_source_withdrawal_m3: z.number().finite().nonnegative(),
    net_irrigation_m3: z.number().finite().nonnegative(),
    crop_ET_deficit_mm: z.number().finite().nonnegative(),
    ET_actual_mm: z.number().finite().nonnegative(),
    first_service_breach: z
      .object({
        field_id: z.enum(['F1', 'F2', 'F3']),
        harvest_source_year: z.number().int().min(2006).max(2025),
        date: IsoDateSchema,
        cumulative_before_mm: z.number().finite().nonnegative(),
        cumulative_after_mm: z.number().finite().nonnegative(),
        water_transition_evidence_id: Sha256HexSchema,
        weather_evidence_id: Sha256HexSchema,
        allocation_evidence_id: Sha256HexSchema,
      })
      .strict()
      .nullable(),
  })
  .passthrough();

export const NativeM14CandidateCaseSchema = z
  .object({
    policy_id: PolicyIdSchema,
    variant: z.enum(['BASE', 'WATER_LOW', 'WATER_HIGH']).optional(),
    variant_id: z.enum(['BASE', 'WATER_LOW', 'WATER_HIGH']).optional(),
    profile: z.enum(['BASE', 'WATER_LOW', 'WATER_HIGH']).optional(),
    window: z.enum(['DRY_ANCHOR_2018', 'MEDIAN_ANCHOR_2006', 'WET_ANCHOR_2012']),
    status: z.enum(['RESEARCH_CONDITIONAL', 'CALENDAR_INELIGIBLE', 'NOT_COMPUTED']),
    service_pass: z.boolean().nullable(),
    ET_shortfall_m3_equivalent: z.number().finite().nonnegative().nullable(),
    source_withdrawal_m3: z.number().finite().nonnegative().nullable(),
    max_field_harvest_deficit_mm: z.number().finite().nonnegative().nullable(),
    field_harvest_years: z.array(NativeM14FieldHarvestYearSchema),
  })
  .passthrough()
  .superRefine((c, ctx) => {
    if (c.status === 'CALENDAR_INELIGIBLE' || c.status === 'NOT_COMPUTED') {
      if (
        c.service_pass !== null ||
        c.ET_shortfall_m3_equivalent !== null ||
        c.source_withdrawal_m3 !== null ||
        c.max_field_harvest_deficit_mm !== null ||
        c.field_harvest_years.length !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Case ${c.policy_id}/${c.window} with status ${c.status} must not report numeric quantities or PASS/FAIL.`,
        });
      }
    } else if (
      c.service_pass === null ||
      c.ET_shortfall_m3_equivalent === null ||
      c.source_withdrawal_m3 === null ||
      c.max_field_harvest_deficit_mm === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `RESEARCH_CONDITIONAL case ${c.policy_id}/${c.window} must supply finite numeric outcomes.`,
      });
    }
  });

export const NativeM14CandidateAuditSchema = z
  .object({
    schema: z.literal('astragron.m14.candidate-audit.v1'),
    domain_sha256: Sha256HexSchema,
    policies: z.array(NativeM14PolicySummarySchema).min(1),
    cases: z.array(NativeM14CandidateCaseSchema).min(1),
    comparison: z
      .object({
        status: z.literal('NO_ROBUSTLY_FEASIBLE_POLICY'),
        common_ids: z.array(PolicyIdSchema).min(1),
        robust_service_ids: z.array(PolicyIdSchema).length(0),
        minimax_ET: z.object({
          value: DecimalStringSchema,
          policy_ids: z.array(PolicyIdSchema).min(1),
        }),
        minimax_regret_ET: z.object({
          value: DecimalStringSchema,
          policy_ids: z.array(PolicyIdSchema).min(1),
        }),
        cross_scenario_Pareto: z.array(PolicyIdSchema).min(1),
      })
      .passthrough(),
    conclusion: z.literal('NO_FEASIBLE_POLICY_IN_TESTED_SET'),
    proof_over_all_crop_sequences: z.literal(false),
  })
  .passthrough();

export const NativeM14PreferenceDecisionBlockSchema = z
  .object({
    schema: z.literal('astragron.m14.decision.v1'),
    RESEARCH_PORTFOLIO_ORDER: z
      .object({
        status: z.enum([
          'ABSTAIN_NO_FEASIBLE_PLAN',
          'CONDITIONAL_LEAST_VIOLATING',
          'CONDITIONAL_PARETO_FRONTIER',
          'NO_UNIQUE_WINNER',
        ]),
        selected_ids: z.array(PolicyIdSchema),
        complete_domain: z.boolean(),
        conditional_only: z.literal(true),
      })
      .passthrough(),
    SERVICE_CRITERION_FEASIBILITY: z
      .object({
        status: z.literal('NO_FEASIBLE_POLICY_IN_TESTED_SET'),
        feasible_ids: z.array(PolicyIdSchema).length(0),
        threshold_mm: z.string(),
        candidate_count: z.number().int().positive(),
        common_comparable_count: z.number().int().positive(),
        proof_over_all_crop_sequences: z.literal(false),
      })
      .passthrough(),
    FIELD_RECOMMENDATION_ELIGIBILITY: z
      .object({
        status: z.literal('BLOCKED'),
        recommendation: z.null(),
        N_field_coupling: z.null(),
        yield_response: z.null(),
        new_profit: z.null(),
      })
      .passthrough(),
    original_M12_worst_choice: z.object({
      value: DecimalStringSchema,
      policy_ids: z.array(PolicyIdSchema).min(1),
    }),
    original_M12_regret_choice: z.object({
      value: DecimalStringSchema,
      policy_ids: z.array(PolicyIdSchema).min(1),
    }),
    in_sample: z.literal(true),
    held_out_validation: z.literal(false),
  })
  .passthrough();

export const NativeM14PreferenceDecisionsSchema = z
  .object({
    UNSPECIFIED: NativeM14PreferenceDecisionBlockSchema,
    STRICT_ALL_SCENARIOS_SERVICE: NativeM14PreferenceDecisionBlockSchema,
    MINIMIZE_WORST_ET_SHORTFALL: NativeM14PreferenceDecisionBlockSchema,
    MINIMAX_REGRET: NativeM14PreferenceDecisionBlockSchema,
    PARETO_FRONTIER: NativeM14PreferenceDecisionBlockSchema,
  })
  .strict();

export const NativeM14ResourceFrontiersSchema = z
  .object({
    schema: z.literal('astragron.m14.resource-frontiers.v1'),
    representatives: z.array(PolicyIdSchema).min(1),
    finite_delivery_grid: z.array(z.number().finite().positive()).min(1),
    BASE_boundaries: z.array(
      z
        .object({
          policy_id: PolicyIdSchema,
          classification: z.string().min(1),
          first_passing_grid_mm: DecimalStringSchema,
          last_failing_grid_mm: DecimalStringSchema,
          raw_max_model_deficit_mm: z.number().finite().nonnegative(),
        })
        .passthrough()
    ),
    zero_rain_is_missing_source: z.literal(false),
    supply_monotonicity_or_continuous_threshold_claimed: z.literal(false),
    crop_access_rights_storage_changed: z.literal(false),
  })
  .passthrough();

export const NativeM14ComparisonDomainSchema = z
  .object({
    schema: z.literal('astragron.m14.comparison-domain.v1'),
    candidate_ids: z.array(PolicyIdSchema).min(1),
    original_ids: z.array(PolicyIdSchema).min(1),
    new_ids: z.array(PolicyIdSchema).min(1),
    states: z.array(z.tuple([z.enum(['BASE', 'WATER_LOW', 'WATER_HIGH']), z.enum(['DRY_ANCHOR_2018', 'MEDIAN_ANCHOR_2006', 'WET_ANCHOR_2012'])])).min(1),
    historical_windows: z.record(z.string(), z.tuple([IsoDateSchema, IsoDateSchema])),
    fields: z.array(
      z.object({
        field_id: z.enum(['F1', 'F2', 'F3']),
        area_ha: z.number().finite().positive(),
        irrigation_access: z.boolean(),
        area_basis: z.string().min(1),
      })
    ),
    service: z
      .object({
        value_mm: z.string(),
        not_survival_yield_rights_or_profit: z.literal(true),
      })
      .passthrough(),
  })
  .passthrough();

export const NativeM4StatusSchema = z.enum([
  'AVAILABLE',
  'CONDITIONAL',
  'INSUFFICIENT_EVIDENCE',
  'OUT_OF_COVERAGE',
  'TEMPORARILY_UNAVAILABLE',
]);

export const NativeM4SiteEntrySchema = z
  .object({
    schema: z.literal('astragron.global-evidence.v1'),
    site: z
      .object({
        site_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        geometry: z
          .object({
            point: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
            crs: z.literal('EPSG:4326'),
            area_ha: z.number().finite().positive().nullable(),
            area_basis: z.string().min(1),
          })
          .passthrough(),
        as_of: z.string().min(1),
        purpose: z.enum(['DESCRIPTIVE_CONTEXT', 'FUTURE_CLIMATE_CONTEXT', 'MODEL_INPUT_REVIEW']),
      })
      .passthrough(),
    capabilities: z
      .array(
        z
          .object({
            capability: z.string().min(1),
            status: NativeM4StatusSchema,
            evidence_ids: z.array(z.string().min(1)),
            requirements_missing: z.array(z.string()),
            scientific_scope: z.string().min(1),
          })
          .passthrough()
      )
      .min(1),
    source_coverage: z
      .array(
        z
          .object({
            source_id: z.string().min(1),
            variable: z.string().min(1),
            status: NativeM4StatusSchema,
            reason: z.string().min(1),
            site_id: z.string().min(1),
          })
          .passthrough()
      )
      .min(1),
    evidence: z.array(
      z
        .object({
          evidence_id: Sha256HexSchema,
          source_sha256: Sha256HexSchema,
          variable: z.string().min(1),
          units: z.string().min(1),
        })
        .passthrough()
    ),
    FIELD_CALIBRATED_RECOMMENDATION_READY: z.literal(false),
    numeric_optimizer_coupling: z.enum(['NONE', 'NONE_M5_M6_NOT_STARTED']),
    global_mask: z.literal(false).nullable(),
  })
  .passthrough()
  .superRefine((entry, ctx) => {
    for (const sc of entry.source_coverage) {
      if (sc.site_id !== entry.site.site_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['source_coverage'],
          message: `Cross-site contamination detected: coverage item belongs to ${sc.site_id}, expected ${entry.site.site_id}.`,
        });
      }
    }
  });

export const NativeM4GlobalCoverageManifestSchema = z
  .object({
    schema: z.literal('astragron.global-evidence.v1'),
    as_of: z.string().min(1),
    purpose: z.string().min(1),
    sites: z.array(NativeM4SiteEntrySchema).min(1),
    FIELD_CALIBRATED_RECOMMENDATION_READY: z.literal(false),
    numeric_optimizer_coupling: z.literal('NONE'),
    M5_started: z.literal(false),
  })
  .passthrough();
