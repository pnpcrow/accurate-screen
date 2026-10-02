/**
 * screen-read.mjs — accurate-screen 스킬의 분석 헬퍼.
 *
 * 설계 근거: accurate-screen/research/01~03 (실측 수치는 문서 참조)
 *
 *  - Computer Use(쓰기 broker)와 완전히 독립이다. 읽기 프리미티브(listApplications/
 *    listWindows/elementAtPoint/captureWindowPngVerifiedAsync)를 ZCode cua-helper의
 *    네이티브 애드온에서 직접 로드하므로, CUA 세션이 없어도 전 기능이 동작한다.
 *  - 분석 계층(연구 03의 의사결정 트리):
 *      Tier 0  scanText/readPoint — UIA 텍스트(이미지 0장, ~40ms)
 *      Tier 1  shot              — 창 단위 검증 캡처(가림 관통, ~220ms)
 *      Tier 1b crop              — UIA rect 유도 크롭(소형 타깃, ~15ms)
 *      Tier 2  fullScreen        — GDI 전체화면(가림 한계 있음, ~0.7s)
 *  - 귀속은 항상 구조적으로 한다: 모든 결과에 {app,pid,windowId,bounds} digest를 붙이고,
 *    리본은 캔버스를 확장해(덮지 않고) 이미지 안에 새긴다.
 *  - 셀당 래스터 1장(두 번째 emit은 삭제된다 — 이전 프로젝트 실측). emit()에 가드가 있다.
 */

import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const STATE = {
  inited: false,
  globals: null,
  addon: null,
  sharp: null,
  cachePath: join(tmpdir(), "zcode-screen-read", "cache.json"),
  cache: {},
  shotSeq: 0,
  rasterEmitted: false, // 한 셀 = 한 래스터 가드(셀 = Worker 1생명)
  lastShots: new Map(), // pid → shot record
};

const DIR = join(tmpdir(), "zcode-screen-read");

// ─────────────────────────────────────────────── 해석기

function findHelperRoot() {
  const candidates = [];
  if (process.env.ZCODE_CUA_HELPER_ROOT) candidates.push(process.env.ZCODE_CUA_HELPER_ROOT);
  candidates.push(join(dirname(process.execPath), "resources", "tools", "cua-helper"));
  if (process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, "Programs", "ZCode", "resources", "tools", "cua-helper"));
  }
  if (process.env.ProgramFiles) {
    candidates.push(join(process.env.ProgramFiles, "ZCode", "resources", "tools", "cua-helper"));
  }
  for (const dir of candidates) {
    const manifest = join(dir, "runtime-manifest.json");
    if (existsSync(manifest)) {
      try {
        const m = JSON.parse(readFileSync(manifest, "utf8"));
        const addon = join(dir, m.addon ?? "build/Release/ax_native.node");
        if (existsSync(addon)) return { helperRoot: dir, addonPath: addon };
      } catch {}
    }
  }
  return null;
}

