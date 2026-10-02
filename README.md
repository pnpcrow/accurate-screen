# accurate-screen

**[English](#english) · [한국어](#한국어) · [日本語](#日本語) · [中文](#中文)**

📘 **매뉴얼(초보자용)**: [GitHub Pages 바로 보기](https://pnpcrow.github.io/accurate-screen/) · [PDF](https://pnpcrow.github.io/accurate-screen/accurate-screen-manual.pdf)

## English

A skill that **optimizes the app capture & analysis path for GLM sessions in ZCode**: text via
UIA in milliseconds (no image), occlusion-proof capture straight from the window's output
buffer **by name alone** (works for occluded and continuously-rendering windows such as video
or games), UIA-guided crops for tiny targets, and provenance ribbons baked into every capture.
Works with or without Computer Use. Windows only.

## 한국어

ZCode의 GLM 세션에서 **앱 화면 캡처·분석 경로를 최적화하는 스킬**입니다. 텍스트는 UIA로
수십 ms 만에(이미지 없이) 읽고, 가려진 창은 **이름만으로** 창의 출력 버퍼에서 직접 캡처합니다
(가려진 창·동영상/게임 같은 연속 렌더링 창 모두). 작은 대상은 UIA 좌표 크롭, 모든 캡처에는
출처(귀속) 근거가 함께 붙습니다. Computer Use 사용 여부와 무관하게 동작합니다. Windows 전용.

## 日本語

ZCodeのGLMセッションで**アプリ画面のキャプチャと解析経路を最適化するスキル**です。テキストは
UIAで数十ミリ秒(画像なし)で読み、隠れたウィンドウも**名前だけで**出力バッファから直接
キャプチャします(動画・ゲームなど連続レンダリングも対応)。Computer Useの有無に関係なく動作。Windows専用。

## 中文

用于优化 ZCode 中 GLM 会话**应用屏幕捕获与分析路径**的技能：文本通过 UIA 数十毫秒读取
（无需图像），被遮挡的窗口**仅凭名称**即可直接从输出缓冲区捕获（支持视频、游戏等连续渲染
窗口）。无论是否使用 Computer Use 均可工作。仅限 Windows。

## 구성

- `research/` — 정보 수집·실증 실험·원인 분석 문서 (01~07, 번호 순서대로 읽을 것)
- `skills/accurate-screen/` — 연구 결과로 만든 스킬 (SKILL.md + scripts/)
- `manual/` — eli5 스타일 초보자용 매뉴얼 (GitHub Pages 배포 내용)

## 진행 규칙

- 작업 단위마다 git 커밋.
- 수치 주장은 전부 실측 근거를 붙인다. 추정은 "추정"으로 표기.
- 실증 실험은 세션 LLM 자신(비전 모델)이 판독자로 참여한다 — 판독 성공/실패를 관찰 기록으로 남긴다.
