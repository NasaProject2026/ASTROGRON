import React from 'react';
import { FarmSetupWizardClient } from '@/components/forms/farm-setup-wizard';

export default async function FarmNewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const resolved = await searchParams;
  return <FarmSetupWizardClient initialFarmId={resolved?.from ?? ''} />;
}
