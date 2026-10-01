# accurate-screen (스킬)

Windows에서 ZCode 세션 LLM의 화면 분석을 빠르고 정확하게 만드는 스킬. GLM 계열에서
관찰되는 스크린샷 판독 실패(가림 손실·귀속 불능·텍스트 붕괴)를 원인 단계에서 차단한다.

## 구성

- `SKILL.md` — 스킬 본문 (비전 게이트 → 의도 선행 → 계층별 레시피 → 하드 룰)
- `scripts/screen-read.mjs` — 분석 헬퍼 (CUA 브로커 비의존, 읽기 전용 애드온 직접 로드)
- `scripts/benchmark.mjs` — 전/후 성능 비교 측정 (마크다운 표 출력)

## 설치

```bash
cp -r skills/accurate-screen/. ~/.agents/skills/accurate-screen/
```

- 스킬 리졸버는 `~/.agents/skills/...`(설치본)를 개발본보다 먼저 시도한다(섀도잉 주의 —
  이전 프로젝트 06-vision-gate.md §6 참고). 수정 후 반드시 위 명령으로 재동기화.
- 제거: `rm -rf ~/.agents/skills/accurate-screen`

## 요구 환경

- Windows + ZCode(node_repl) — cua-helper 애드온과 computer-use 플러그인 번들 sharp를 사용.
- Computer Use 사용 여부와 무관하게 동작한다(쓰기 경로가 없다).
- 비전 없는 세션(GLM-5.3 등)에서는 도구 전용 모드로 제한 동작(SKILL.md §0 게이트).

## 핵심 원칙 3줄 요약

1. 텍스트·값은 이미지가 아니라 UIA로 읽는다(~40ms, 가려진 창도 유효).
2. 픽셀이 필요하면 창 단위 검증 캡처 + 필요한 만큼만 크롭(가림 관통, 텍스트 ≥8px 유지).
3. 귀속·근거는 digest와 리본으로 구조적으로 주입한다(픽셀 추측 금지).