function findSharp() {
  const root =
    process.env.ZCODE_CUA_PLUGIN_ROOT ??
    process.env.ZCODE_PLUGIN_ROOT ??
    process.env.CLAUDE_PLUGIN_ROOT;
  if (root) {
    const p = join(root, "node_modules", "sharp", "lib", "index.js");
    if (existsSync(p)) return p;
  }
  // 플러그인 캐시 직접 탐색(환경변수가 비어 있는 세션 대비) — 최신 버전 우선
  const cacheRoot = join(process.env.USERPROFILE ?? "", ".zcode", "cli", "plugins", "cache", "zcode-plugins-official", "computer-use");
  if (existsSync(cacheRoot)) {
    let versions = [];
    try {
      versions = readdirSync(cacheRoot).sort().reverse();
    } catch {}
    for (const ver of versions) {
      const p = join(cacheRoot, ver, "node_modules", "sharp", "lib", "index.js");
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// ─────────────────────────────────────────────── 유틸

const toBuf = (d) => (Buffer.isBuffer(d) ? d : Buffer.from(d?.data ?? d));

/**
 * 빈 캡처 감지 — 인코더 독립 측정(채널 표준편차). 연구 04의 교훈: 인코딩 바이트/kpx 임계는
 * 팔레트 PNG가 빈 영역을 과도하게 압축해 오탐한다. 디코딩 통계(stdev≈0 → 균일 화면)가 정확하다.
 */
async function detectBlank(buffer) {
  const stats = await STATE.sharp(buffer).stats();
  const stdev = stats.channels.reduce((a, c) => a + c.stdev, 0) / stats.channels.length;
  return { blank: stdev < 2, stdev: Math.round(stdev * 100) / 100 };
}

async function loadCache() {
  try {
    STATE.cache = JSON.parse(await readFile(STATE.cachePath, "utf8"));
  } catch {
    STATE.cache = {};
  }
  return STATE.cache;
}

async function saveCache() {
  try {
    mkdirSync(DIR, { recursive: true });
    await writeFile(STATE.cachePath, JSON.stringify(STATE.cache, null, 2));
  } catch {}
}

async function emitRaster(buffer) {
  if (STATE.rasterEmitted) {
    throw new Error(
      "one raster per cell: this cell already emitted an image. " +
        "Encode comparison targets into one composite, or split across cells.",
    );
  }
  await loadCache();
  if (STATE.cache.vision?.mode === "none") {
    throw new Error(
      'vision gate: session marked vision-none — image emission is blocked. ' +
        'Use scanText/readPoint/shot({emit:false}) digests (tool-only paths), or re-run the gate.',
    );
  }
  STATE.rasterEmitted = true;
  await STATE.globals?.nodeRepl?.emitImage?.(buffer);
}

// ─────────────────────────────────────────────── 타깃 해석

/** 문자열(이름 일부) | pid | {pid, windowId?} → {pid, windowId, bundleId, title, bounds, app}
 *  문자열은 앱 이름뿐 아니라 **창 제목**도 검색한다 — "윈도우 이름만으로" 캡처 겨냥(연구 07). */
export async function resolve(target) {
  await loadCache();
  let pid, windowId;
  if (typeof target === "number") {
    pid = target;
  } else if (typeof target === "string") {
    const hit = STATE.cache[`name:${target.toLowerCase()}`];
    let cachedAlive = false;
    if (hit?.pid) {
      // 캐시된 pid/창이 아직 살아 있는지 검증 — 죽었으면 새로 검색한다.
      try {
        cachedAlive = (STATE.addon.listWindows(hit.pid) ?? []).some((w) => w.window_id === hit.windowId);
      } catch {}
    }
    if (cachedAlive) {
      pid = hit.pid;
      windowId = hit.windowId;
    } else {
      const byTitle = (await findWindows(target)).filter((w) => (w.title ?? "").toLowerCase().includes(target.toLowerCase()));
      const byApp = (await apps()).filter((a) => (a.name ?? "").toLowerCase().includes(target.toLowerCase()));
      if (byTitle.length === 0 && byApp.length === 0) {
        throw new Error(`no app or window title matching "${target}" — call apps()/findWindows() for the list`);
      }
      if (byApp.length === 1) {
        pid = byApp[0].pid;
      } else if (byApp.length > 1) {
        throw new Error(
          `ambiguous "${target}": ${byApp.map((a) => `${a.name}(pid ${a.pid})`).join(", ")} — pass a pid`,
        );
      } else if (byTitle.length === 1) {
        pid = byTitle[0].pid;
        windowId = byTitle[0].windowId;
      } else {
        throw new Error(
          `ambiguous title "${target}": ${byTitle.slice(0, 6).map((w) => `"${w.title}"(pid ${w.pid})`).join(", ")} — pass a pid or fuller title`,
        );
      }
    }
  } else if (target && typeof target === "object") {
    pid = target.pid;
    windowId = target.windowId;
  }
  if (!pid) throw new Error("resolve needs a pid, name substring, or { pid, windowId? }");

  const info = STATE.addon.applicationInfo(pid) ?? {};
  const wins = STATE.addon.listWindows(pid) ?? [];
  let win = windowId != null ? wins.find((w) => w.window_id === windowId) : null;
  if (!win) {
    const usable = wins.filter((w) => !w.cloaked && !w.minimized && w.bounds?.[2] > 50 && w.bounds?.[3] > 50);
    if (usable.length > 0) {
      usable.sort((a, b) => b.bounds[2] * b.bounds[3] - a.bounds[2] * a.bounds[3]);
      win = usable[0];
    } else {
      // 렌더링 가능 창이 없어도 출력 버퍼가 살아 있을 수 있다(최소화 등) — 가장 큰 창으로
      // 시도하고, 실패·빈 캡처는 shot의 blank 감지가 잡는다(연구 07 시험 B).
      win = wins.filter((w) => w.bounds?.[2] > 0).sort((a, b) => b.bounds[2] * b.bounds[3] - a.bounds[2] * a.bounds[3])[0];
      if (!win) throw new Error(`no window for pid ${pid} — use scanText/readPoint (UIA path)`);
    }
  }
  const resolved = {
    pid,
    windowId: win.window_id,
    bundleId: info.bundle_id ?? null,
    app: info.name ?? null,
    title: win.title ?? "",
    bounds: win.bounds,
  };
  if (resolved.app) STATE.cache[`name:${resolved.app.toLowerCase()}`] = { pid, windowId: resolved.windowId };
  STATE.cache[`pid:${pid}`] = resolved;
  await saveCache();
  return resolved;
}

// ─────────────────────────────────────────────── Tier 0 — UIA 텍스트 (이미지 0장)

/** 화면 점(전역 좌표)의 UIA 요소. 가려진 창의 요소도 z-order상 최상위면 잡힌다. */
export async function readPoint(gx, gy) {
  const t0 = Date.now();
  const el = STATE.addon.elementAtPoint(gx, gy);
  return {
    element: el
      ? {
          role: el.role,
          title: el.title,
          value: el.value ? String(el.value).slice(0, 400) : undefined,
          bounds: el.bounds,
          ownerPid: el.ownerPid,
        }
      : null,
    ms: Date.now() - t0,
  };
}

/**
 * 창 내부를 격자 히트테스트해 텍스트 계열 요소를 수집한다(연구 03 M2).
 * 기본으로 타깃 pid 소유 요소만 남긴다(노이즈 통제) — includeOthers: true로 완화.
 * 반환: 위치 순(위→아래) 요소 목록. Document/Edit의 value에는 본문 전체가 실린다.
 */
export async function scanText(target, opts = {}) {
  const t0 = Date.now();
  const r = await resolve(target);
  const grid = Math.min(Math.max(opts.grid ?? 4, 2), 8);
  const [x, y, w, h] = r.bounds;
  const seen = new Map();
  for (let iy = 0; iy < grid; iy++) {
    for (let ix = 0; ix < grid; ix++) {
      const gx = x + Math.round((w * (ix + 0.5)) / grid);
      const gy = y + Math.round((h * (iy + 0.5)) / grid);
      try {
        const el = STATE.addon.elementAtPoint(gx, gy);
        if (!el) continue;
        if (!opts.includeOthers && el.ownerPid !== r.pid) continue;
        const key = el.bounds?.join(",") ?? `${el.role}:${el.title}`;
        if (seen.has(key)) continue;
        seen.set(key, {
          role: el.role,
          title: el.title ? String(el.title).slice(0, 200) : undefined,
          value: el.value ? String(el.value).slice(0, opts.maxValue ?? 600) : undefined,
          bounds: el.bounds,
          ownerPid: el.ownerPid,
        });
      } catch {}
    }
  }
  const els = [...seen.values()].sort((a, b) => (a.bounds?.[1] ?? 0) - (b.bounds?.[1] ?? 0));
  return {
    target: { app: r.app, pid: r.pid, windowId: r.windowId, bounds: r.bounds },
    elements: els,
    hitPoints: grid * grid,
    ms: Date.now() - t0,
  };
}

// ─────────────────────────────────────────────── Tier 1 — 창 캡처

/**
 * 창 단위 검증 캡처(가림 관통). 기본 emit — 셀당 1장. { emit:false }로 데이터만.
 * opts: { emit?, maxWidth?(=1280, 0이면 리사이즈 없음), format?("jpeg"|"png"),
 *         quality?(=80), ribbon?(=false — 메타데이터 리본을 캔버스 확장으로 부착), savePath? }
 */
export async function shot(target, opts = {}) {
  const t0 = Date.now();
  const r = await resolve(target);
  const cap = await STATE.addon.captureWindowPngVerifiedAsync(r.windowId, r.pid, r.bundleId);
  if (!cap || cap.ok !== true) {
    throw new Error(
      `window capture failed for pid ${r.pid} (${cap?.error ?? "unknown"}) — ` +
        "cloaked or minimized. Use scanText/readPoint (UIA path).",
    );
  }
  let img = STATE.sharp(toBuf(cap.data));
  const fullWidth = cap.width;
  const maxWidth = opts.maxWidth ?? 1280;
  if (maxWidth > 0 && fullWidth > maxWidth) img = img.resize({ width: maxWidth });
  const fmt = opts.format ?? "jpeg";
  let buffer = fmt === "png"
    ? await img.png({ palette: true, quality: opts.quality ?? 80, compressionLevel: 3, effort: 3 }).toBuffer()
    : await img.jpeg({ quality: opts.quality ?? 80 }).toBuffer();
  const meta = await STATE.sharp(buffer).metadata();

  let ribbonHeight = 0;
  if (opts.ribbon) {
    const rib = await buildRibbon(buffer, { app: r.app ?? r.title, pid: r.pid, windowId: r.windowId, bounds: r.bounds, note: opts.note });
    buffer = rib.buffer;
    ribbonHeight = rib.ribbonHeight;
  }
  mkdirSync(DIR, { recursive: true });
  STATE.shotSeq += 1;
  const path = opts.savePath ?? join(DIR, `shot-${r.pid}-${Date.now()}-${STATE.shotSeq}.${fmt === "png" ? "png" : "jpg"}`);
  await writeFile(path, buffer);
  const outMeta = await STATE.sharp(buffer).metadata();
  const blank = await detectBlank(buffer);

  const record = { ...r, buffer, width: outMeta.width, height: outMeta.height, path, ribbonHeight, fullWidth };
  STATE.lastShots.set(r.pid, record);
  STATE.cache.lastShot = { pid: r.pid, path, bounds: r.bounds, windowId: r.windowId, ribbonHeight };
  await saveCache();

  const digest = {
    app: r.app,
    title: r.title,
    pid: r.pid,
    windowId: r.windowId,
    screenBounds: r.bounds,
    image: { width: outMeta.width, height: outMeta.height, bytes: buffer.length, path, hasAlpha: Boolean(outMeta.hasAlpha) },
    // hasAlpha=true는 창 자신의 렌더 버퍼에서 온 것(가림 관통), false는 화면 합성일 수 있다.
    // 어느 쪽이든 내용은 온전하나 프로그램 비교 시 배경 처리가 달라진다(연구 06/07).
    blank,
    ribbon: ribbonHeight > 0,
    method: "captureWindowPngVerifiedAsync",
    ms: Date.now() - t0,
  };
  if (opts.emit !== false) await emitRaster(buffer);
  return digest;
}

/**
 * 메타데이터 리본 — 캔버스를 위로 확장해 새 영역에 그린다(기존 픽셀을 덮지 않는다,
 * 연구 03 M4의 교훈). 반환: { buffer, ribbonHeight }.
 */
async function buildRibbon(buffer, meta) {
  const sharp = STATE.sharp;
  const base = await sharp(buffer).png().toBuffer();
  const m = await sharp(base).metadata();
  const ribbonHeight = 40;
  const extended = await sharp(base).extend({ top: ribbonHeight, background: { r: 179, g: 38, b: 30 } }).png().toBuffer();
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const fontSize = Math.max(14, Math.min(22, Math.round(m.width / 58)));
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${ribbonHeight}">` +
      `<text x="10" y="${Math.round(ribbonHeight * 0.68)}" font-size="${fontSize}" font-family="sans-serif" fill="#ffffff">` +
      `[${esc(meta.app)}] pid ${meta.pid} · win ${meta.windowId} · 화면좌표 ${(meta.bounds ?? []).join(",")}` +
      `${meta.note ? " · " + esc(meta.note) : ""}</text></svg>`,
  );
  const ribbon = await sharp(svg).resize(m.width, ribbonHeight).png().toBuffer();
  const out = await sharp(extended).composite([{ input: ribbon, top: 0, left: 0 }]).png().toBuffer();
  return { buffer: out, ribbonHeight };
}

/**
 * 마지막 shot(또는 from 파일)에서 크롭·확대. rect는 {left,top,width,height}(필수) —
 * readPoint/scanText가 준 요소 bounds에서 screenBounds를 뺀 상대 좌표를 쓴다.
 * opts: { rect, from?, zoom?(=2, ≤3), emit?(=true), maxWidth?(=900), format?("png") }
 */
export async function crop(opts = {}) {
  const t0 = Date.now();
  const rect = opts.rect;
  if (!rect || !Number.isInteger(rect.left) || !Number.isInteger(rect.top) || !rect.width || !rect.height) {
    throw new Error("crop needs rect { left, top, width, height } (raster-relative)");
  }
  let base, scale = 1;
  if (typeof opts.from === "string") {
    base = await readFile(opts.from);
    const m = await STATE.sharp(base).metadata();
    scale = (STATE.cache.lastShot?.path === opts.from && m.width) ? m.width / (STATE.cache.lastShot.fullWidth ?? m.width) : 1;
  } else {
    let rec = [...STATE.lastShots.values()].at(-1);
    if (!rec) {
      await loadCache();
      const l = STATE.cache.lastShot;
      if (l?.path && existsSync(l.path)) {
        rec = { buffer: await readFile(l.path), width: 0, height: 0 };
      }
    }
    if (!rec) throw new Error("crop: no recent shot — take shot() first or pass { from }");
    base = rec.buffer;
  }
  const meta = await STATE.sharp(base).metadata();
  const left = Math.max(0, Math.min(rect.left, meta.width - 1));
  const top = Math.max(0, Math.min(rect.top, meta.height - 1));
  const width = Math.min(rect.width, meta.width - left);
  const height = Math.min(rect.height, meta.height - top);
  const zoom = Math.min(opts.zoom ?? 2, 3);
  const targetW = Math.min(Math.round(width * zoom), opts.maxWidth ?? 900);
  let pipe = STATE.sharp(base).extract({ left, top, width, height });
  if (targetW > width) pipe = pipe.resize({ width: targetW, kernel: "mitchell" });
  const buffer = await pipe.png({ palette: true, quality: 85 }).toBuffer();
  mkdirSync(DIR, { recursive: true });
  STATE.shotSeq += 1;
  const path = join(DIR, `crop-${Date.now()}-${STATE.shotSeq}.png`);
  await writeFile(path, buffer);
  const digest = { rect: { left, top, width, height }, zoom, path, bytes: buffer.length, ms: Date.now() - t0 };
  if (opts.emit !== false) await emitRaster(buffer);
  return digest;
}

// ─────────────────────────────────────────────── Tier 2 — 전체 화면 (GDI 폴백)

/**
 * 전체 화면(가상 화면) GDI 캡처. 애드온의 captureMonitorPngAsync는 이 환경에서
 * invalid_target(연구 01)이므로 PowerShell 경로. **가려진 내용은 찍히지 않는다** —
 * 개관용으로만 쓰고 내용 판독은 shot/scanText로.
 */
export async function fullScreen(opts = {}) {
  const t0 = Date.now();
  mkdirSync(DIR, { recursive: true });
  const out = join(DIR, `fullscreen-${Date.now()}.png`);
  const ps = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type -Namespace W -Name D -MemberDefinition '[DllImport(\"shcore.dll\")] public static extern int SetProcessDpiAwareness(int v);'",
    "[W.D]::SetProcessDpiAwareness(2)|Out-Null",
    "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height)",
    "$g=[System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size)",
    `$bmp.Save('${out.replace(/\\/g, "\\\\")}',[System.Drawing.Imaging.ImageFormat]::Png)`,
    "$g.Dispose();$bmp.Dispose()",
    "Write-Output OK",
  ].join("; ");
  await new Promise((resolveP, rejectP) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 15000, windowsHide: true }, (e, so, se) => {
      if (e && !existsSync(out)) rejectP(new Error(`fullScreen powershell failed: ${String(e.message).slice(0, 200)} ${String(se).slice(0, 200)}`));
      else resolveP();
    });
  });
  let buffer = await readFile(out);
  const maxWidth = opts.maxWidth ?? 1280;
  const m0 = await STATE.sharp(buffer).metadata();
  if (maxWidth > 0 && m0.width > maxWidth) buffer = await STATE.sharp(buffer).resize({ width: maxWidth }).jpeg({ quality: opts.quality ?? 80 }).toBuffer();
  const m = await STATE.sharp(buffer).metadata();
  const blank = await detectBlank(buffer);
  const digest = {
    image: { width: m.width, height: m.height, bytes: buffer.length, path: out },
    blank,
    warning: "composite desktop — occluded content is NOT in this capture",
    method: "gdi-copyfromscreen",
    ms: Date.now() - t0,
  };
  STATE.cache.lastFullScreen = digest;
  await saveCache();
  if (opts.emit !== false) await emitRaster(buffer);
  return digest;
}

