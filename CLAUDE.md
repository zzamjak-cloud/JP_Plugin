# CLAUDE.md — JP Plugin 개발 가이드

JP Plugin은 CAT Plugin(Photoshop UXP)의 기능을 오픈소스 이미지 편집기 **PhotoCraft**에서 쓰기 위한 외부 컨트롤 앱이다.
Tauri 2 + React + TypeScript. PhotoCraft 데스크톱 앱의 로컬 제어 포트(JSON-lines over TCP)로 명령을 보낸다.

## 언어 규칙

- 코드 주석, 설명, 커밋 메시지는 **한국어**. 식별자는 영어.

## 구조

| 경로 | 역할 |
|---|---|
| `src-tauri/src/photocraft.rs` | PhotoCraft 실행(`--control` 포트·토큰·자동화 루트), TCP 제어 클라이언트(`pc_call`) |
| `src-tauri/src/files.rs` | 로컬 파일 유틸 명령(`fs_*`) |
| `src/core/transport.ts` | Tauri invoke / Node 하네스 공용 전송 계층 |
| `src/core/bridge.ts` | `exec(command, params)`(엔진 명령), `pcCall(method, params)`(제어 메서드), `withHistory` |
| `src/core/fs.ts` | 파일·다이얼로그 래퍼 |
| `src/lib/` | PhotoCraft 조작 라이브러리 (CAT `lib/` 대응) |
| `src/features/` | 기능 로직 (CAT 루트의 기능 파일 대응, UI 없음) |
| `src/panels/` | 섹션 UI (React) |
| `src/ui/` | 공용 UI 컴포넌트, 진행률, localStorage |
| `scripts/harness.ts` | Tauri 없이 실제 PhotoCraft에 붙여 TS를 실행하는 테스트 하네스 |

## 라이브러리 우선 원칙

1. 기능 파일에서 `exec()`를 직접 호출하지 않는다. PhotoCraft 조작은 `src/lib/lib_*.ts`를 거친다.
2. 새 조작이 필요하면 먼저 `src/lib/`에서 동일·유사 함수를 찾고, 없으면 적절한 lib 파일에 추가한다.
3. 기존 함수 확장은 옵셔널 파라미터로 하위 호환을 유지한다.

## PhotoCraft 제어 핵심 규칙

- 명령 목록·파라미터: `/Applications/PhotoCraft.app/Contents/MacOS/photocraft-cli commands --json [--filter X]`
- 제어 프로토콜 문서: https://github.com/storytold/photocraft/blob/main/docs/control-protocol.md
- **파일 경로 제약**: `app.open`/`app.save`는 자동화 루트(설정의 작업 루트) 안 경로만 허용한다. `file.*` 명령과 `layer.exportAs` 등 경로 파라미터 명령은 제어 채널에서 거부된다.
  → `lib_export.ts`의 `saveActiveDocAs`/`openFile`이 루트 밖 경로를 임시 폴더 경유로 처리한다. 항상 이 함수를 쓴다.
- **레이어 내보내기**: `layer.duplicate {document:"new"}` → (트림) → `saveActiveDocAs` → `file.close`.
- **다른 파일을 레이어로 가져오기**: `importImageAsLayer` (app.open → `layer.copyToDocument` → 닫기).
- **시스템 클립보드 이미지 붙여넣기**: `edit.paste` 가 macOS 클립보드 PNG를 읽는다.
- **픽셀 읽기/쓰기**: `lib_pixels.ts` (`getLayerPixels`, `putPixelsAsLayer`) — PNG 왕복, `fast-png`로 디코드.
- **Undo 그룹**: `withHistory(fn)` 안의 명령은 공통 `coalesce` 키로 한 단계로 합쳐진다.
- `document.inspect` 레이어 bounds는 `[x, y, w, h]`. opacity/fill은 0..1.
- 경로 데이터: `path.set {path:{subpaths:[{closed, knots:[{anchor:[x,y], in:[x,y], out:[x,y], smooth}]}]}}`, 셰이프: `shape.create {kind:"path", path:{…}, fill}`.

## 테스트 (실제 PhotoCraft로 검증)

사용자의 PhotoCraft와 분리된 테스트 인스턴스를 띄워 하네스로 검증한다.

```bash
ROOT=/tmp/jp_test_$PORT; mkdir -p $ROOT/cfg
PHOTOCRAFT_CONFIG_DIR=$ROOT/cfg nohup /Applications/PhotoCraft.app/Contents/MacOS/PhotoCraft \
  --control $PORT --control-token-file $ROOT/token \
  --automation-read-root $ROOT --automation-write-root $ROOT >/dev/null 2>&1 &
PCPORT=$PORT PCTOKEN=$ROOT/token PCROOT=$ROOT npx tsx scripts/harness.ts scripts/tests/<test>.ts
```

- 포트 7878은 실사용 기본값이므로 테스트에 쓰지 않는다.
- 테스트 스크립트에서 `globalThis.__JP_DIALOG_ANSWERS__ = [...]`로 파일/폴더 다이얼로그 응답을 지정한다.
- `JP_TRACE=1`이면 모든 제어 호출을 출력한다.

## 빌드

```bash
npm run build                                   # 프런트엔드 타입체크 + 번들
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev                               # 앱 실행
npm run tauri build                             # .app/.dmg 번들
```
