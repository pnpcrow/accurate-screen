---
name: accurate-screen
description: "Accurate & fast screen analysis for Windows: UIA text extraction (~40ms, no image), occlusion-proof window capture (~0.22s), UIA-guided crops, provenance ribbons. Use for any 'look at the screen / read this app / analyze screenshot' task — with or without Computer Use. Fixes GLM-family screenshot misreads (occluded content, no-window-border attribution, downscaled text). Windows only. Main agent only."
---

# Accurate Screen (Windows 정밀 화면 분석)

스크린샷을 "찍어서 찾아보는" 대신 **의도 → 핸들 → 좌표 → 캡처/추출 → 잘라 보기** 순서로
분석한다. 근거: 개발 저장소 `C:\Develop\agents-works\accurate-screen\research\`(전 항목 실측).

왜 필요한가 — 전체 화면 캡처 → 모델 판독의 3대 실패(연구 02에서 재현):

1. **가림 손실**: 전체 화면 캡처에는 가려진 내용이 **조용히 없다**. 창은 멀쩡해 보여서 모델은
   "내용이 없다"고 오판한다.
2. **귀속 불능**: 테두리 없는 창의 픽셀은 소유자 정보를 갖지 않는다 — 비전 모델도 원리적으로 모른다.
3. **해상도 붕괴**: 축소된 전체 화면에서 8px 미만 텍스트는 판독이 붕괴된다.

이 스킬의 이미지는 별도 비전 모델이 아니라 **세션 LLM이 직접 읽는다.**

## 0. 비전 게이트 — 세션에서 이미지를 처음 emit하기 전에 반드시 판정

세션 모델(`account:<플랜>/<모델>`)을 능력표와 대조하고 `screen.vision(mode)`로 기록한다.
미기록 상태로 이미지를 emit하지 않는다.

| 모델 | 비전 | 근거 |
|---|---|---|
| GLM-5.3-Flash | ✓ | 실측 — 이 스킬의 모든 판독 실험을 통과(연구 02~03) |
| GLM-5.3 | ✗ | 비전 미포함 — 이미지 경로 금지, 도구 전용 모드 |
| 그 외 전부 | 미확인 → 없음 취급 | 프로빙 금지(이전 프로젝트 설계 원칙 계승) |

비전 ✗ 판정이면: 같은 구독 플랜 → Individual Plan 순으로 알려진 비전 모델을 찾아 전환을 권고하고,
전환 전에는 **도구 전용 모드**(emit 금지, `scanText`/`shot({emit:false})` digest만 사용)로 진행한다.
`"none"` 기록 상태에서는 `shot`/`crop`/`fullScreen`의 emit이 하드 차단된다.

## 1. 의도 선행 프로토콜 — 캡처 전에 한 줄을 쓴다 (Tool Call 이전 제어)

모든 화면 분석은 이 선언에서 시작한다 (호출 결과 텍스트로 남기면 충분):

```
의도: {알고 싶은 것} / 타깃 앱: {이름|pid, 모르면 apps()} / 기대 필드: {값·텍스트·상태}
확인 계층: {UIA 텍스트 | 창 캡처 | 크롭 | 전체화면 개관}
```

효과: 타깃 핸들이 먼저 정해져 캡처 범위가 창·요소로 좁아지고, 셀당 1장인 래스터 예산을 정확히
쓰며, "일단 찍어 보기" 노이즈 턴이 사라진다(연구 03 M5).

## Bootstrap (매 셀 첫 줄)

```js
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { existsSync } = await import("node:fs");
const { homedir } = await import("node:os");
const dirs = [
  join(homedir(), ".agents", "skills", "accurate-screen"),
  "C:\\Develop\\agents-works\\accurate-screen\\skills\\accurate-screen",
];
const skillDir = dirs.find((d) => existsSync(join(d, "scripts", "screen-read.mjs")));
const { setupScreenRead } = await import(pathToFileURL(join(skillDir, "scripts", "screen-read.mjs")).href);
const s = await setupScreenRead({ globals: globalThis });
```

CUA 브로커와 무관하므로 Computer Use 미사용 세션에서도 그대로 동작한다(읽기 전용 애드온 직접 로드).

## API

```typescript
vision("vision"|"none", info?): Promise<Record>;  // 비전 게이트 기록(디스크 유지, 세션마다 재판정)
visionMode(): Promise<Record>;                     // 현재 게이트 조회
apps(): Promise<AppInfo[]>;                        // GUI 앱 열거 (2ms)
windows(target): Promise<WindowInfo[]>;            // 렌더링 가능 창 (1ms)
resolve(target): Promise<Resolved>;                // {pid, windowId, bounds, app, title}
readPoint(gx, gy): Promise<{element}>;             // 화면 점 UIA 히트테스트 (~36ms)
scanText(target, {grid?=4, includeOthers?, maxValue?}): Promise<{elements}>; // 창 내 텍스트 일괄 수집 (~100ms)
shot(target, opts?): Promise<ShotDigest>;          // 창 캡처+digest (기본 emit, ~0.25s)
crop({rect, from?, zoom?, emit?, maxWidth?}): Promise<CropDigest>;  // UIA rect 유도 크롭 (~15ms)
fullScreen(opts?): Promise<FullScreenDigest>;      // GDI 전체화면 (가림 한계, ~0.7s)
```

`target`: 이름 부분문자열 | pid | {pid, windowId?}. 모든 digest에 `app/pid/windowId/screenBounds`
가 붙는다 — **귀속은 digest에서 인용한다, 픽셀에서 추측하지 않는다.**

## 레시피 (계층 순서대로 — 낮은 계층이 성공하면 상위는 생략)

### Tier 0 — 텍스트·값·상태 확인: 이미지 없이 (~100ms, 컨텍스트 최소)

```js
const r = await s.scanText("메모장");   // 요소별 role/title/value/bounds, 위→아래 정렬
// Document/Edit의 value에 본문 전체가 온다. 창이 가려져도 유효(UIA는 뒤에서도 산다).
// 값이 비면: s.readPoint(gx, gy)로 궁금한 점만 찍거나 Tier 1로.
```

성공 기준: 원하는 필드의 value가 채워졌다면 **여기서 끝**. 이미지 0장이 최선의 결과다.

### Tier 1 — 모양·배치·그래픽 확인: 창 캡처 1장 (~0.25s)

```js
const d = await s.shot("메모장", { ribbon: true });  // digest 근거가 박힌 리본 포함(75ms 추가)
// d = { app, pid, windowId, screenBounds, image:{path,...}, blank, ms }
// 텍스트가 본체라면 maxWidth: 0 (리사이즈 금지, 네이티브 해상도 유지)
```

- `d.blank === true` → 렌더링 불가 창(cloaked/최소화). 재시도 금지, Tier 0으로.
- 리본은 캔버스를 **확장해** 붙는다(내용을 덮지 않는다 — 연구 03 M4의 교훈).
- 비교용 두 이미지가 필요하면 **합성해서 1장으로** 만든다(셀당 래스터 1장 — 두 번째는 삭제된다).

### Tier 1b — 소형 텍스트·버튼·아이콘: UIA rect 유도 크롭 (~0.05s + shot)

```js
const r = await s.scanText("메모장");
const el = r.elements.find(e => (e.title ?? "").includes("ZETA"));  // or readPoint로 rect 획득
const [wx, wy] = r.target.bounds;
await s.shot("메모장", { emit: false, format: "png" });             // 베이스 확보(이번 셀 emit 아까움)
const c = await s.crop({ rect: { left: el.bounds[0] - wx, top: el.bounds[1] - wy,
                                 width: el.bounds[2], height: el.bounds[3] }, zoom: 2 }); // 이 크롭이 셀의 래스터
