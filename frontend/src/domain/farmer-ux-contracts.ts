import { z } from 'zod';
import {
  DatasetOperatingModeSchema,
  RepositoryStatusCodeSchema,
} from './schemas';
import type {
  DatasetOperatingMode,
  RepositoryStatusCode,
  UserFarmDraft,
} from './contracts';

export const CapabilityItemSchema = z.object({
  enabled: z.boolean(),
  mode: z.string().min(1),
  reason: z.string().min(1),
});

export const SystemCapabilitiesResponseSchema = z.object({
  coverageLookup: CapabilityItemSchema,
  liveFarmAnalysis: CapabilityItemSchema,
  recordedM14: CapabilityItemSchema,
  pdfExport: CapabilityItemSchema,
  reportGroundedChat: CapabilityItemSchema,
  cloudFarmStorage: CapabilityItemSchema,
  geocoding: CapabilityItemSchema,
  checkedAt: z.string().min(1),
});

export type SystemCapabilitiesResponse = z.infer<typeof SystemCapabilitiesResponseSchema>;

export const AnalysisStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED_VERIFIED',
  'COMPLETED_LIMITED',
  'ABSTAINED',
  'FAILED',
  'CANCELLED',
  'UNAVAILABLE',
]);

export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export interface AnalysisJobRecord {
  jobId: string;
  farmId: string;
  inputRevision: string;
  datasetMode: DatasetOperatingMode;
  status: AnalysisStatus;
  progressMode: 'INDETERMINATE' | 'STAGE_DISCRETE';
  stageIndex: number;
  stageTotal: number;
  currentStage: string;
  message: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  reportId: string | null;
  failClosedStatus: RepositoryStatusCode | null;
  errorDetail: string | null;
  reportEnvelope?: ReportEnvelope;
  adaptiveSummary?: Record<string, unknown>;
}

export type ReportDataAvailabilityClass =
  | 'VERIFIED_RECORDED_CORPUS'
  | 'SYNTHETIC_DEMO_CORPUS'
  | 'COVERAGE_ONLY'
  | 'MODIFIED_DRAFT_LIMITED'
  | 'OUT_OF_COVERAGE';

export interface ReportChartDatum {
  label: string;
  value: number | null;
  unit: string;
  statusTag?: string;
}

export const ReportEnvelopeSchema = z.object({
  reportId: z.string().min(1),
  farmId: z.string().min(1),
  farmName: z.string().min(1),
  locationLabel: z.string().min(1),
  coordinates: z.tuple([z.number().finite(), z.number().finite()]),
  totalAreaHa: z.number().finite().nonnegative().nullable(),
  fieldCount: z.number().int().nonnegative(),
  inputRevision: z.string().min(1),
  corpusVersion: z.string().min(1),
  datasetMode: DatasetOperatingModeSchema,
  analysisJobId: z.string().min(1),
  createdAt: z.string().min(1),
  dataAvailabilityClass: z.enum([
    'VERIFIED_RECORDED_CORPUS',
    'SYNTHETIC_DEMO_CORPUS',
    'COVERAGE_ONLY',
    'MODIFIED_DRAFT_LIMITED',
    'OUT_OF_COVERAGE',
  ]),
  headlineStatus: z.string().min(1),
  recommendationNotice: z.string().min(1),
  summaryFindings: z.array(z.string()),
  whatWeKnow: z.array(z.string()),
  whatWeDontKnow: z.array(z.string()),
  whatHappensNext: z.array(z.string()),
  sourceCoveragesSummary: z.array(
    z.object({
      sourceId: z.string(),
      title: z.string(),
      status: z.string(),
      coverageKind: z.string(),
      resolution: z.string(),
    })
  ),
  waterBalanceChart: z.array(
    z.object({
      label: z.string(),
      value: z.number().finite().nullable(),
      unit: z.string(),
      statusTag: z.string().optional(),
    })
  ),
  sourceReadinessChart: z.array(
    z.object({
      label: z.string(),
      value: z.number().finite().nullable(),
      unit: z.string(),
      statusTag: z.string().optional(),
    })
  ),
  scientificNotes: z.array(z.string()),
  fieldGeometries: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        geometry: z.any().nullable(),
        geometrySource: z.string().nullable().optional(),
        areaHa: z.number().finite().nonnegative().nullable().optional(),
        perimeterMeters: z.number().finite().nonnegative().nullable().optional(),
      })
    )
    .optional(),
  provenanceFooter: z.string().min(1),
  contentHash: z.string().min(8),
});

