'use client';

import React, { useMemo, useState } from 'react';
import {
  MessageSquareText,
  Lock,
  Send,
  BookOpen,
  Trash2,
  Download,
  AlertTriangle,
  Info,
} from 'lucide-react';
import type { UserFarmDraft } from '@/domain/contracts';
import type {
  ChatProxyResponse,
  ReportEnvelope,
  SystemCapabilitiesResponse,
} from '@/domain/farmer-ux-contracts';
import { ChatStorageAdapter } from '@/adapters/storage-adapters';
import { useAstrogron } from '@/hooks/use-astrogron-store';

interface AskAstrogronPanelProps {
  farm: UserFarmDraft;
  report: ReportEnvelope;
  capabilities?: SystemCapabilitiesResponse | null;
  isStale?: boolean;
  compact?: boolean;
}

const PROMPT_CHIPS = [
  {
    id: 'explain',
    label: 'Explain this report',
    guideTitle: 'Summary of this report',
  },
  {
    id: 'missing',
    label: 'What data is missing?',
    guideTitle: 'Data gaps and local requirements',
  },
  {
    id: 'why-no-crop',
    label: "Why isn't there a crop recommendation?",
    guideTitle: 'Why no crop plan is recommended',
  },
  {
    id: 'next',
    label: 'What should I do next?',
    guideTitle: 'Practical next steps',
  },
] as const;

