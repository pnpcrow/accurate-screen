/**
 * match-kind.mjs — 창 캡처가 어떤 동물 이미지인지 프로그램으로 판정한다(모델 비전과 독립된 객관 지표).
 *
 * 방법(마스크ed RMS): 템플릿 PNG의 알파 채널로 "동물 픽셀"만 마스킹하고, 캡처 크기에 맞춘
 * 뒤 마스크 내 RGB RMS 거리를 점수화한다. 투명 창 캡처는 상태에 따라 배경이 검정 평탄화 또는
 * 화면 합성으로 돌아오므로(연구 06), 배경 픽셀을 아예 비교에서 제외하는 방식이 강건하다.
 * 리본이 붙은 캡처는 topSkip으로 상단을 건너뛴다(리본 = 캔버스 확장이므로 내용이 아래로 밀린다).
 *
 * 사용:
 *   const { matchKind } = await import(pathToFileURL(join(capturesDir, "match-kind.mjs")).href);
 *   const r = await matchKind(sharp, capturePath, animalsDir, { topSkip: 40 }); // → { best, scores }
 */

import { join } from "node:path";

const KINDS = ["dog", "cat", "rabbit", "bird", "fish"];

export async function matchKind(sharp, capture, animalsDir, kindsOrOpts = KINDS, maybeOpts = {}) {
  const kinds = Array.isArray(kindsOrOpts) ? kindsOrOpts : KINDS;
  const opts = Array.isArray(kindsOrOpts) ? maybeOpts : kindsOrOpts;
  const topSkip = opts.topSkip ?? 0;
  const meta = await sharp(capture).metadata();
  const region = {
    left: 0,
    top: Math.min(topSkip, meta.height - 1),
    width: meta.width,
    height: meta.height - Math.min(topSkip, meta.height - 1),
  };
  const capBuf = await sharp(capture).extract(region).removeAlpha().raw().toBuffer();
  const { width: w, height: h } = region;

  const scores = {};
  for (const k of kinds) {
    const tmpl = await sharp(join(animalsDir, `${k}.png`))
      .resize(w, h, { fit: "fill" })
      .raw()
      .toBuffer(); // 4ch (RGBA)
    let sum = 0, n = 0;
    for (let i = 0; i < w * h; i++) {
      const a = tmpl[i * 4 + 3];
      if (a < 200) continue; // 동물 본체 픽셀만
      const dr = capBuf[i * 3] - tmpl[i * 4];
      const dg = capBuf[i * 3 + 1] - tmpl[i * 4 + 1];
      const db = capBuf[i * 3 + 2] - tmpl[i * 4 + 2];
      sum += dr * dr + dg * dg + db * db;
      n++;
    }
    const rms = Math.sqrt(sum / Math.max(n, 1));
    scores[k] = Math.round((1 - rms / 255) * 1000) / 1000; // 1(동일)에 가까울수록 일치
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return {
    best: sorted[0][0],
    bestScore: sorted[0][1],
    scores,
    margin: Math.round((sorted[0][1] - sorted[1][1]) * 1000) / 1000,
    maskedPixels: undefined,
  };
}

export default matchKind;
