# 01 — 환경과 프리미티브 (무엇이 이미 시스템 안에 있는가)

조사일: 2026-10-02 · 환경: Windows 11 26200 (3모니터), ZCode 0.6.3 CUA 스택, 세션 모델 GLM-5.3-Flash(비전 ✓)

## 1. 디스플레이 환경 (addon.displays() 실측)

| id | 해상도 | 위치 | scale |
|---|---|---|---|
| 65612 (주) | 2560×1600 | (0,0) | 1.25 |
| 65610 | 1920×1080 | (2560,519) | 1.5 |
| 131073 | 960×640 | (3040,1599) | 1.0 |

DPI 스케일이 모니터마다 다르다 — 좌표 산술 시 반드시 `bounds`(전역 물리 좌표) 하나의 체계만 쓴다.

## 2. 네이티브 애드온 (ax_native.node)

ZCode 설치 내부 `%LOCALAPPDATA%\Programs\ZCode\resources\tools\cua-helper\build\Release\ax_native.node`
(Electron 41.0.3 ABI). node_repl 커널은 이 바이너리로 실행되므로 `createRequire`로 직접 로드 가능.
**CUA broker 기동 없이 읽기 전용 프리미티브를 전부 쓸 수 있다** — Computer Use 미사용 세션에서도
동일한 캡처·히트테스트가 동작한다 (스킬의 전제 조건을 실증으로 확인).

### 읽기 프리미티브 실측 비용

| 프리미티브 | 용도 | 실측 |
|---|---|---|
| `listApplications()` | 실행 중 GUI 앱 열거 | **2ms** |
| `listWindows(pid)` | 창 목록(title/bounds/cloaked/minimized) | **1ms** |
| `applicationInfo(pid)` | 이름/exe/bundle_id | **1ms** |
| `elementAtPoint(gx,gy)` | UIA 히트테스트(role/title/value/bounds/ownerPid) | ~36ms† |
| `captureWindowPngVerifiedAsync(winId,pid,bundle)` | 창 단위 검증 캡처(PrintWindow 계열) | **216–345ms** |
| `captureMonitorPngAsync(...)` | 모니터 캡처 | **사용 불가 확인** — 모든 인자 형식에서 `invalid_target` (id/객체/인덱스 전부) |
| `probeAccessibility(pid)` | UIA 생존 확인 | true (메모장/WinForms) |
| `displays()` / `dpiAwarenessInfo()` | 모니터/DPI 정보 | <1ms |
| `captureApp(pid)` | pid 단위 캡처 (시그니처 미확정) | 미사용 |
| `readElement(ref)` | 문자열 ref 요소 읽기 | 시그니처 불명 — `String(winId)`는 null 반환, 문서화할 근거 부족 |

† 이전 프로젝트(glm-computer-use-extension) 02-benchmark.md 실측값. 이번 세션 배치 호출에서도 동등한 속도 관측.

### 주의 기록

- node_repl 커널에 `performance` 전역이 없다 — 시간은 `Date.now()`로 잰다.
- 캡처 결과의 `data`는 Worker 경계를 넘며 cross-realm Buffer가 된다 — `Buffer.isBuffer`가
  false로 나온다. `Buffer.from(d?.data ?? d)`로 정규화할 것.
- **모니터 전체 캡처는 애드온 경로가 막혀 있다.** 대체: PowerShell GDI `CopyFromScreen`
  (2560×1600 PNG 캡처 **215ms** 실측). 아래 §4.

## 3. 이미지 처리 (sharp)

computer-use 플러그인 번들 sharp: `…\zcode-plugins-official\computer-use\0.6.3\node_modules\sharp`.

| 연산 | 실측 |
|---|---|
| 2560→1280 리사이즈 + PNG(palette,Q80) | 108–222ms |
| 2560→1280 리사이즈 + JPEG Q80 | **82ms** |
| 원본에서 extract(크롭) 700×320 | **13ms** |
| 리본(SVG) 합성 + 리사이즈 + PNG 인코딩 | **75ms** |

sharp 파이프라인 규칙(실수 방지): **composite는 resize보다 나중에 적용된다.** 리사이즈한 뒤
그 치수에 맞춘 오버레이를 합성하려면 반드시 2단계(리사이즈→버퍼→합성)로 쪼갠다.

## 4. PowerShell GDI 캡처 (전체 화면이 필요할 때의 유일한 검증된 경로)

```powershell
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
# DPI 가상화 방지 (SetProcessDpiAwareness(2)) 후 CopyFromScreen
```

2560×1600 캡처 215ms. GDI 합성 데스크톱을 그대로 찍으므로 **가려진 영역은 당연히 없다**(§02 참고).

## 5. 실험 리그 (이 문서의 실측에 쓴 타깃)

| 타깃 | pid | 창 | 특성 |
|---|---|---|---|
| 테두리 없는 WinForms 폼 | 42440 | 265436, bounds [520,300,760,440] | 제목줄·테두리 없음, 대형 마커(ALPHA-4217) + 소형 텍스트 3줄 |
| 메모장(WinUI 3, 탭) | 39156 | 459422, bounds [555,259,1600,840] | 통제 텍스트 4줄, 폼에 의해 **부분 가림** 상태로 캡처 |

### 재현성 메모 (함정)

PowerShell 5.1은 BOM 없는 UTF-8 `.ps1`을 CP949로 읽는다. 한글 주석의 UTF-8 바이트가 CP949의
2바이트 문자로 짝지어지면서 **줄바꿈까지 삼켜 다음 줄의 `Add-Type`이 주석으로 흡수될 수 있다**
(실제 발생 — WinForms 어셈블리 미로드로 스크립트 전체가 무음 실패). `.ps1`에는 UTF-8 BOM을
강제한다: `sed -i '1s/^/\xEF\xBB\xBF/' file.ps1`.

## 6. 결론

- "읽기"에 필요한 프리미티브는 전부 애드온 안에 있고 밀리초 등급이다. Computer Use(쓰기 broker)
  없이도 창 핸들 탐색→UIA 읽기→창 단위 캡처→크롭 전체가 가능하다.
- 화면 전체가 필요한 특수한 경우만 GDI 경로로 폴백한다.
- 남는 병목은 "모델에게 무엇을, 어떤 크기로, 어떤 근거와 함께 보여주는가" — 02/03 문서로 이어진다.
