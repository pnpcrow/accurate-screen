/**
 * benchmark.mjs — accurate-screen 전/후 성능 비교 측정 스크립트.
 *
 * 실행(node_repl 셀에서):
 *   const { setupScreenRead } = await import(pathToFileURL(join(skillDir, "scripts", "screen-read.mjs")).href);
 *   const s = await setupScreenRead({ globals: globalThis });
 *   const { runBenchmark } = await import(pathToFileURL(join(skillDir, "scripts", "benchmark.mjs")).href);
 *   const report = await runBenchmark(s, { emit: false });
 *   console.log(report.markdown);   // 마크다운 표
 *
 * 모든 측정은 emit:false(이미지 없음)로 수행된다 — 벤치마크가 래스터 예산을 소모하지 않는다.
 * 검증(expect) 항목은 텍스트 일치를 프로그램으로 판정한다 — 판독력(비전) 평가는 연구 02의
 * 사람=모델 판독 실험이 담당한다.
 */

import { readFileSync } from "node:fs";

const findFirst = (hay, needles) => needles.filter((n) => hay.includes(n));

export async function runBenchmark(s, opts = {}) {
  const rows = [];
  const row = (task, ms, extra = "") => rows.push({ task, ms, extra });
  const expectNotepad = ["EXPERIMENT TARGET FILE", "ZETA-9917-Q"];
  const expectForm = ["ALPHA-4217"];

  // [B] 이전 경로 — 전체 화면 캡처(GDI) + 축소. "빠른 개관" 외엔 이 경로가 정답이 아니다.
  const fs0 = Date.now();
  const f = await s.fullScreen({ emit: false });
  row("B1 전체화면 캡처(GDI)+축소 1280", Date.now() - fs0, `${f.image.width}×${f.image.height}, 가림 손실 내재`);

  // [M1] 창 캡처 — 가림 관통
  const s0 = Date.now();
  const d = await s.shot("메모장", { emit: false, format: "png" });
  row("M1 창 단위 검증 캡처(+PNG)", Date.now() - s0, `blank=${d.blank.blank}, ${d.image.width}×${d.image.height}`);

  const sj = Date.now();
  await s.shot("메모장", { emit: false, format: "jpeg" });
  row("M1' 창 단위 검증 캡처(+JPEG Q80)", Date.now() - sj, "기본 인코더 — 텍스트 판독력 동등(연구 02)");

  // [M2] UIA 텍스트 — 이미지 0장
  const t0 = Date.now();
  const scan = await s.scanText("메모장");
  const values = scan.elements.map((e) => `${e.title ?? ""} ${e.value ?? ""}`).join("\n");
  const hits = findFirst(values, expectNotepad);
  row("M2 UIA 텍스트 추출(메모장)", Date.now() - t0,
    `이미지 0장, 검증 ${hits.length}/${expectNotepad.length} ${hits.length === expectNotepad.length ? "PASS" : "FAIL"}`);

  const t1 = Date.now();
  const scanF = await s.scanText(42440, { grid: 6 });
  const valuesF = scanF.elements.map((e) => `${e.title ?? ""} ${e.value ?? ""}`).join("\n");
  const hitsF = findFirst(valuesF, expectForm);
  row("M2' UIA 텍스트 추출(테두리 없는 폼)", Date.now() - t1,
    `이미지 0장, 귀속=pid 확정, 검증 ${hitsF.length}/${expectForm.length} ${hitsF.length === expectForm.length ? "PASS" : "FAIL"}`);

  // [M3] 핸들→좌표→캡처→크롭 파이프라인
  const p0 = Date.now();
  const r = await s.resolve("메모장");
  const doc = scan.elements.find((e) => e.role === "Document");
  await s.shot("메모장", { emit: false, format: "png" });
  const c = await s.crop({
    rect: { left: doc.bounds[0] - r.bounds[0], top: doc.bounds[1] - r.bounds[1], width: Math.min(doc.bounds[2], 700), height: 120 },
    zoom: 2,
    emit: false,
  });
  row("M3 UIA 유도 크롭 파이프라인", Date.now() - p0,
    `면적 ${(Math.min(doc.bounds[2], 700) * 120 / (2560 * 1600) * 100).toFixed(1)}% of 전체화면, 판독 성공(연구 03)`);

  // [M4] 리본(귀속 메타데이터)
  const rb0 = Date.now();
  await s.shot("메모장", { emit: false, format: "png", ribbon: true });
  row("M4 리본 합성 포함 창 캡처", Date.now() - rb0, "귀속 근거를 이미지 안에 확장 부착");

  // [열거 비용]
  const a0 = Date.now();
  await s.apps();
  row("앱 열거 listApplications", Date.now() - a0, "브로커 없음");
  const w0 = Date.now();
  await s.windows("메모장");
  row("창 열거 listWindows", Date.now() - w0, "");

  const ok = rows.every((r2) => !r2.extra.includes("FAIL"));
  const md = [
    "| 경로 | 과제 | 실측(ms) | 비고 |",
    "|---|---|---|---|",
    ...rows.map((r2) => `| ${r2.task.startsWith("B") ? "이전" : "스킬"} | ${r2.task} | ${r2.ms} | ${r2.extra} |`),
  ].join("\n");
  return { rows, markdown: md, allPass: ok, fullScreen: f, shot: d, crop: c, scan, scanF };
}

export default runBenchmark;
