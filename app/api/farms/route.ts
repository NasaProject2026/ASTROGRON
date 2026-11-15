import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { UserFarmDraft } from '@/domain/contracts';
import {
  deletePersistedFarm,
  listPersistedFarms,
  upsertPersistedFarm,
} from '@/server/persisted-runtime-store';

export const dynamic = 'force-dynamic';

const FarmDraftPersistSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  site: z.object({
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
    crs: z.literal('EPSG:4326'),
    locationLabel: z.string().min(1).max(240),
  }),
  fields: z.array(z.any()),
});

export async function GET(request: NextRequest) {
  const farmId = new URL(request.url).searchParams.get('farmId')?.trim();
  const farms = listPersistedFarms();
  if (farmId) {
    const farm = farms[farmId] ?? null;
    if (!farm) {
      return NextResponse.json(
        { ok: false, reason: 'Farm not found in persisted runtime store.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: true, farm },
      { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }
  return NextResponse.json(
    { ok: true, farms },
    { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
  );
}

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'Request body must be valid JSON.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const candidate =
    raw && typeof raw === 'object' && 'farm' in (raw as Record<string, unknown>)
      ? (raw as { farm: unknown }).farm
      : raw;

  const parsed = FarmDraftPersistSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: parsed.error.issues[0]?.message ?? 'Invalid farm draft payload.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const saved = upsertPersistedFarm(candidate as UserFarmDraft);
  return NextResponse.json(
    { ok: true, farm: saved },
    { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
  );
}

export async function DELETE(request: NextRequest) {
  const farmId = new URL(request.url).searchParams.get('farmId')?.trim() ?? '';
  if (!farmId) {
    return NextResponse.json(
      { ok: false, reason: 'Missing farmId query parameter.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const deleted = deletePersistedFarm(farmId);
  return NextResponse.json(
    { ok: deleted },
    { status: deleted ? 200 : 404, headers: { 'Cache-Control': 'no-store' } }
  );
}
