# 05 — 스킬 설계와 검증 (연구 → 구현 대응 + 검증 기록)

작성일: 2026-10-02 · 구현: `skills/accurate-screen/` (screen-read.mjs + SKILL.md + benchmark.mjs)

## 1. 설계 결정과 근거 대응

| 스킬 요소 | 근거(연구) | 구현 |
|---|---|---|
| CUA 브로커 비의존 | 01 — 읽기 프리미티브가 애드온에 전부 존재(2ms 열거) | `setupScreenRead`가 ax_native.node를 직접 로드. Computer Use 없이 전 기능 동작(실증) |
| UIA 우선 계층(Tier 0) | 03 M2 — 텍스트 100% 일치, ~40–100ms, 이미지 0장 | `scanText`(격자 히트테스트), `readPoint` |
| 창 단위 검증 캡처(Tier 1) | 03 M1 — 가림 관통 216ms 실증 | `shot` — digest(blank, bounds, app) 동봉 |
| UIA rect 유도 크롭(Tier 1b) | 03 M3 — 201ms에 실패→성공 반전 | `crop` (rect 상대좌표, zoom ≤2, 폭 ≤900) |
| GDI 전체화면 폴백(Tier 2) | 01 — 애드온 captureMonitorPngAsync `invalid_target` 확인 | `fullScreen` — PowerShell 인라인, **가림 경고 digest 필수** |
| 메타데이터 리본 | 03 M4 — 귀속의 유일한 원리적 해법 | `shot({ribbon:true})` — **extend 방식**(덮지 않음) |
| 의도 선행 프로토콜 | 03 M5 — 사용자 가설 채택 | SKILL.md §1 (캡처 전 선언 의무화) |
| 비전 게이트 | 02 F6, 이전 프로젝트 06 계승 | `vision()/visionMode()` + emit 하드 차단 |
| JPEG 기본/PNG 크롭 | 02 — Q80 판독력 동등, 2–3배 빠름 | `shot` format 기본 jpeg, `crop`은 png 고정 |
| 셀당 래스터 1장 가드 | 02 F4 — 두 번째 이미지 삭제 실측(이전 프로젝트) | `emitRaster` 가드 + "합성 1장" 안내 |

## 2. 스킬 검증 결과 (2026-10-02, 이 세션에서 전 경로 실행)

| 검증 | 결과 |
|---|---|
| 부트스트랩(개발본 경로) | 56ms ✓ |
| `vision("vision")` 기록·조회 | ✓ (디스크 캐시) |
| `apps()` / `windows()` / `resolve()` | 14개 앱, 메모장 해석 ✓ |
| `scanText("메모장")` | 87–96ms, 본문 전체(value), 검증 2/2 ✓ |
| `scanText(42440, grid:6)` | 220ms, ALPHA-4217 + l2 확보(1/1 PASS) ✓ |
| `shot({ribbon:true, format:"png"})` | 377ms, 리본이 내용을 덮지 않음 ✓, emit ✓ |
| Tier 1b 전체(스캔→shot(emit:false)→crop) | 494ms, 판독 완판 ✓ |
| `fullScreen({emit:false})` | 1,493ms(PS 기동 포함), 가림 경고 포함 ✓ |
| `benchmark.mjs` 실행 | allPass=true, 마크다운 표 출력 ✓ |

## 3. 검증 중 발견·수정한 결함 (설계 학습)

1. **빈 캡처 지표의 오탐**: 이전 프로젝트의 "인코딩 바이트/kpx < 40" 임계는 팔레트 PNG가
   빈 영역을 과도하게 압축하면 오탐한다(벤치 1차 실행에서 실제 오탐 — blank=true로 나옴).
   → **디코딩 통계 기반으로 교체**: sharp `stats()` 채널 표준편차 < 2 → blank. 인코더 독립.
2. **격자 스캔의 샘플링 한계**: grid가 요소를 사이로 놓치면 빠진다(실제로 l3 라벨 25px 높이가
   grid 6에서 누락). → SKILL.md에 명시: 빠진 요소는 `readPoint`로 점을 찍거나 grid 상향.
3. **PowerShell 인코딩 함정**: BOM 없는 UTF-8 .ps1의 한글이 CP949로 재해석되며 다음 줄을
   삼켜 무음 실패(연구 01 §5). 스킬의 PowerShell 인라인 스크립트는 ASCII만 사용한다.
4. **sharp 합성 순서**: composite는 resize보다 나중 적용 → 2단계 분리 필요(연구 01 §3).

## 4. 한계와 미해결

- `captureMonitorPngAsync`는 모든 인자 형식에서 `invalid_target` — 애드온 모니터 캡처는
  스킬에서 배제하고 GDI 폴백으로 대체했다. ZCode 버전업에서 서명이 바뀌면 재검토.
- `readElement(ref)`(문자열 ref)의 정확한 시그니처 미확정 — 사용하지 않는다.
- UIA가 없는 앱(일부 게임/DirectX 전용 렌더링)은 Tier 0이 불가 → Tier 1 + 수동 좌표 크롭.
- 판독력 평가(02 표)는 세션 모델 자신이 판독자라 주관적 영역이 남는다 — 프로그램 판정은
  benchmark.mjs의 텍스트 일치로 보완(객관). 다른 비전 모델과의 교차 판독은 미실시.
- scanText는 z-order상 최상위 요소만 잡는다 — 완전히 뒤에 숨은 창의 요소는 히트테스트로
  닿지 않는다(단, 가려진 창이 최상위인 영역이 하나라도 있으면 그 창의 요소는 잡힌다 — 실증).

## 5. 이전 프로젝트(glm-computer-use-extension)와의 역할 분담

| | computer-use-extension | accurate-screen (이번) |
|---|---|---|
| 목적 | **조작**(클릭·타이핑, 빠르게) | **분석**(읽고 판단, 정확하게) |
| 읽기 | shot/crop(랫스터 중심) | UIA 우선 + 근거 부착 캡처 |
| 쓰기 | CUA broker 경로 | 없음(읽기 전용) |
| 조합 | 좌표 클릭 전 이 스킬의 crop으로 근거 확인 | CU 셀의 래스터 예산을 존중(emit:false) |
