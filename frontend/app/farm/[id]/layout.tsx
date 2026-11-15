import React from 'react';
import { FarmWorkspaceShell } from '@/components/navigation/app-chrome';

export default async function FarmIdLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FarmWorkspaceShell farmId={id}>{children}</FarmWorkspaceShell>;
}
