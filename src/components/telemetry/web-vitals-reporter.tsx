'use client';

import { useEffect } from 'react';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

declare global {
  interface Window {
    __ASTRAGRON_WEB_VITALS__?: Record<string, { value: number; rating: string; delta: number; id: string }>;
  }
}

function recordVital(metric: Metric) {
  if (typeof window === 'undefined') return;
  window.__ASTRAGRON_WEB_VITALS__ = window.__ASTRAGRON_WEB_VITALS__ ?? {};
  window.__ASTRAGRON_WEB_VITALS__[metric.name] = {
    value: Number(metric.value.toFixed(4)),
    rating: metric.rating,
    delta: Number(metric.delta.toFixed(4)),
    id: metric.id,
  };
}

export function WebVitalsReporter() {
  useEffect(() => {
    onLCP(recordVital, { reportAllChanges: true });
    onCLS(recordVital, { reportAllChanges: true });
    onFCP(recordVital);
    onINP(recordVital, { reportAllChanges: true });
    onTTFB(recordVital);
  }, []);

  return null;
}