export function AskAstrogronPanel({
  farm,
  report,
  capabilities,
  isStale = false,
  compact = false,
}: AskAstrogronPanelProps) {
  const { chatThreads, appendChatMessage, clearChatThread } = useAstrogron();
  const [question, setQuestion] = useState('');
  const [activeGuideId, setActiveGuideId] = useState<(typeof PROMPT_CHIPS)[number]['id'] | null>(null);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const threadKey = ChatStorageAdapter.buildThreadKey(
    farm.id,
    report.reportId,
    report.inputRevision
  );
  const thread = chatThreads[threadKey];
  const messages = thread?.messages ?? [];

  const chatEnabled = Boolean(capabilities?.reportGroundedChat.enabled);

  const guideItems = useMemo(() => {
    switch (activeGuideId) {
      case 'explain':
        return report.summaryFindings;
      case 'missing':
        return report.whatWeDontKnow;
      case 'why-no-crop':
        return [report.recommendationNotice, ...report.scientificNotes];
      case 'next':
        return report.whatHappensNext;
      default:
        return [];
    }
  }, [activeGuideId, report]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !chatEnabled || sending) return;

    setSending(true);
    setServerError(null);
    const now = new Date().toISOString();
    const convId = thread?.conversationId ?? `conv-${report.reportId}`;

    appendChatMessage(
      {
        farmId: farm.id,
        reportId: report.reportId,
        inputRevision: report.inputRevision,
        evidenceVersion: report.corpusVersion,
      },
      {
        id: `msg-u-${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: now,
      }
    );
    setQuestion('');

    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(report.reportId)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmId: farm.id,
          reportId: report.reportId,
          inputRevision: report.inputRevision,
          evidenceVersion: report.corpusVersion,
          conversationId: convId,
          question: trimmed,
        }),
      });
      const payload = (await res.json()) as ChatProxyResponse;
      if (!res.ok || !payload.ok || !payload.answer) {
        setServerError(payload.reason);
      } else {
        appendChatMessage(
          {
            farmId: farm.id,
            reportId: report.reportId,
            inputRevision: report.inputRevision,
            evidenceVersion: report.corpusVersion,
          },
          {
            id: `msg-a-${Date.now()}`,
            role: 'assistant',
            content: payload.answer,
            createdAt: new Date().toISOString(),
            groundedRefIds: payload.citations,
          }
        );
      }
    } catch {
      setServerError('Network error while contacting the report assistant service.');
    } finally {
      setSending(false);
    }
  };

  const handleExportThread = () => {
    if (!thread) return;
    const blob = new Blob([JSON.stringify(thread, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `astrogron-chat-${farm.id}-${report.reportId.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      data-testid="ask-astrogron-panel"
      aria-label="Ask ASTROGRON report assistant"
      className={`rounded-2xl border border-[#29455A] bg-[#0B1C2D] ${
        compact ? 'p-4' : 'p-5'
      } flex flex-col gap-4`}
    >
      {/* Header & Grounded Context Pill */}
      <div className="space-y-2 border-b border-[#29455A] pb-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#72E4F1]/40 bg-[#102A3F] text-[#72E4F1]">
              <MessageSquareText className="w-4 h-4" />
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-[#F1F7FD]">
                Ask ASTROGRON
              </h2>
              <p className="text-[11px] text-[#90A8BA]">
                Answers strictly grounded to this farm &amp; report
              </p>
            </div>
          </div>
          <span
            data-testid="chat-scope-badge"
            className="rounded-full border border-[#548299]/60 bg-[#071524] px-2.5 py-0.5 font-mono text-[10px] text-[#72E4F1]"
          >
            {farm.id} · {report.inputRevision.slice(0, 11)}
          </span>
        </div>

        {isStale && (
          <div className="flex items-start gap-2 rounded-xl border border-[#FFCE7B]/50 bg-[#252015] px-3 py-2 text-[11px] text-[#FFCE7B]">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Previous analysis: farm inputs have changed since this report ({report.reportId.slice(0, 14)}…).
            </span>
          </div>
        )}
      </div>

      {/* Honest Disabled / Capability Notice when Live Assistant Offline */}
      {!chatEnabled && (
        <div
          data-testid="ask-astrogron-unavailable"
          className="rounded-xl border border-[#548299]/60 bg-[#081523] p-3.5 space-y-2 text-xs"
        >
          <div className="flex items-center gap-2 font-semibold text-[#FFCE7B]">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span>Unavailable until analysis assistant is connected</span>
          </div>
          <p className="text-[#AEC4D3] leading-relaxed">
            {capabilities?.reportGroundedChat.reason ??
              'Interactive AI Q&A requires a live report-grounded backend. ASTROGRON will never fabricate answers or crop advice.'}
          </p>
          <p className="text-[11px] text-[#90A8BA]">
            You can tap any question below to inspect the deterministic{' '}
            <strong className="text-[#F1F7FD]">Non-AI Report Guide</strong> written directly from
            this report&apos;s verified fields.
          </p>
        </div>
      )}

      {/* Quick Grounded Prompt Chips */}
      <div className="space-y-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#90A8BA] block">
          Report Quick Questions
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PROMPT_CHIPS.map((chip) => {
            const active = activeGuideId === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => {
                  if (chatEnabled) {
                    setQuestion(chip.label);
                  } else {
                    setActiveGuideId(active ? null : chip.id);
                  }
                }}
                aria-pressed={!chatEnabled ? active : undefined}
                className={`min-h-[36px] rounded-full border px-3 py-1 text-left text-xs transition cursor-pointer ${
                  active
                    ? 'border-[#72E4F1] bg-[#13324F] text-[#F1F7FD]'
                    : 'border-[#29455A] bg-[#081728] text-[#AEC4D3] hover:border-[#72E4F1]/70 hover:text-[#F1F7FD]'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Deterministic Non-AI Report Guide (Replaces fake chatbot answers transparently) */}
      {!chatEnabled && activeGuideId && (
        <div
          data-testid="ask-astrogron-report-guide"
          className="rounded-xl border border-[#72E4F1]/40 bg-[#071524] p-3.5 space-y-2 text-xs"
        >
          <div className="flex items-center justify-between gap-2 text-[#72E4F1] font-mono text-[10px] uppercase">
            <span className="flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Non-AI Report Guide (From Report Fields)</span>
            </span>
            <button
              type="button"
              onClick={() => setActiveGuideId(null)}
              className="text-[#90A8BA] hover:text-[#F1F7FD] cursor-pointer"
            >
              Close
            </button>
          </div>
          <div className="font-semibold text-[#F1F7FD]">
            {PROMPT_CHIPS.find((c) => c.id === activeGuideId)?.guideTitle}
          </div>
          <ul className="list-disc ps-4 space-y-1 text-[#AEC4D3] leading-relaxed">
            {guideItems.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Existing Scoped Thread Messages (if any from connected session) */}
      {messages.length > 0 && (
        <div className="space-y-2 max-h-[260px] overflow-y-auto pe-1">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-xl border p-3 text-xs ${
                msg.role === 'user'
                  ? 'border-[#548299]/50 bg-[#10263B] text-[#F1F7FD] ms-4'
                  : 'border-[#29455A] bg-[#071524] text-[#AEC4D3] me-4'
              }`}
            >
              <div className="font-mono text-[10px] text-[#90A8BA] mb-1">
                {msg.role === 'user' ? 'You' : 'ASTROGRON'} · {new Date(msg.createdAt).toLocaleTimeString()}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          ))}
        </div>
      )}

      {serverError && (
        <div className="flex items-start gap-2 rounded-xl border border-[#FF9299]/50 bg-[#2C141B] p-3 text-xs text-[#FF9299]">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{serverError}</span>
        </div>
      )}

      {/* Composer Form (Visibly disabled when backend is offline — never mimics typing/fake answers) */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <label htmlFor={`ask-input-${report.reportId}`} className="sr-only">
          Ask a question about this report
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`ask-input-${report.reportId}`}
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={!chatEnabled || sending}
            placeholder={
              chatEnabled
                ? 'Ask a question grounded to this report...'
                : 'Assistant offline — use Report Guide above'
            }
            className="flex-1 min-h-[44px] rounded-xl border border-[#29455A] bg-[#071422] px-3.5 py-2 text-xs text-[#F1F7FD] placeholder:text-[#6E899E] disabled:opacity-60 disabled:cursor-not-allowed focus:border-[#72E4F1] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!chatEnabled || sending || !question.trim()}
            aria-label="Send question"
            className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl bg-[#72E4F1] text-[#081521] transition hover:bg-[#93EDF7] disabled:bg-[#193044] disabled:text-[#6E899E] disabled:cursor-not-allowed cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#90A8BA]">
          <span>Saved locally per report scope</span>
          {messages.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportThread}
                className="inline-flex items-center gap-1 hover:text-[#72E4F1] cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>Export chat</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  clearChatThread(farm.id, report.reportId, report.inputRevision)
                }
                className="inline-flex items-center gap-1 hover:text-[#FF9299] cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      </form>
    </aside>
  );
}