// ─────────────────────────────────────────────── 비전 게이트

/** SKILL.md §0 판정 결과 기록. "none"이면 emit이 하드 차단된다. */
export async function vision(mode, info = {}) {
  if (mode !== "vision" && mode !== "none") throw new Error('vision expects "vision" or "none"');
  await loadCache();
  STATE.cache.vision = { mode, evaluatedModel: info.model ?? null, source: info.source ?? null, at: new Date().toISOString() };
  await saveCache();
  return { ...STATE.cache.vision };
}

export async function visionMode() {
  await loadCache();
  return STATE.cache.vision ?? { mode: "unset" };
}

// ─────────────────────────────────────────────── 열거

/** 실행 중 GUI 앱 (2ms). name/exe/pid/active. */
export async function apps() {
  const list = STATE.addon.listApplications() ?? [];
  return list.map((a) => ({ pid: a.pid, name: a.name, exe: a.bundle_id?.split("\\").pop(), active: a.active }));
}

/**
 * 시스템 전체 창을 **제목/앱 이름** 부분문자열로 검색한다 (브로커 없음, ~수 ms).
 * 가려진(cloaked)·최소화 창도 찾아낸다 — "화면에 안 보여서 찾지 못한다" 문제의 구조적 해법.
 * 기본은 렌더링 가능 창만, includeHidden: true로 cloaked/minimized까지 포함.
 */
