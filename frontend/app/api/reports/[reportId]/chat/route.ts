import { NextResponse } from 'next/server';
import { type ChatProxyResponse } from '@/domain/farmer-ux-contracts';
import { handleReportGroundedChatRequest } from '@/server/chat-gateway-service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ reportId: string }> }
) {
  const { reportId } = await context.params;
  const rawBody = await request.json().catch(() => null);
  const callerOwnerId =
    request.headers.get('x-astragron-owner-id') ??
    request.headers.get('x-user-id') ??
    null;
  const callerOwnerToken = request.headers.get('x-astragron-owner-token') ?? null;
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();

  const result = await handleReportGroundedChatRequest({
    urlReportId: reportId,
    rawBody,
    callerOwnerId,
    callerOwnerToken,
    requireSignedOwnerToken: true,
    clientKey: callerOwnerId || forwardedFor || undefined,
  });

  return NextResponse.json<ChatProxyResponse>(result.body, {
    status: result.httpStatus,
  });
}
