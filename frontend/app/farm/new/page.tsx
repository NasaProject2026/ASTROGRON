import React, { Suspense } from 'react';
import { FarmSetupWizardFromQuery } from '@/components/forms/farm-setup-wizard-query';

export default function FarmNewPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl p-8 text-sm text-[#AEC4D3]">Loading guided farm setup…</div>}>
      <FarmSetupWizardFromQuery />
    </Suspense>
  );
}
