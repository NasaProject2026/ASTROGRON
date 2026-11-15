// D's canonical contract. Values remain research outputs; no yield/profit inference.
export interface CoreQueue {
  status: string;
  analyses_ahead: number;
  queue_position: number | null;
  estimated_start_wait_interval_seconds: { lower: number; upper: number } | null;
  estimation_basis: { status: string; target: 'START'; guaranteed: false };
}

export interface CoreState {
  analysis_id: string;
  farm_id: string;
  state: 'pending' | 'complete_research' | 'partial' | 'blocked' | 'failed';
  phase: string;
  error: string | null;
  report_error: string | null;
  queue?: CoreQueue;
  execution_kind?: string;
  demo_case?: string;
  demo_label?: string;
  scientific_status?: string;
  parent_analysis_id?: string | null;
}

export interface CoreResult {
  status: string;
  farm_id: string;
  run_id: string;
  decision: {
    status?: string;
    pareto_ids: string[];
    selected_ids: string[];
    field_recommendation: unknown;
    horizon_boundary?: string[];
    comparison_excludes?: string;
    objectives?: {
      policy_id: string;
      worst_ET_m3_equivalent?: string;
      worst_regret_m3_equivalent?: string;
      service_all_requested_scenarios?: boolean;
      worst_ET_scenarios?: string[];
      scenarios?: {
        scenario_id: string;
        N_leaching_kg_N_field: number;
        crop_storage_DM_kg_field_by_crop: Record<string, number>;
      }[];
    }[];
  };
  alternatives: {
    policy_id: string;
    choices: Record<string, string[]>;
    important_uncertainty?: string;
    scenarios?: {
      scenario_id: string;
      status?: string;
      ET_shortfall_m3_equivalent?: string;
      source_withdrawal_m3?: string;
      worst_service_deficit_mm?: string;
      service_pass?: boolean;
      harvest_years?: number;
    }[];
  }[];
  qualification: Record<string, unknown>;
  warnings: unknown[];
  missing_requirements: unknown;
  provenance: Record<string, unknown>;
  engine_result: { scientific_result_sha256: string | null };
  report_dto: { limitations: unknown; summary: unknown };
}

export interface CoreChatReply {
  answer?: string;
  text?: string;
  mode?: string;
  reason_code?: string | null;
  scientific_analysis_reference?: string;
  claims?: { evidence_id: string; pointer: string; value: unknown; unit: string | null }[];
  analysis_job?: CoreState;
}
