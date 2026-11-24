'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { FarmSetupWizardClient } from '@/components/forms/farm-setup-wizard';

export function FarmSetupWizardFromQuery() {
  const searchParams = useSearchParams();
  const from = searchParams.get('from') ?? '';
  return <FarmSetupWizardClient initialFarmId={from} />;
}