export type ReportEnvelope = z.infer<typeof ReportEnvelopeSchema>;

export const ChatMessageRecordSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system_notice']),
  content: z.string().min(1),
  createdAt: z.string().min(1),
  groundedRefIds: z.array(z.string()).optional(),
});

export type ChatMessageRecord = z.infer<typeof ChatMessageRecordSchema>;

export const ChatThreadRecordSchema = z.object({
  conversationId: z.string().min(1),
  farmId: z.string().min(1),
  reportId: z.string().min(1),
  inputRevision: z.string().min(1),
  evidenceVersion: z.string().min(1),
  updatedAt: z.string().min(1),
  messages: z.array(ChatMessageRecordSchema),
});

export type ChatThreadRecord = z.infer<typeof ChatThreadRecordSchema>;

export const ChatProxyRequestSchema = z.object({
  farmId: z.string().min(1).max(80),
  reportId: z.string().min(1).max(120),
  inputRevision: z.string().min(1).max(120),
  evidenceVersion: z.string().min(1).max(120),
  conversationId: z.string().min(1).max(120),
  question: z.string().trim().min(1).max(1500),
});

export type ChatProxyRequest = z.infer<typeof ChatProxyRequestSchema>;

export interface ChatProxyResponse {
  ok: boolean;
  status: 'OK' | 'CHAT_NOT_CONNECTED' | 'REPORT_CONTEXT_MISMATCH' | 'INVALID_REQUEST';
  answer: string | null;
  citations: string[];
  reason: string;
}

export const FarmBackupBundleSchema = z.object({
  schemaVersion: z.literal('astragron.farm-backup.v1'),
  exportedAt: z.string().min(1),
  archivedFarmIds: z.array(z.string()),
  farms: z.record(z.string(), z.unknown()),
  reports: z.array(ReportEnvelopeSchema),
  checksum: z.string().regex(/^[a-f0-9]{16}$/),
});

export interface FarmBackupBundle {
  schemaVersion: 'astragron.farm-backup.v1';
  exportedAt: string;
  archivedFarmIds: string[];
  farms: Record<string, UserFarmDraft>;
  reports: ReportEnvelope[];
  checksum: string;
}

export const AnalysisJobTriggerRequestSchema = z.object({
  farmId: z.string().min(1).max(80),
  inputRevision: z.string().min(1).max(120),
  datasetMode: DatasetOperatingModeSchema.default('RECORDED_M14_RESEARCH'),
  coordinates: z.tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ]),
  fieldCount: z.number().int().min(0).max(100),
  inputsModified: z.boolean().optional(),
  isUserCreatedDraft: z.boolean().optional(),
  farmName: z.string().min(1).max(160).optional(),
  locationLabel: z.string().min(1).max(200).optional(),
  totalAreaHa: z.number().finite().nonnegative().nullable().optional(),
  fields: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        label: z.string().min(1).max(120).optional(),
        declaredAreaHa: z.number().finite().nonnegative().nullable().optional(),
        geometry: z.any().nullable().optional(),
        geometrySource: z.string().nullable().optional(),
        perimeterMeters: z.number().finite().nonnegative().nullable().optional(),
        candidateCrops: z.array(z.string().min(1).max(80)).max(20).optional(),
        irrigationAccess: z.boolean().optional(),
      })
    )
    .max(100)
    .optional(),
  acquisitionMode: z.enum(['CACHE_ONLY', 'FETCH_ALLOWED']).optional(),
});

export type AnalysisJobTriggerRequest = z.infer<typeof AnalysisJobTriggerRequestSchema>;
export type FailClosedStatusType = z.infer<typeof RepositoryStatusCodeSchema>;
