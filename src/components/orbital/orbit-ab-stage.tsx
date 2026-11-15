'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export type OrbitAbStatus =
  | 'INITIALIZING'
  | 'WEBGL_ACTIVE'
  | 'FALLBACK_REDUCED_MOTION'
  | 'FALLBACK_SAVE_DATA'
  | 'FALLBACK_WEBGL_UNAVAILABLE'
  | 'FALLBACK_CONTEXT_LOST'
  | 'FALLBACK_FORCED';

interface OrbitAbMetrics {
  fps: number;
  p95FrameMs: number;
  droppedFrames: number;
  satNdcX: number;
  satNdcY: number;
  satOccluded: boolean;
  landsatLoaded: boolean;
}

const EARTH_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const EARTH_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform sampler2D uPackedMap;
  uniform vec3 uSunDirection;
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPosition);
    vec3 L = normalize(uSunDirection);

    // Sample equirectangular day, Black Marble night, and R=bump / G=roughness / B=clouds
    vec3 dayColor = texture2D(uDayMap, vUv).rgb;
    vec3 nightColor = texture2D(uNightMap, vUv).rgb;
    vec3 packedSample = texture2D(uPackedMap, vUv).rgb;

    // Subtle multi-tap micro-sharpen so coastlines remain crisp at close LEO horizon arc
    vec2 texel = vec2(1.0 / 4096.0, 1.0 / 2048.0);
    vec3 dayAvg = (
      texture2D(uDayMap, vUv + vec2(texel.x, 0.0)).rgb +
      texture2D(uDayMap, vUv - vec2(texel.x, 0.0)).rgb +
      texture2D(uDayMap, vUv + vec2(0.0, texel.y)).rgb +
      texture2D(uDayMap, vUv - vec2(0.0, texel.y)).rgb
    ) * 0.25;
    dayColor = clamp(dayColor + (dayColor - dayAvg) * 0.85, 0.0, 1.0);

    float roughness = clamp(packedSample.g, 0.08, 1.0);
    float oceanMask = 1.0 - smoothstep(0.24, 0.56, roughness);
    vec2 uvCloud = vec2(fract(vUv.x + uTime * 0.0014), vUv.y);
    float cloudShadow = texture2D(uPackedMap, uvCloud - vec2(0.0007, 0.0005)).b;

    // Universal finite-difference normal perturbation (works identically across ANGLE/SwiftShader/GPU)
    float hX = texture2D(uPackedMap, vUv + vec2(texel.x, 0.0)).r - texture2D(uPackedMap, vUv - vec2(texel.x, 0.0)).r;
    float hY = texture2D(uPackedMap, vUv + vec2(0.0, texel.y)).r - texture2D(uPackedMap, vUv - vec2(0.0, texel.y)).r;
    vec3 upHint = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(upHint, N));
    vec3 B = cross(N, T);
    vec3 perturbedN = normalize(N - (T * hX + B * hY) * 2.8);

    float ndlSmooth = dot(N, L);
    float ndlRelief = dot(perturbedN, L);

    // Solar illumination factor & warm Rayleigh twilight scatter right on terminator
    float dayMask = smoothstep(-0.07, 0.14, ndlSmooth);
    float diffuseRelief = max(ndlRelief, 0.0);
    float twilightBand = smoothstep(-0.18, 0.01, ndlSmooth) * (1.0 - smoothstep(0.01, 0.20, ndlSmooth));

    // Specular Blinn-Phong ocean glint strictly masked away from continents & clouds
    vec3 H = normalize(L + V);
    float specPow = mix(16.0, 92.0, oceanMask);
    float specBase = pow(max(dot(perturbedN, H), 0.0), specPow);
    float specular = specBase * oceanMask * 0.62 * smoothstep(0.0, 0.25, ndlSmooth);

    // Deep bathymetry / coastal ocean richness + ground relief + soft cloud-deck ambient occlusion
    vec3 enrichedDay = mix(dayColor, dayColor * vec3(0.86, 0.99, 1.08), oceanMask * 0.24);
    vec3 sunTint = vec3(1.05, 1.01, 0.96);
    vec3 litSurface = enrichedDay * (diffuseRelief * sunTint + 0.06) * (1.0 - cloudShadow * 0.28);
    litSurface += vec3(0.92, 0.97, 1.04) * specular * (1.0 - cloudShadow * 0.85);
    litSurface += vec3(1.0, 0.56, 0.28) * twilightBand * 0.12 * (1.0 - cloudShadow * 0.45);

    // Night hemisphere: deep earthshine + Black Marble city glow masked under thick clouds
    vec3 nightLit = vec3(0.008, 0.016, 0.032) + nightColor * vec3(1.22, 0.88, 0.52) * (1.0 - cloudShadow * 0.62) * 1.25;

    // Combine day & night smoothly across terminator
    vec3 color = mix(nightLit, litSurface, dayMask);

    // Crisp orbital horizon atmospheric Fresnel haze
    float ndv = max(dot(N, V), 0.0);
    float fresnel = pow(1.0 - ndv, 3.6);
    float innerAirglow = pow(1.0 - ndv, 7.5);
    float sunFresnel = smoothstep(-0.20, 0.35, ndlSmooth);
    color += vec3(0.24, 0.66, 1.0) * fresnel * (0.28 + 0.82 * sunFresnel);
    color += vec3(0.56, 0.88, 1.0) * innerAirglow * (0.16 + 0.68 * sunFresnel);
    color += vec3(0.98, 0.48, 0.24) * twilightBand * fresnel * 0.38;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const CLOUD_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const CLOUD_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uPackedMap;
  uniform vec3 uSunDirection;
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPosition);
    vec3 L = normalize(uSunDirection);

    vec2 uvCloud = vec2(fract(vUv.x + uTime * 0.0014), vUv.y);
    float cloud = texture2D(uPackedMap, uvCloud).b;
    float alpha = smoothstep(0.14, 0.88, cloud) * 0.88;
    if (alpha < 0.02) discard;

    float ndl = dot(N, L);
    float lit = smoothstep(-0.14, 0.28, ndl);
    float twilight = smoothstep(-0.18, 0.02, ndl) * (1.0 - smoothstep(0.02, 0.22, ndl));
    float limbFade = mix(0.65, 1.15, pow(1.0 - max(dot(N, V), 0.0), 1.8));

    vec3 dayCloud = vec3(0.96, 0.99, 1.04) * (0.22 + 0.82 * max(ndl, 0.0));
    vec3 nightCloud = vec3(0.03, 0.07, 0.14);
    vec3 col = mix(nightCloud, dayCloud, lit);
    col += vec3(1.0, 0.60, 0.34) * twilight * 0.30;

    gl_FragColor = vec4(col * limbFade, alpha * mix(0.28, 0.94, lit));
  }