```

분석 면적이 1/100 수준으로 줄고 텍스트는 확대된다 — 전체 화면에서 실패하던 9pt 한국어가
완판되었다(연구 03 M3, 실측 201ms 전 과정). UIA rect 좌표는 **전역 화면점**이므로 반드시
`screenBounds` 원점을 뺀 상대좌표로 변환한다.

### Tier 2 — "화면에 뭐가 떠 있나" 개관: 전체 화면 1장 (~0.7s)

```js
const f = await s.fullScreen();
// f.warning: 가려진 내용은 캡처에 없다 — 개관 전용. 내용 판독은 Tier 0/1로.
```

개관 후 목표를 찾았으면 즉시 Tier 0/1로 전환한다. 전체 화면 이미지에서 텍스트를 읽으려는
시도는 F2(붕괴)·F1(가림)을 다시 산다.

## Computer Use 사용 중 조합 규칙

- 이 스킬은 **읽기 전용**이다. 클릭/타이핑 등 쓰기는 computer-use(-extension) 스킬의 broker
  경로를 그대로 쓴다 — 애드온 입력 프리미티브는 존재해도 절대 사용하지 않는다.
- 래스터 예산은 셀 단위로 **CU와 공유**된다: CU의 get_app_state 스크린샷이 이미 나갔다면
  이 셀에서 `shot`은 `{emit:false}`로. 반대로 `s.shot()`이 나갔다면 CU 좌표 클릭은 다음 셀로.
- 좌표 클릭 전 확인은 이 스킬의 `crop`이 최선이다 — rect 근거가 UIA라 좌표 신뢰도가 픽셀 추측보다 높다.
- CU 세션이 "no actionable frame"을 내면 CU 스킬의 라스터 갱신 절차를 따른다(이 스킬이 대신하지 않는다).

## 하드 룰

0. **비전 게이트 먼저**: 기록 없이 emit 금지. "none"이면 도구 전용 경로만.
1. **의도 먼저**: §1 선언 없이 캡처하지 않는다.
2. **귀속은 digest에서**: 이미지의 소유 앱을 픽셀로 추측하지 않는다. 리본·digest를 인용한다.
3. **셀당 래스터 1장**: 두 번째 emit은 삭제된다. 비교는 합성 1장으로.
4. **가림 함정**: 전체 화면 캡처의 빈 영역을 "내용이 없다"의 근거로 쓰지 않는다. 창 캡처/UIA로 재확인.
5. **텍스트 8px 법칙**: emit 이미지 안 텍스트 높이 ≥8px(권장 ≥10px). 못 맞추면 크롭으로 면적을 줄인다.
   창 캡처 폭 하한 800px(640px는 붕괴선 — 금지). 축소가 필요 없는 창(≤1280)은 리사이즈하지 않는다.
6. **인코딩 기본**: 창 캡처 JPEG Q80(판독력 동등, 2–3배 빠름 — 연구 02), 크롭·텍스트 확대는 PNG.
7. **빈 캡처·실패**: `blank:true`/`ok:false`면 재시도 1회까지, 그래도 아니면 UIA 경로로 전환.
   애드온/broker 오류 반복 시 기본 computer-use 스킬로 폴백하고 결과를 보고.
8. **쌍둥이 창 금지**: 똑같이 생긴 창이 여러 개면 겉모습으로 고르지 않는다 — 반드시
   pid/windowId로 겨냥하고, 캡처 digest의 `screenBounds`·`windowId`가 타깃과 일치하는지
   단언한다(귀속 스트레스 시험 연구 06 — 동일 이미지 쌍둥이에서 픽셀 선택은 원리적으로 불가).

## 성능 참고 (전 과정 실측 — research/04-benchmark.md)

전체 화면→판독 기본 경로 대비: 텍스트 추출 ~40–100ms/이미지 0장(기본: 수 초+실패 가능),
창 분석 ~0.25s(기본: 전체 화면 캡처+축소 0.4s 이상+붕괴 위험), 귀속은 원리적으로 가능한
유일한 방법(digest/리본)이다. 재현 실험 방법론과 수치는 `research/02`, `03` 참조.
