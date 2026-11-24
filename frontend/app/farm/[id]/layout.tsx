import React from 'react';
import { FarmWorkspaceShell } from '@/components/navigation/app-chrome';

export function generateStaticParams() {
  return [
    { id: 'uppsala-demo' },
    { id: 'nyeri-kenya' },
    { id: 'wagga-australia' },
    { id: 'uppsala-m14' },
  ];
}

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