export async function findWindows(query, opts = {}) {
  const q = (query ?? "").toLowerCase();
  const needle = (s) => (s ?? "").toLowerCase().includes(q);
  const results = [];
  for (const a of STATE.addon.listApplications() ?? []) {
    let wins = [];
    try {
      wins = STATE.addon.listWindows(a.pid) ?? [];
    } catch {
      continue;
    }
    for (const w of wins) {
      const hidden = Boolean(w.cloaked || w.minimized);
      if (!opts.includeHidden && hidden) continue;
      if (q && !needle(w.title) && !needle(a.name)) continue;
      results.push({
        pid: a.pid,
        app: a.name ?? null,
        windowId: w.window_id,
        title: w.title ?? "",
        bounds: w.bounds,
        cloaked: Boolean(w.cloaked),
        minimized: Boolean(w.minimized),
        hidden,
      });
    }
  }
  return results;
}

/** 렌더링 가능한 창 목록 (1ms). */
export async function windows(target) {
  const { pid } = await resolve(target);
  return (STATE.addon.listWindows(pid) ?? [])
    .filter((w) => !w.cloaked && !w.minimized && w.bounds?.[2] > 0)
    .map((w) => ({ windowId: w.window_id, title: w.title, bounds: w.bounds, main: w.main ?? false, focused: w.focused ?? false }));
}