`;

const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uSunDirection;
  uniform float uIntensity;
  uniform float uPower;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(cameraPosition - vWorldPosition);
    vec3 L = normalize(uSunDirection);

    float rim = max(0.0, 0.64 - dot(N, V));
    float halo = pow(rim, uPower) * uIntensity;
    float sunFactor = smoothstep(-0.34, 0.36, dot(N, L));

    vec3 dayGlow = vec3(0.30, 0.80, 1.0);
    vec3 twilightGlow = vec3(0.95, 0.56, 0.32);
    float twilightMix = smoothstep(-0.22, 0.02, dot(N, L)) * (1.0 - smoothstep(0.02, 0.25, dot(N, L)));
    vec3 glowColor = mix(dayGlow, twilightGlow, twilightMix * 0.32);

    gl_FragColor = vec4(glowColor, clamp(halo * (0.20 + 0.80 * sunFactor), 0.0, 0.92));
  }
`;

export function OrbitAbStage({
  reducedMotion = false,
  forceFallback = false,
  onMetricsUpdate,
  onStatusChange,
  interactiveMode = false,
}: {
  reducedMotion?: boolean;
  forceFallback?: boolean;
  onMetricsUpdate?: (metrics: OrbitAbMetrics) => void;
  onStatusChange?: (status: OrbitAbStatus) => void;
  interactiveMode?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inViewRef = useRef<boolean>(true);
  const [status, setStatus] = useState<OrbitAbStatus>('INITIALIZING');
  const [webglReady, setWebglReady] = useState<boolean>(false);
  const [metrics, setMetrics] = useState<OrbitAbMetrics>({
    fps: 0,
    p95FrameMs: 0,
    droppedFrames: 0,
    satNdcX: 0.48,
    satNdcY: 0.34,
    satOccluded: false,
    landsatLoaded: false,
  });

  const statusCallbackRef = useRef(onStatusChange);
  const metricsCallbackRef = useRef(onMetricsUpdate);
  useEffect(() => {
    statusCallbackRef.current = onStatusChange;
    metricsCallbackRef.current = onMetricsUpdate;
  }, [onStatusChange, onMetricsUpdate]);

  const updateStatus = (next: OrbitAbStatus) => {
    setStatus(next);
    statusCallbackRef.current?.(next);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]) {
          inViewRef.current = entries[0].isIntersecting;
        }
      },
      { threshold: 0.05 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (forceFallback) {
      setWebglReady(false);
      updateStatus('FALLBACK_FORCED');
      return;
    }

    const navConnection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (navConnection?.saveData) {
      setWebglReady(false);
      updateStatus('FALLBACK_SAVE_DATA');
      return;
    }

    const mediaReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || mediaReduced) {
      setWebglReady(false);
      updateStatus('FALLBACK_REDUCED_MOTION');
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      setWebglReady(false);
      updateStatus('FALLBACK_WEBGL_UNAVAILABLE');
      return;
    }

    let disposed = false;
    let rafId = 0;
    let firstFramePainted = false;
    let webglReadyMarked = false;
    let texturesLoaded = 0;
    const disposables: Array<{ dispose: () => void }> = [];

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    let viewWidth = Math.max(container.clientWidth || window.innerWidth, 320);
    let viewHeight = Math.max(container.clientHeight || window.innerHeight, 320);
    renderer.setSize(viewWidth, viewHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.setAttribute('aria-hidden', 'true');
    container.innerHTML = '';
    container.appendChild(canvas);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglReady(false);
      updateStatus('FALLBACK_CONTEXT_LOST');
    };
    canvas.addEventListener('webglcontextlost', handleContextLost, false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#02050B');

    const camera = new THREE.PerspectiveCamera(38, viewWidth / viewHeight, 0.1, 120);
    const sunDir = new THREE.Vector3(-0.74, 0.36, 0.56).normalize();

    // Multi-source realistic orbital lighting for Landsat 8 spacecraft
    const sunLight = new THREE.DirectionalLight('#fff7eb', 3.4);
    sunLight.position.copy(sunDir).multiplyScalar(14);
    scene.add(sunLight);

    const earthShine = new THREE.HemisphereLight('#7ce7f5', '#06101c', 1.1);
    scene.add(earthShine);

    const limbBounceLight = new THREE.DirectionalLight('#4cb4ff', 1.35);
    limbBounceLight.position.set(2.5, -5.0, 2.5);
    scene.add(limbBounceLight);

    // Procedural Space + Earthshine IBL environment map so metallic Landsat foil & composite hardware glisten realistically
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envCanvas = document.createElement('canvas');
    envCanvas.width = 128;
    envCanvas.height = 64;
    const envCtx = envCanvas.getContext('2d');
    let envRT: THREE.WebGLRenderTarget | null = null;
    if (envCtx) {
      const grad = envCtx.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0.0, '#071122');
      grad.addColorStop(0.38, '#1a2f4d');
      grad.addColorStop(0.55, '#68b9e8');
      grad.addColorStop(0.75, '#4682b4');
      grad.addColorStop(1.0, '#091526');
      envCtx.fillStyle = grad;
      envCtx.fillRect(0, 0, 128, 64);
      // Bright solar key spot
      const sunGrad = envCtx.createRadialGradient(26, 20, 1, 26, 20, 16);
      sunGrad.addColorStop(0, 'rgba(255, 248, 230, 1.0)');
      sunGrad.addColorStop(1, 'rgba(255, 248, 230, 0.0)');
      envCtx.fillStyle = sunGrad;
      envCtx.fillRect(0, 0, 64, 48);

      const envTex = new THREE.CanvasTexture(envCanvas);
      envTex.mapping = THREE.EquirectangularReflectionMapping;
      envTex.colorSpace = THREE.SRGBColorSpace;
      envRT = pmrem.fromEquirectangular(envTex);
      scene.environment = envRT.texture;
      envTex.dispose();
    }
    pmrem.dispose();
    if (envRT) disposables.push(envRT);

    // Subtle deep-space starfield (crisp sub-pixel points)
    const starCount = 900;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 34 + Math.random() * 28;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: '#dceaff',
      size: 0.085,
      transparent: true,
      opacity: 0.72,
      sizeAttenuation: true,
    });
    const stars = new THREE.Points(starGeom, starMat);
    scene.add(stars);
    disposables.push(starGeom, starMat);

    // Textures (NASA Blue Marble + Black Marble + Packed Bump/Roughness/Clouds)
    const texLoader = new THREE.TextureLoader();
    const maxAniso = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

    const onTextureReady = () => {
      texturesLoaded += 1;
      if (!disposed && texturesLoaded >= 3 && firstFramePainted) {
        setWebglReady(true);
      }
    };

    const dayTex = texLoader.load('/orbit-ab-assets/earth_day_4096.jpg', onTextureReady, undefined, onTextureReady);
    dayTex.colorSpace = THREE.SRGBColorSpace;
    dayTex.wrapS = THREE.RepeatWrapping;
    dayTex.anisotropy = maxAniso;

    const nightTex = texLoader.load('/orbit-ab-assets/earth_night_4096.jpg', onTextureReady, undefined, onTextureReady);
    nightTex.colorSpace = THREE.SRGBColorSpace;
    nightTex.wrapS = THREE.RepeatWrapping;
    nightTex.anisotropy = maxAniso;

    const packedTex = texLoader.load(
      '/orbit-ab-assets/earth_bump_roughness_clouds_4096.jpg',
      onTextureReady,
      undefined,
      onTextureReady
    );
    packedTex.colorSpace = THREE.NoColorSpace;
    packedTex.wrapS = THREE.RepeatWrapping;
    packedTex.anisotropy = maxAniso;

    disposables.push(dayTex, nightTex, packedTex);

    // Large Sweeping Low-Earth-Orbit Horizon Planet (earthRadius = 3.65 keeps micro-coastlines razor sharp)
    const earthRadius = 3.65;
    const earthSystem = new THREE.Group();
    scene.add(earthSystem);

    const earthUniforms = {
      uDayMap: { value: dayTex },
      uNightMap: { value: nightTex },
      uPackedMap: { value: packedTex },
      uSunDirection: { value: sunDir },
      uTime: { value: 0 },
    };

    const earthGeom = new THREE.SphereGeometry(earthRadius, 64, 64);
    const earthMat = new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: EARTH_VERTEX_SHADER,
      fragmentShader: EARTH_FRAGMENT_SHADER,
      depthWrite: true,
      depthTest: true,
    });
    const earthMesh = new THREE.Mesh(earthGeom, earthMat);
    earthMesh.rotation.z = THREE.MathUtils.degToRad(22.5);
    earthMesh.rotation.y = -1.78; // Sunlit Mediterranean, Levant, Red Sea & East Sahara crescent arc
    earthSystem.add(earthMesh);
    disposables.push(earthGeom, earthMat);

    // Independent Translucent Volumetric Cloud Layer for genuine 3D orbital parallax
    const cloudGeom = new THREE.SphereGeometry(earthRadius * 1.0085, 52, 52);
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uPackedMap: { value: packedTex },
        uSunDirection: { value: sunDir },
        uTime: { value: 0 },
      },
      vertexShader: CLOUD_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    const cloudMesh = new THREE.Mesh(cloudGeom, cloudMat);
    cloudMesh.rotation.copy(earthMesh.rotation);
    earthSystem.add(cloudMesh);
    disposables.push(cloudGeom, cloudMat);

    // Two-Stage Rayleigh Atmospheric Scattering Horizon Halo
    const atmoInnerGeom = new THREE.SphereGeometry(earthRadius * 1.028, 72, 72);
    const atmoInnerMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDirection: { value: sunDir },
        uIntensity: { value: 1.55 },
        uPower: { value: 3.4 },
      },
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const atmoInnerMesh = new THREE.Mesh(atmoInnerGeom, atmoInnerMat);
    earthSystem.add(atmoInnerMesh);
    disposables.push(atmoInnerGeom, atmoInnerMat);

    const atmoOuterGeom = new THREE.SphereGeometry(earthRadius * 1.064, 64, 64);
    const atmoOuterMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDirection: { value: sunDir },
        uIntensity: { value: 0.72 },
        uPower: { value: 2.5 },
      },
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const atmoOuterMesh = new THREE.Mesh(atmoOuterGeom, atmoOuterMat);
    earthSystem.add(atmoOuterMesh);
    disposables.push(atmoOuterGeom, atmoOuterMat);

    // Independent Moving Satellite Container positioned in bounded upper-right / open cosmic corridor
    const satAnchor = new THREE.Group();
    scene.add(satAnchor);

    const satPivot = new THREE.Group();
    satAnchor.add(satPivot);

    // High-contrast fallback placeholder bus + solar wings matching normalized 0.56 world-unit spacecraft scale
    const placeholderSat = new THREE.Group();
    const busGeom = new THREE.BoxGeometry(0.11, 0.08, 0.14);
    const busMat = new THREE.MeshStandardMaterial({
      color: '#dfb24a',
      metalness: 0.9,
      roughness: 0.2,
    });
    const wingGeom = new THREE.BoxGeometry(0.46, 0.008, 0.12);
    const wingMat = new THREE.MeshStandardMaterial({
      color: '#194d8c',
      metalness: 0.72,
      roughness: 0.24,
    });
    const busMesh = new THREE.Mesh(busGeom, busMat);
    const wingMesh = new THREE.Mesh(wingGeom, wingMat);
    placeholderSat.add(busMesh, wingMesh);
    satPivot.add(placeholderSat);
    disposables.push(busGeom, busMat, wingGeom, wingMat);

    let landsatLoaded = false;
    let activeCraft: THREE.Object3D = placeholderSat;

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/orbit-ab-assets/draco/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(
      '/orbit-ab-assets/landsat_8.glb',
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxAxisDim = Math.max(size.x, size.y, size.z, 0.001);

        // Center GLB at its true geometric centroid so orbital attitude & NDC stay exact
        const modelPivot = new THREE.Group();
        model.position.copy(center).multiplyScalar(-1);
        modelPivot.add(model);

        // Normalize longest tip-to-tip dimension to 0.58 world units (~20-24% hero height on desktop)
        const targetSpan = 0.58;
        modelPivot.scale.setScalar(targetSpan / maxAxisDim);

        model.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
            if (mat && 'envMapIntensity' in mat) {
              mat.envMapIntensity = 1.45;
              mat.needsUpdate = true;
            }
          }
        });
        satPivot.remove(placeholderSat);
        satPivot.add(modelPivot);
        activeCraft = modelPivot;
        landsatLoaded = true;
      },
      undefined,
      () => {
        // Fallback placeholder craft already mounted
      }
    );

    const applyResponsiveFraming = (w: number, h: number) => {
      viewWidth = w;
      viewHeight = h;
      const aspect = w / h;
      camera.aspect = aspect;

      if (w < 768) {
        // Portrait & compact phone: curved Earth horizon lower third, open space window for compact Landsat pass
        camera.fov = 46;
        camera.position.set(0, 0.08, 6.8);
        earthSystem.position.set(0.55, -3.75, 0);
      } else if (aspect < 1.0) {
        // Portrait Tablet (e.g., 820x1180): sweeping curved horizon lower-right, spacious upper-right sky
        camera.fov = 43;
        camera.position.set(0, 0.08, 5.85);
        earthSystem.position.set(1.05, -3.15, 0);
      } else if (w < 1200) {
        // Landscape laptop/tablet (1024..1180)
        camera.fov = 40;
        camera.position.set(0, 0.06, 5.45);
        earthSystem.position.set(2.15, -2.58, 0);
      } else {
        // Widescreen Desktop (1200..1920): large planetary curvature lower-right, generous dark contrast behind left headline
        camera.fov = 38;
        camera.position.set(0, 0.06, 5.35);
        earthSystem.position.set(2.38, -2.62, 0);
      }
      camera.updateProjectionMatrix();
    };

    applyResponsiveFraming(viewWidth, viewHeight);

    const resizeObserver = new ResizeObserver(() => {
      if (!renderer || disposed) return;
      const nw = Math.max(container.clientWidth || window.innerWidth, 320);
      const nh = Math.max(container.clientHeight || window.innerHeight, 320);
      renderer.setSize(nw, nh, false);
      applyResponsiveFraming(nw, nh);
    });
    resizeObserver.observe(container);

    updateStatus('WEBGL_ACTIVE');

    // Frame timing & screen-space corridor telemetry
    const frameTimes: number[] = [];
    let droppedFrames = 0;
    let lastTs = performance.now();
    let elapsed = 0;
    let metricReportCounter = 0;
    let pointerOffsetX = 0;
    let pointerOffsetY = 0;

    const handlePointerMove = (e: MouseEvent) => {
      if (!interactiveMode) return;
      pointerOffsetX = (e.clientX / Math.max(window.innerWidth, 1) - 0.5) * 0.14;
      pointerOffsetY = (e.clientY / Math.max(window.innerHeight, 1) - 0.5) * 0.1;
    };
    if (interactiveMode && typeof window !== 'undefined') {
      window.addEventListener('mousemove', handlePointerMove, { passive: true });
    }

    const satWorld = new THREE.Vector3();
    const earthCenterWorld = new THREE.Vector3();
    const camToEarth = new THREE.Vector3();
    const camToSat = new THREE.Vector3();
    const satNdc = new THREE.Vector3();

    const tick = (now: number) => {
      if (disposed) return;
      rafId = window.requestAnimationFrame(tick);

      if (document.hidden || !inViewRef.current) {
        lastTs = now;
        return;
      }

      const rawDt = now - lastTs;
      lastTs = now;
      const clampedDtSec = Math.min(rawDt / 1000, 0.1);
      elapsed += clampedDtSec;

      if (rawDt > 0 && rawDt < 500) {
        frameTimes.push(rawDt);
        if (frameTimes.length > 90) frameTimes.shift();
        if (rawDt > 33.4) droppedFrames++;
      }

      // Independent motion 1: Earth sidereal spin + independent atmospheric cloud drift
      earthMesh.rotation.y += clampedDtSec * 0.014;
      cloudMesh.rotation.y += clampedDtSec * 0.019;
      stars.rotation.y += clampedDtSec * 0.002;
      earthUniforms.uTime.value = elapsed;
      if (cloudMat.uniforms.uTime) {
        cloudMat.uniforms.uTime.value = elapsed;
      }

      // Independent motion 2: NASA Landsat 8 glides smoothly along a safe cosmic orbital pass
      // strictly clear of hero typography columns and CTAs across desktop, tablet, and phone viewports
      const aspect = viewWidth / Math.max(viewHeight, 1);
      const passWave = Math.sin(elapsed * 0.18);
      const driftY = Math.cos(elapsed * 0.24) * 0.06;

      if (viewWidth < 768) {
        // Mobile portrait: sleek silhouette tucked into bottom-right sky corridor cleanly outside atmosphere
        satPivot.position.set(
          0.30 + passWave * 0.06 + pointerOffsetX,
          -0.96 + driftY * 0.5 - pointerOffsetY,
          3.45
        );
        satPivot.scale.setScalar(0.50);
      } else if (aspect < 1.0) {
        // Portrait tablet (820x1180): framed cleanly in spacious upper-right dark sky above left headline
        satPivot.position.set(
          0.62 + passWave * 0.14 + pointerOffsetX,
          0.90 + driftY - pointerOffsetY,
          1.60
        );
        satPivot.scale.setScalar(0.86);
      } else if (viewWidth < 1200) {
        // Landscape laptop/tablet (1180x820): upper-right cosmic sky safely above blue limb
        satPivot.position.set(
          0.84 + passWave * 0.16 + pointerOffsetX,
          0.74 + driftY - pointerOffsetY,
          2.28
        );
        satPivot.scale.setScalar(0.86);
      } else {
        // Widescreen Desktop (1440..1920): upper-right cosmic corridor glowing high above blue atmospheric limb
        satPivot.position.set(
          0.88 + passWave * 0.16 + pointerOffsetX,
          0.78 + driftY - pointerOffsetY,
          2.28
        );
        satPivot.scale.setScalar(0.95);
      }

      // Safety invariant: enforce orbital altitude strictly above outer atmospheric shell (earthRadius * 1.15)
      earthSystem.getWorldPosition(earthCenterWorld);
      const radialVec = satPivot.position.clone().sub(earthCenterWorld);
      const minOrbitR = earthRadius * 1.15;
      if (radialVec.length() < minOrbitR) {
        radialVec.normalize().multiplyScalar(minOrbitR);
        satPivot.position.copy(earthCenterWorld).add(radialVec);
      }

      activeCraft.lookAt(earthCenterWorld);
      activeCraft.rotateX(Math.PI * 0.24 + passWave * 0.05);
      activeCraft.rotateY(0.55 + Math.sin(elapsed * 0.12) * 0.08);
      activeCraft.rotateZ(viewWidth < 768 ? -0.45 : -0.18);

      renderer?.render(scene, camera);

      if (!firstFramePainted) {
        firstFramePainted = true;
      }
      if (firstFramePainted && texturesLoaded >= 3 && !webglReadyMarked) {
        webglReadyMarked = true;
        setWebglReady(true);
      }

      metricReportCounter++;
      if (metricReportCounter % 15 === 0 && frameTimes.length >= 8) {
        satPivot.getWorldPosition(satWorld);
        camToEarth.subVectors(earthCenterWorld, camera.position);
        camToSat.subVectors(satWorld, camera.position);

        const projLen = camToEarth.dot(camToSat.clone().normalize());
        const perpSq = Math.max(0, camToEarth.lengthSq() - projLen * projLen);
        const occluded =
          projLen > 0 &&
          perpSq < earthRadius * earthRadius &&
          camToSat.length() > projLen;

        satNdc.copy(satWorld).project(camera);

        const sorted = [...frameTimes].sort((a, b) => a - b);
        const avgMs = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? avgMs;

        const nextMetrics: OrbitAbMetrics = {
          fps: Number((1000 / Math.max(avgMs, 1)).toFixed(1)),
          p95FrameMs: Number(p95.toFixed(2)),
          droppedFrames,
          satNdcX: Number(satNdc.x.toFixed(3)),
          satNdcY: Number(satNdc.y.toFixed(3)),
          satOccluded: occluded,
          landsatLoaded,
        };
        setMetrics(nextMetrics);
        metricsCallbackRef.current?.(nextMetrics);
      }
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      if (interactiveMode && typeof window !== 'undefined') {
        window.removeEventListener('mousemove', handlePointerMove);
      }
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      dracoLoader.dispose();
      for (const item of disposables) {
        item.dispose();
      }
      if (container.contains(canvas)) {
        container.removeChild(canvas);
      }
      renderer?.dispose();
    };
  }, [forceFallback, reducedMotion, interactiveMode]);

  const isFallback = status.startsWith('FALLBACK_');

  return (
    <div
      data-testid="orbit-ab-stage"
      data-orbit-ab-status={status}
      data-webgl-ready={webglReady ? 'true' : 'false'}
      data-fps={metrics.fps}
      data-p95-frame-ms={metrics.p95FrameMs}
      data-dropped-frames={metrics.droppedFrames}
      data-sat-ndc={`${metrics.satNdcX},${metrics.satNdcY}`}
      data-sat-occluded={metrics.satOccluded ? 'true' : 'false'}
      data-landsat-loaded={metrics.landsatLoaded ? 'true' : 'false'}
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[#02050B]"
    >
      {/* Instant LCP / Zero-CLS Static Poster Base Layer & Reduced-Motion / Save-Data Fallback */}
      <picture className="block h-full w-full">
        <source media="(min-width: 768px)" srcSet="/assets/orbital-earth-horizon-wide.jpg" />
        <img
          src="/assets/orbital-earth-horizon-mobile.jpg"
          alt="Curved Earth horizon illuminated by sunlight along a blue atmospheric limb with an Earth-observation spacecraft in Low Earth Orbit"
          loading="eager"
          decoding="sync"
          fetchPriority="high"
          className="h-full w-full object-cover object-bottom md:object-[72%_center]"
        />
      </picture>

      {/* Real-Time Interactive 3D Three.js Earth + Cloud Shell + Landsat 8 Pass (Fades cleanly over poster on GPU ready) */}
      {!isFallback && (
        <div
          ref={containerRef}
          className={`absolute inset-0 h-full w-full transition-opacity duration-700 ${
            webglReady ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Editorial dark contrast scrims matching landing typography accessibility */}
      <div
        aria-hidden="true"
        className="absolute inset-0 md:hidden"
        style={{
          background:
            'linear-gradient(180deg, rgba(2,5,11,0.90) 0%, rgba(2,5,11,0.62) 44%, rgba(2,5,11,0.12) 72%, rgba(3,7,16,0.52) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="hidden md:block absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, #02050B 0%, rgba(2,5,11,0.88) 28%, rgba(2,5,11,0.44) 47%, rgba(2,5,11,0.06) 66%, transparent 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-28"
        style={{
          background: 'linear-gradient(180deg, transparent 0%, #06101D 100%)',
        }}
      />
    </div>
  );
}
