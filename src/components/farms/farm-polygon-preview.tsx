'use client';

import React, { useId } from 'react';
import type { UserFarmDraft } from '@/domain/contracts';

interface FarmPolygonPreviewProps {
  farm: UserFarmDraft;
  className?: string;
  animateOrbitalScan?: boolean;
  reducedMotion?: boolean;
}

function extractOuterRings(farm: UserFarmDraft): Array<Array<[number, number]>> {
  const rings: Array<Array<[number, number]>> = [];
  for (const field of farm.fields) {
    const geom = field.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates[0])) {
      rings.push(geom.coordinates[0] as Array<[number, number]>);
    } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
      for (const poly of geom.coordinates) {
        if (Array.isArray(poly[0])) {
          rings.push(poly[0] as Array<[number, number]>);
        }
      }
    }
  }
  return rings;
}

export function FarmPolygonPreview({
  farm,
  className = 'h-24 w-full',
  animateOrbitalScan = false,
  reducedMotion = false,
}: FarmPolygonPreviewProps) {
  const scanGradientId = useId();
  const rings = extractOuterRings(farm);
  const allPts = rings.flat();

  let minX = farm.site.longitude - 0.01;
  let maxX = farm.site.longitude + 0.01;
  let minY = farm.site.latitude - 0.01;
  let maxY = farm.site.latitude + 0.01;

  if (allPts.length > 0) {
    minX = Infinity;
    maxX = -Infinity;
    minY = Infinity;
    maxY = -Infinity;
    for (const [lon, lat] of allPts) {
      if (lon < minX) minX = lon;
      if (lon > maxX) maxX = lon;
      if (lat < minY) minY = lat;
      if (lat > maxY) maxY = lat;
    }
  }

  const spanX = Math.max(maxX - minX, 0.0005);
  const spanY = Math.max(maxY - minY, 0.0005);
  const padX = spanX * 0.18;
  const padY = spanY * 0.18;

  const project = ([lon, lat]: [number, number]): [number, number] => {
    const x = 16 + ((lon - (minX - padX)) / (spanX + padX * 2)) * 168;
    const y = 84 - ((lat - (minY - padY)) / (spanY + padY * 2)) * 68;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  };

  const palette = ['#72E4F1', '#57D9A7', '#91B8FF', '#DCC08A'];

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-[#29455A]/80 bg-[#061220] ${className}`}
    >
      <svg
        viewBox="0 0 200 100"
        role="img"
        aria-label={`Map outline for ${farm.name}`}
        className="h-full w-full block"
      >
        <defs>
          <linearGradient id={scanGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#72E4F1" stopOpacity="0" />
            <stop offset="50%" stopColor="#72E4F1" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#72E4F1" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Subtle latitude/longitude reticle */}
        <line x1="0" y1="25" x2="200" y2="25" stroke="#183249" strokeWidth="0.6" strokeDasharray="3 3" />
        <line x1="0" y1="50" x2="200" y2="50" stroke="#183249" strokeWidth="0.6" strokeDasharray="3 3" />
        <line x1="0" y1="75" x2="200" y2="75" stroke="#183249" strokeWidth="0.6" strokeDasharray="3 3" />
        <line x1="50" y1="0" x2="50" y2="100" stroke="#183249" strokeWidth="0.6" strokeDasharray="3 3" />
        <line x1="100" y1="0" x2="100" y2="100" stroke="#183249" strokeWidth="0.6" strokeDasharray="3 3" />
        <line x1="150" y1="0" x2="150" y2="100" stroke="#183249" strokeWidth="0.6" strokeDasharray="3 3" />

        {rings.length > 0 ? (
          rings.map((ring, idx) => {
            const ptsStr = ring.map((p) => project(p).join(',')).join(' ');
            const stroke = palette[idx % palette.length]!;
            return (
              <polygon
                key={idx}
                points={ptsStr}
                fill={stroke}
                fillOpacity="0.22"
                stroke={stroke}
                strokeWidth="1.6"
              />
            );
          })
        ) : (
          <g>
            <circle cx="100" cy="50" r="14" fill="#72E4F1" fillOpacity="0.14" stroke="#72E4F1" strokeWidth="1.2" />
            <circle cx="100" cy="50" r="4" fill="#72E4F1" />
          </g>
        )}

        {animateOrbitalScan && !reducedMotion && (
          <rect x="0" y="0" width="44" height="100" fill={`url(#${scanGradientId})`}>
            <animateTransform
              attributeName="transform"
              type="translate"
              from="-44 0"
              to="200 0"
              dur="2.8s"
              repeatCount="indefinite"
            />
          </rect>
        )}
      </svg>
    </div>
  );
}
