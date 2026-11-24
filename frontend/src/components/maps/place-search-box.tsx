'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2, MapPin, Navigation, Search, X } from 'lucide-react';
import {
  defaultGeocodingProvider,
  type RemoteGeocodeClientResult,
  type RemoteGeocodePlace,
} from '@/adapters/geocoding-provider';
import { parseDmsCoordinateString } from '@/domain/schemas';

export interface SelectedPlaceCandidate {
  id: string;
  label: string;
  shortName: string;
  countryCode: string;
  region: string;
  coordinates: [number, number]; // [lon, lat]
  bbox?: [number, number, number, number];
  zoomHint?: number;
  attribution?: string;
  source: 'LOCAL_GAZETTEER' | 'REMOTE_GEOCODER' | 'DIRECT_COORDS' | 'BROWSER_GPS';
}

function estimateZoomForCandidate(
  bbox?: [number, number, number, number],
  placeType?: string
): number {
  if (bbox) {
    const spanDeg = Math.max(Math.abs(bbox[2] - bbox[0]), Math.abs(bbox[3] - bbox[1]));
    if (spanDeg <= 0.015) return 15.2;
    if (spanDeg <= 0.08) return 13.8;
    if (spanDeg <= 0.35) return 12.2;
    if (spanDeg <= 1.2) return 10.6;
    return 8.5;
  }
  const t = (placeType ?? '').toLowerCase();
  if (t.includes('house') || t.includes('street') || t.includes('postcode')) return 15.0;
  if (t.includes('village') || t.includes('hamlet') || t.includes('ppl')) return 13.4;
  return 12.6;
}

interface PlaceSearchBoxProps {
  inputId?: string;
  testId?: string;
  placeholder?: string;
  label?: string;
  onSelectPlace: (place: SelectedPlaceCandidate) => void;
  onUseGpsPin?: () => void;
  gpsBusy?: boolean;
  gpsHint?: string | null;
  className?: string;
}

function tryParseCoordinatePair(raw: string): [number, number] | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  // Support "lat, lon" OR "lat lon" when comma-separated decimal pair is pasted from Google/OSM Maps
  const commaParts = cleaned.split(',').map((s) => s.trim()).filter(Boolean);
  if (commaParts.length === 2) {
    const first = parseDmsCoordinateString(commaParts[0]!, 'LAT');
    const second = parseDmsCoordinateString(commaParts[1]!, 'LON');
    if (first.valid && second.valid && first.decimal !== null && second.decimal !== null) {
      return [second.decimal, first.decimal];
    }
  }
  const spaceDms = cleaned.match(/^(.+?[NSns])\s+(.+?[EWew])$/);
  if (spaceDms) {
    const latP = parseDmsCoordinateString(spaceDms[1]!, 'LAT');
    const lonP = parseDmsCoordinateString(spaceDms[2]!, 'LON');
    if (latP.valid && lonP.valid && latP.decimal !== null && lonP.decimal !== null) {
      return [lonP.decimal, latP.decimal];
    }
  }
  return null;
}