// ─────────────────────────────────────────────── 기동

/**
 * 셀 첫 줄에서:
 *   const { setupScreenRead } = await import(pathToFileURL(join(SKILL_DIR, "scripts", "screen-read.mjs")).href);
 *   const s = await setupScreenRead({ globals: globalThis });
 */
export async function setupScreenRead({ globals = globalThis } = {}) {
  if (STATE.inited) return STATE.api;
  STATE.globals = globals;
  if ((globals.process?.platform ?? process.platform) !== "win32") {
    throw new Error("accurate-screen is Windows-only (measured paths are win32).");
  }
  const helper = findHelperRoot();
  if (!helper) throw new Error("cua-helper (ax_native.node) not found — accurate-screen cannot start.");
  const require_ = createRequire(join(helper.helperRoot, "package.json"));
  STATE.addon = require_(helper.addonPath);
  const sharpPath = findSharp();
  if (!sharpPath) throw new Error("sharp not found under the computer-use plugin — cannot process captures.");
  STATE.sharp = (await import(pathToFileURL(sharpPath).href)).default;
  STATE.inited = true;
  const api = {
    setupScreenRead, vision, visionMode,
    apps, windows, findWindows, resolve,
    readPoint, scanText,
    shot, crop, fullScreen,
    cache: STATE.cachePath,
  };
  STATE.api = api;
  globals.screen = api;
  return api;
}

export default setupScreenRead;
