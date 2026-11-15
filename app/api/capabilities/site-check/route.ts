import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveServerCapabilities } from '@/server/capabilities-service';
import { evaluateSiteCapabilityCheck } from '@/server/capability-overlay-service';

export const dynamic = 'force-dynamic';

const SiteCheckRequestSchema = z.object({
  coordinates: z.tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ]),
  geometry: z.any().nullable().optional(),
  farmId: z.string().max(80).optional(),
  inputRevision: z.string().max(128).optional(),
  isUserModifiedDraft: z.boolean().optional(),
  isUserCreatedDraft: z.boolean().optional(),
});

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

  const parsed = SiteCheckRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: parsed.error.issues[0]?.message ?? 'Invalid coordinates payload.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const g = parsed.data.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined;
  const cleanGeom =
    g && (g.type === 'Polygon' || g.type === 'MultiPolygon') && Array.isArray(g.coordinates)
      ? g
      : null;

  const caps = await resolveServerCapabilities();

  const check = await evaluateSiteCapabilityCheck({
    coordinates: parsed.data.coordinates,
    geometry: cleanGeom,
    farmId: parsed.data.farmId,
    inputRevision: parsed.data.inputRevision,
    isUserModifiedDraft: parsed.data.isUserModifiedDraft,
    isUserCreatedDraft: parsed.data.isUserCreatedDraft,
    backendHealthy: caps.liveFarmAnalysis.enabled,
  });

  return NextResponse.json(
    { ok: true, check },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    }
  );
}
