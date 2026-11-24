'use client';

import { useEffect, useState } from 'react';
import {
  SystemCapabilitiesResponseSchema,
  type SystemCapabilitiesResponse,
} from '@/domain/farmer-ux-contracts';
import { IS_STATIC_SHOWCASE } from '@/lib/base-path';

const DEFAULT_OFFLINE_CAPABILITIES: SystemCapabilitiesResponse = {
  coverageLookup: {
    enabled: true,
    mode: 'OFFLINE_SNAPSHOT',
    reason: 'Local Earth-observation snapshot metadata available.',
  },
  liveFarmAnalysis: {
    enabled: false,
    mode: 'RECORDED_OR_DEMO_ONLY',
    reason: IS_STATIC_SHOWCASE
      ? 'Standalone static showcase uses bundled Wageningen research and local coverage metadata.'
      : 'Checking server capabilities…',
  },
  recordedM14: {
    enabled: true,
    mode: 'VERIFIED_READ_ONLY',
    reason: IS_STATIC_SHOWCASE ? 'Verified read-only research snapshot active.' : 'Checking verified research archive…',
  },
  pdfExport: {
    enabled: true,
    mode: 'CLIENT_PDF',
    reason: 'Client-side PDF report generation ready.',
  },
  reportGroundedChat: {
    enabled: IS_STATIC_SHOWCASE,
    mode: IS_STATIC_SHOWCASE ? 'LOCAL_DETERMINISTIC' : 'NOT_CONNECTED',
    reason: IS_STATIC_SHOWCASE
      ? 'Evidence-grounded Q&A ready on the Wageningen study page.'
      : 'Ask ASTRAGRON is unavailable until a report-grounded assistant backend is connected.',
  },
  cloudFarmStorage: {
    enabled: false,
    mode: 'LOCAL_DEVICE_ONLY',
    reason: 'Farms and reports are saved locally on this device.',
  },
  geocoding: {
    enabled: false,
    mode: 'LOCAL_GAZETTEER_ONLY',
    reason: IS_STATIC_SHOWCASE ? 'Curated 16 research regions ready.' : 'Checking geocoder status…',
  },
  checkedAt: '',
};

export function useSystemCapabilities() {
  const [capabilities, setCapabilities] = useState<SystemCapabilitiesResponse>(
    DEFAULT_OFFLINE_CAPABILITIES
  );
  const [loaded, setLoaded] = useState(IS_STATIC_SHOWCASE);

  useEffect(() => {
    if (IS_STATIC_SHOWCASE) return;
    let cancelled = false;
    const ac = new AbortController();
    const abort = () => {
      cancelled = true;
      ac.abort();
    };
    window.addEventListener('pagehide', abort);
    fetch('/api/capabilities', { cache: 'no-store', signal: ac.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        return res.ok ? data : null;
      })
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = SystemCapabilitiesResponseSchema.safeParse(raw);
        if (parsed.success) {
          setCapabilities(parsed.data);
        }
      })
      .catch(() => {
        // Keep safe offline defaults fail-closed
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      abort();
      window.removeEventListener('pagehide', abort);
    };
  }, []);

  return { capabilities, loaded };
}
