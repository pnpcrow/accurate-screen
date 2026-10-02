# 06 — 귀속 스트레스 시험 (투명 무테두리 이미지 창 · 복제본 포함)

작성일: 2026-10-02 · 요청: "타겟으로 한 앱이 아닌 다른 앱을 오판하는 경우"를 확인할 것
방법(사용자 설계): 강아지·고양이·토끼 등 이미지가 랜덤 표시되는 **배경 투명** 임의 앱을 여러 개
동시 실행 → `--target`으로 실행한 인스턴스는 콘솔에 현재 이미지 종류를 출력, `--background`는
무출력 → 타깃 앱 화면을 캡처했을 때 정확히 캡처되는지 비교.

## 1. 시험 리그

- **테스트 앱** `research/captures/animal-window.ps1` (PowerShell 5.1 + WPF):
  `WindowStyle=None, AllowsTransparency=True, Background=Transparent, ShowInTaskbar=False` —
  테두리·제목줄·태스크바 단서 전무, 360×360 동물 PNG만 표시(투명 배경).
  인자: `--target|--background --kind dog|cat|rabbit|bird|fish --x --y --size`.
  kind 미지정 시 랜덤 선택. `--target`은 기동 직후 `TARGET kind=<종> pid=<pid> mode=target`을
  콘솔에 출력(설계대로 동작 확인).
- **이미지** `research/captures/animals/*.png` (SVG→sharp 생성, 텍스트 없음 — 판별이
  라벨 읽기가 아니라 이미지 인식이 되게 함): dog/cat/rabbit/bird/fish.
- **객관 판정기** `research/captures/match-kind.mjs`: 템플릿 알파로 동물 픽셀만 마스킹한
  RGB RMS(1에 가까울수록 일치). 모델 판독과 독립된 지표.
- **그라운드 트루스**: 콘솔 출력(타깃) + `Win32_Process.CommandLine`(전 인스턴스 pid→kind 지도).

## 2. 기술 발견 — 투명 창의 캡처 특성

| 상태 | 창 직접 캡처 결과 |
|---|---|
| 다른 창에 **가려진** 투명 창 | 알파 채널 보존(표시 시 검정 평탄화), 이미지 무손상 — **가림 관통 여전** |
| 화면에 **보이는** 투명 창 | 배경과 **합성된** 형태(뒤의 UI 색이 배경으로 들어옴), 이미지 자체는 무손상 |

같은 창·같은 위치에서 두 상태가 번갈아 관측됨(`r6-window-dog-transparent.png` vs
`r6-round1-target-capture.png`). 분석 영향: (a) 이미지 내용 판별은 항상 가능, (b) 프로그램
템플릿 비교는 배경을 마스킹해야 함(아래 §4), (c) "배경이 검정" 가정을 하드코딩하지 말 것.

## 3. 라운드 결과 — 오판 0건

| 라운드 | 배치 | 타깃(콘솔 지문) | 판정 |
|---|---|---|---|
| R1 | 5종 개별, 부분 겹침 | dog / pid 15912 | 캡처 = dog(match 0.96, margin 0.40), bounds [375,375,475,475] 일치, 리본 귀속 ✓ |
| R1 음성 | — | cat pid 12320 / rabbit pid 34188 | 각각 cat(0.33)/rabbit(0.62) — **이웃 누출 없음** |
| R2 | **동일 dog 2개**(타깃+룩어라이크) | dog / pid 31952 | 캡처 bounds [375,875]·windowId 248154 = **타깃 창 그 자체**, 룩어라이크(13836)는 별개 창 [1563,275] ✓ |
| R3 | fish 타깃 + **rabbit 2개** + 밀집 겹침 | fish / pid 14928 | 캡처 = fish(0.37), bounds [625,1063] 일치, rabbit 쌍둥이 각자 자기 창 캡처 ✓ |

증거: `captures/r6-round1-target-capture.png`(리본), `r6-round2-target-capture.png`(쌍둥이 중
타깃), `r6-round3-target-capture.png`, `r6-round1-neg-*.png`(음성), `r6-round1-clean.png`(깨끗한
배치 전경). 창 단위 캡처는 **231–350ms**.

## 4. 시험이 걸러낸 것 (설계 학습)

1. **템플릿 매처는 리본·배경에 약하다**: 첫 판정기(그레이스케일 NCC)는 (a) 리본이 내용을
   40px 밀자 마진 붕괴(0.003), (b) 배경 합성 상태에서 오답(rabbit)까지 냈다. 알파 마스킹
   RMS + `topSkip`으로 수정 후 두 배경 상태 모두 margin ≥0.33으로 안정. **점수용 캡처에는
   리본을 붙이지 않거나 topSkip을 쓸 것.**
2. **베이스라인(픽셀-only)은 실제로 오판 지점이다**: v1 전체 화면에서는 실행 콘솔
   (Windows Terminal)이 타깃을 가려 타깃이 **화면에 아예 없었고**, v2(콘솔 정리 후)에서도
   테두리·제목이 없어 "어느 창이 타깃 pid인지"는 픽셀에서 알 수 없다. 동일 이미지 2개(R2)는
   겉모습 선택 자체가 불가능 — **handle-first(pid 겨냥)만이 유일한 정답 경로**이며, 실제로
   3라운드 전부 정확히 타깃 창을 캡처했다.
3. **ZCode 실행 환경 주의**: Bash 백그라운드 실행은 Windows Terminal 창을 만들어 테스트 영역을
   가린다. 시험 전 `WindowsTerminal` MainWindow를 최소화하는 절차를 넣었다(연구 재현 시 필요).
   WPF `--background` 인스턴스는 `-WindowStyle Hidden`으로 콘솔을 숨긴다.
4. **DIP→물리좌표**: WPF Left/Top(DIP) ×1.25(주 디스플레이 스케일) = 물리 px, 반올림 ±1px.
   bounds 단언식은 허용 오차 1px로 쓴다.

## 5. 결론

사용자 질문에 대한 답: **"타겟이 아닌 다른 앱을 오판하는 경우"는 발생하지 않았다** — 단,
픽셀만 보고 창을 고르는 경로에서는 v1처럼 타깃이 안 보이는 상태에서 오판이 필연적이었을
것이다(전체 화면 캡처 분석의 구조적 한계 재확인). 스킬의 계층(핸들 우선 → 창 단위 검증
캡처 → digest/리본 귀속)은 투명·무테두리·복제본 환경에서 3라운드 + 음성 대조 전부 정확했다.
이 교훈은 SKILL.md 하드 룰 8(쌍둥이 창 금지 — pid/windowId 겨냥 + bounds 단언)으로 반영했다.
