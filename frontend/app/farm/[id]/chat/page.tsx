'use client';

import React, { use, useMemo } from 'react';
import Link from 'next/link';
import { FailClosedStatusCard } from '@/components/design-system/primitives';
import { AskAstragronPanel } from '@/components/chat/ask-astragron-panel';
import { buildReportEnvelopeFromEvaluation } from '@/adapters/storage-adapters';
import { useSystemCapabilities } from '@/lib/capabilities-client';
import { useAstragron } from '@/hooks/use-astragron-store';

export default function FarmChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    getFarmDraft,
    repository,
    datasetMode,
    getReportsForFarm,
    isReportStale,
  } = useAstragron();
  const { capabilities } = useSystemCapabilities();

  const draft = getFarmDraft(id);
  const siteEnv = repository.getSiteCoverageContext(id, draft);

  const report = useMemo(() => {
    if (!draft) return null;
    const saved = getReportsForFarm(id);
    if (saved.length > 0) return saved[0]!;
    return buildReportEnvelopeFromEvaluation({
      farm: draft,
      repository,
      datasetMode,
      jobId: 'chat-context',
    });
  }, [draft, getReportsForFarm, id, repository, datasetMode]);

  if (!draft || siteEnv.status === 'SITE_NOT_FOUND' || !report) {
    return (
      <FailClosedStatusCard
        status="SITE_NOT_FOUND"
        statusReason={siteEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Ask ASTRAGRON"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-[#F1F7FD]">
            Ask ASTRAGRON about {draft.name}
          </h2>
          <p className="text-xs text-[#AEC4D3]">
            Questions and report explanations are scoped strictly to this farm&apos;s current snapshot.
          </p>
        </div>
        <Link
          href={`/farm/${id}/results`}
          className="inline-flex min-h-[40px] items-center rounded-full border border-[#548299] bg-[#081728] px-4 text-xs font-medium text-[#72E4F1] hover:border-[#72E4F1]"
        >
          Open Full Report
        </Link>
      </div>

      <AskAstragronPanel
        farm={draft}
        report={report}
        capabilities={capabilities}
        isStale={isReportStale(report)}
      />
    </div>
  );
}
