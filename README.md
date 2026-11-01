# JP Plugin

[PhotoCraft](https://github.com/storytold/photocraft)(오픈소스 Photoshop 대체 이미지 편집기)를 위한 외부 컨트롤 패널 앱.
Photoshop UXP 플러그인 **CAT Plugin**의 모든 기능을 PhotoCraft에서 쓸 수 있도록 옮겼다.

PhotoCraft는 UXP 같은 패널 플러그인을 지원하지 않는 대신, 로컬 제어 포트(JSON-lines over TCP)로
엔진 명령 전체(948개)를 실행할 수 있다. JP Plugin은 이 포트에 붙어 PhotoCraft를 조작하는 작은 데스크톱 앱이다.

```
┌──────────────┐  JSON-lines / TCP 127.0.0.1:7878   ┌──────────────┐
│  JP Plugin   │ ─────────────────────────────────▶ │  PhotoCraft  │
│ (Tauri 앱)   │ ◀───────────────────────────────── │ (--control)  │
└──────────────┘     토큰 인증, 자동화 루트 제한     └──────────────┘
```

## 요구 사항

- macOS (Apple Silicon / Intel)
- PhotoCraft 0.18 이상 (`/Applications/PhotoCraft.app`)
- PhotoCraft 환경설정 › Integrations › **Allow Agent Control** 켜짐 (기본값)

## 사용법

1. JP Plugin을 실행하고 상단의 **PhotoCraft 실행** 버튼을 누른다.
   - JP Plugin이 제어 포트·인증 토큰·작업 루트를 지정해 PhotoCraft를 띄운다.
   - PhotoCraft가 이미 일반 실행 중이면 재시작 여부를 묻는다(제어 포트는 실행 시에만 열 수 있다).
2. 초록 점(연결됨)이 뜨면 패널의 기능을 사용한다.
3. ⚙ 설정
   - **작업 루트**: PhotoCraft가 자동화로 읽고 쓸 수 있는 폴더(기본: 홈 폴더). 이 밖의 경로는 JP Plugin이 임시 폴더를 거쳐 처리한다.
   - **제어 포트**: 기본 7878.

## 기능

### CAT Tools
| 섹션 | 기능 |
|---|---|
| EXPORT | 폴더 프리셋, 레이어 PNG/PSD 내보내기, PNG 내보내고 링크, Clean PSD, Split to layers, 레이어 정렬(전체/선택), 9-patch, Outline stroke, Expand path, Image trace, 마켓 스크린샷, 아이콘 검색(Iconify), SVG를 셰이프로 가져오기, GIF/JPG/PNG 빠른 저장 |
| IMPORT | 문서 크기 프리셋, PSD/PNG 일괄 가져오기, PNG 드롭 시 픽셀 레이어 변환(Auto Paste), 그리드 정렬 |
| LAYERS RENAME | 접두사/번호/역번호/접미사 추가, 이름 변경, 텍스트 치환/삭제 |
| GUIDE | 행×열 가이드(번호 포함), 가이드 지우기/복사/붙여넣기, 9-patch, 가장자리 오프셋 가이드 |
| EXTRA | 앱 아이콘 메이커, 빈 레이어 정리, 숨긴 효과 정리, 애니메이션 레이어 맞추기 |

### 9-Slice Images
이미지 라이브러리(프로젝트별) 등록, 슬라이스(상/하/좌/우) 편집, 클릭으로 원하는 크기의 9-slice 이미지 삽입.

## 개발

```bash
npm install
npm run tauri dev          # 개발 실행
npm run tauri build        # .app / .dmg 번들
```

### 구조

```
src-tauri/src/photocraft.rs   PhotoCraft 실행 + TCP 제어 클라이언트
src-tauri/src/files.rs        로컬 파일 명령
src/core/                     전송 계층(bridge, fs, transport)
src/lib/                      PhotoCraft 조작 라이브러리 (lib_layer, lib_doc, lib_export, lib_pixels, lib_shape, lib_guide …)
src/features/                 기능 로직
src/panels/                   섹션 UI
scripts/harness.ts            Tauri 없이 실제 PhotoCraft에 붙여 기능을 실행하는 테스트 하네스
scripts/tests/                기능별 하네스 테스트
```

### 테스트

별도 PhotoCraft 인스턴스를 테스트 포트로 띄우고 하네스로 기능을 실행한다.

```bash
PORT=7981; ROOT=/tmp/jp_test_$PORT; mkdir -p $ROOT/cfg
PHOTOCRAFT_CONFIG_DIR=$ROOT/cfg /Applications/PhotoCraft.app/Contents/MacOS/PhotoCraft \
  --control $PORT --control-token-file $ROOT/token \
  --automation-read-root $ROOT --automation-write-root $ROOT &
PCPORT=$PORT PCTOKEN=$ROOT/token PCROOT=$ROOT npx tsx scripts/harness.ts scripts/tests/smoke.ts
```

## 라이선스

Apache License 2.0 (CAT Plugin과 동일)