export function PlaceSearchBox({
  inputId = 'wizard-place-search',
  testId = 'place-search-input',
  placeholder = 'City, village, address or lat, lon...',
  label = 'Search location, address, or coordinates',
  onSelectPlace,
  onUseGpsPin,
  gpsBusy = false,
  gpsHint,
  className = '',
}: PlaceSearchBoxProps) {
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [remoteState, setRemoteState] = useState<RemoteGeocodeClientResult | null>(null);
  const [searchingRemote, setSearchingRemote] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const directCoord = useMemo(() => tryParseCoordinatePair(query), [query]);

  const localHits = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    return defaultGeocodingProvider.searchLocalGazetteer(q).slice(0, 5);
  }, [query]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || directCoord) {
      abortRef.current?.abort();
      setSearchingRemote(false);
      setRemoteState(null);
      return;
    }

    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    setSearchingRemote(true);

    const timer = setTimeout(async () => {
      const res = await defaultGeocodingProvider.searchRemoteLocations(q, ac.signal);
      if (ac.signal.aborted || res.status === 'ABORTED') return;
      setRemoteState(res);
      setSearchingRemote(false);
      setOpen(true);
    }, 180);

    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [query, directCoord]);

  const combinedCandidates: SelectedPlaceCandidate[] = useMemo(() => {
    const list: SelectedPlaceCandidate[] = [];
    if (directCoord) {
      list.push({
        id: `coords-${directCoord[0]}-${directCoord[1]}`,
        label: `Jump to exact coordinates (${directCoord[1].toFixed(4)}°, ${directCoord[0].toFixed(4)}°)`,
        shortName: `${directCoord[1].toFixed(4)}°, ${directCoord[0].toFixed(4)}°`,
        countryCode: 'CUSTOM',
        region: 'WGS84 Direct Entry',
        coordinates: directCoord,
        zoomHint: 14.5,
        source: 'DIRECT_COORDS',
      });
    }

    const remotePlaces: RemoteGeocodePlace[] = remoteState?.results ?? [];
    for (const rp of remotePlaces) {
      list.push({
        id: rp.id,
        label: rp.label,
        shortName: rp.shortName,
        countryCode: rp.countryCode || rp.country.slice(0, 2).toUpperCase() || 'GLOBAL',
        region: [rp.region, rp.country].filter(Boolean).join(', ') || 'Worldwide Search',
        coordinates: [rp.lon, rp.lat],
        bbox: rp.bbox,
        zoomHint: rp.zoomHint ?? estimateZoomForCandidate(rp.bbox, rp.placeType),
        attribution: rp.attribution ?? remoteState?.attribution,
        source: 'REMOTE_GEOCODER',
      });
    }

    for (const loc of localHits) {
      const dup = list.some(
        (c) => c.label.trim().toLowerCase() === loc.label.trim().toLowerCase()
      );
      if (!dup) {
        list.push({
          id: loc.id,
          label: loc.label,
          shortName: loc.shortName,
          countryCode: loc.countryCode,
          region: loc.region,
          coordinates: loc.coordinates,
          zoomHint: 12.6,
          source: 'LOCAL_GAZETTEER',
        });
      }
    }
    return list;
  }, [directCoord, remoteState, localHits]);

  const commitCandidate = (cand: SelectedPlaceCandidate) => {
    onSelectPlace(cand);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const showDropdown =
    open &&
    (combinedCandidates.length > 0 ||
      searchingRemote ||
      (query.trim().length >= 2 && remoteState !== null));

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={inputId} className="block text-xs font-medium text-[#AEC4D3]">
          {label}
        </label>
        {onUseGpsPin && (
          <button
            type="button"
            data-testid="place-search-gps-btn"
            onClick={onUseGpsPin}
            disabled={gpsBusy}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#548299] bg-[#081728] px-3 py-1.5 text-xs text-[#72E4F1] hover:border-[#72E4F1] disabled:opacity-60 cursor-pointer"
          >
            {gpsBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
            <span>{gpsBusy ? 'Locating GPS…' : 'Use GPS location'}</span>
          </button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-3.5 w-4 h-4 text-[#90A8BA]" />
        <input
          ref={inputRef}
          id={inputId}
          data-testid={testId}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={query}
          onFocus={() => {
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActiveIndex((prev) =>
                combinedCandidates.length ? (prev + 1) % combinedCandidates.length : -1
              );
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((prev) =>
                combinedCandidates.length
                  ? (prev - 1 + combinedCandidates.length) % combinedCandidates.length
                  : -1
              );
            } else if (e.key === 'Enter' && combinedCandidates.length > 0) {
              e.preventDefault();
              const chosen = combinedCandidates[activeIndex >= 0 ? activeIndex : 0];
              if (chosen) commitCandidate(chosen);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className="w-full min-h-[46px] rounded-xl border border-[#29455A] bg-[#081728] pl-10 pr-10 py-2.5 text-sm text-[#F1F7FD] placeholder:text-[#6B859B] focus:border-[#72E4F1] focus:outline-none"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search text"
            onClick={() => {
              setQuery('');
              setRemoteState(null);
              setOpen(false);
            }}
            className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-lg text-[#90A8BA] hover:bg-[#132B3F] hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {gpsHint && (
        <p className="text-xs text-[#72E4F1]" role="status">
          {gpsHint}
        </p>
      )}

      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          data-testid="place-search-results"
          className="rounded-xl border border-[#29455A] bg-[#071524] p-1.5 space-y-1 shadow-xl max-h-64 overflow-y-auto"
        >
          {searchingRemote && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-[#90A8BA]">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#72E4F1]" />
              <span>Searching worldwide locations…</span>
            </div>
          )}

          {combinedCandidates.map((cand, idx) => (
            <button
              key={cand.id}
              type="button"
              role="option"
              aria-label={`${cand.label} — ${cand.region}`}
              aria-selected={activeIndex === idx}
              onClick={() => commitCandidate(cand)}
              className={`flex w-full min-h-[44px] items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition cursor-pointer ${
                activeIndex === idx
                  ? 'bg-[#16344C] text-white'
                  : 'text-[#F1F7FD] hover:bg-[#132B3F]'
              }`}
            >
              <span className="flex items-start gap-2 min-w-0">
                <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#72E4F1]" />
                <span className="min-w-0">
                  <span className="block font-medium truncate">{cand.label}</span>
                  <span className="block text-[10px] text-[#90A8BA]">
                    {cand.source === 'REMOTE_GEOCODER'
                      ? `${cand.region} · ${cand.attribution || 'Worldwide search'}`
                      : cand.source === 'LOCAL_GAZETTEER'
                        ? `${cand.region} · Curated Reference Region`
                        : cand.region}
                  </span>
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[#72E4F1]">
                [{cand.coordinates[1].toFixed(2)}, {cand.coordinates[0].toFixed(2)}]
              </span>
            </button>
          ))}

          {!searchingRemote && combinedCandidates.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-[#AEC4D3]">
              {remoteState?.status === 'GEOCODER_NOT_CONFIGURED'
                ? 'Showing curated research localities (16 regions). Enter coordinates like "51.97, 5.67" or tap the globe.'
                : remoteState?.notice || 'No matching towns or regions found. Try pasting lat, lon coordinates or click the map.'}
            </div>
          )}

          {!searchingRemote &&
            remoteState &&
            (remoteState.status !== 'OK' || remoteState.providerTier === 'NON_COMMERCIAL_OR_COMMUNITY') &&
            combinedCandidates.length > 0 && (
              <div className="border-t border-[#1D3549] px-3 py-1.5 text-[10px] text-[#90A8BA]">
                {remoteState.status === 'GEOCODER_NOT_CONFIGURED'
                  ? '16 curated research localities ready · or enter any lat, lon coordinates.'
                  : remoteState.attribution
                    ? `Source: ${remoteState.attribution}.`
                    : remoteState.notice}
              </div>
            )}
        </div>
      )}
    </div>
  );
}
