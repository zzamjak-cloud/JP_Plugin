//! PhotoCraft 데스크톱 앱의 JSON-lines 제어 서버(127.0.0.1:<port>) 클라이언트와 실행기.
//! 프로토콜: 연결마다 첫 요청이 auth, 이후 {"id","method","params"} 한 줄 → {"id","ok","result"|"error"} 한 줄.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

// PhotoCraft 서버는 30초 유휴 연결을 끊으므로 그 전에 새로 연결한다.
const IDLE_RECONNECT: Duration = Duration::from_secs(20);
// 서버의 응답 마감(60초)보다 짧게 잡아 서버 오류가 먼저 보이도록 한다.
const CALL_TIMEOUT: Duration = Duration::from_secs(58);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcConfig {
    pub app_path: String,
    pub port: u16,
    pub root: String,
}

struct Conn {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
    last_used: Instant,
}

pub struct PcState {
    conn: Mutex<Option<Conn>>,
    next_id: Mutex<u64>,
    config: Mutex<PcConfig>,
}

impl PcState {
    pub fn new() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
        Self {
            conn: Mutex::new(None),
            next_id: Mutex::new(1),
            config: Mutex::new(PcConfig {
                app_path: "/Applications/PhotoCraft.app".into(),
                port: 7878,
                root: home,
            }),
        }
    }
}

fn token_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("photocraft-control.token"))
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("photocraft.json"))
}

pub fn load_config(app: &AppHandle, state: &PcState) {
    if let Ok(path) = config_file(app) {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(cfg) = serde_json::from_str::<PcConfig>(&text) {
                *state.config.lock().unwrap() = cfg;
            }
        }
    }
}

fn write_line(stream: &mut TcpStream, v: &Value) -> Result<(), String> {
    let mut line = serde_json::to_string(v).map_err(|e| e.to_string())?;
    line.push('\n');
    stream.write_all(line.as_bytes()).map_err(|e| format!("전송 실패: {e}"))
}

fn read_reply(reader: &mut BufReader<TcpStream>, id: u64) -> Result<Value, String> {
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).map_err(|e| format!("응답 수신 실패(명령은 실행됐을 수 있음): {e}"))?;
        if n == 0 {
            return Err("PhotoCraft가 연결을 닫았습니다(명령은 실행됐을 수 있음)".into());
        }
        let v: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if v.get("id").and_then(Value::as_u64) == Some(id) {
            return Ok(v);
        }
    }
}

fn connect(app: &AppHandle, port: u16) -> Result<Conn, String> {
    let token = std::fs::read_to_string(token_file(app)?)
        .map_err(|_| "토큰 파일이 없습니다. JP_Plugin에서 PhotoCraft를 실행하세요.".to_string())?;
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let stream = TcpStream::connect_timeout(&addr, Duration::from_millis(800))
        .map_err(|_| format!("PhotoCraft 제어 포트 {port}에 연결할 수 없습니다"))?;
    stream.set_read_timeout(Some(CALL_TIMEOUT)).ok();
    stream.set_write_timeout(Some(Duration::from_secs(10))).ok();
    let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);
    write_line(&mut writer, &json!({"id": 0, "method": "auth", "params": {"token": token.trim()}}))?;
    let reply = read_reply(&mut reader, 0)?;
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(format!("인증 실패: {}", reply.get("error").cloned().unwrap_or(Value::Null)));
    }
    Ok(Conn { reader, writer, last_used: Instant::now() })
}

fn call_inner(app: &AppHandle, state: &PcState, method: &str, params: Value) -> Result<Value, String> {
    let port = state.config.lock().unwrap().port;
    let mut guard = state.conn.lock().unwrap();
    let stale = guard.as_ref().map(|c| c.last_used.elapsed() > IDLE_RECONNECT).unwrap_or(true);
    if stale {
        *guard = Some(connect(app, port)?);
    }
    let id = {
        let mut n = state.next_id.lock().unwrap();
        *n += 1;
        *n
    };
    let conn = guard.as_mut().unwrap();
    let req = json!({"id": id, "method": method, "params": params});
    if let Err(e) = write_line(&mut conn.writer, &req) {
        // 전송 단계 실패는 실행되지 않았으므로 한 번 재연결 후 재전송한다.
        *guard = Some(connect(app, port)?);
        let conn = guard.as_mut().unwrap();
        write_line(&mut conn.writer, &req).map_err(|_| e)?;
    }
    let conn = guard.as_mut().unwrap();
    let reply = match read_reply(&mut conn.reader, id) {
        Ok(r) => r,
        Err(e) => {
            *guard = None;
            return Err(e);
        }
    };
    conn.last_used = Instant::now();
    if reply.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(reply.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(reply.get("error").and_then(Value::as_str).unwrap_or("알 수 없는 오류").to_string())
    }
}

/// 제어 메서드 호출 (engine.execute, app.open, app.save, ui.inspect …)
#[tauri::command]
pub async fn pc_call(app: AppHandle, method: String, params: Option<Value>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PcState>();
        call_inner(&app, &state, &method, params.unwrap_or_else(|| json!({})))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn photocraft_running() -> bool {
    std::process::Command::new("pgrep")
        .args(["-x", "PhotoCraft"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PcStatus {
    connected: bool,
    running: bool,
    config: PcConfig,
    error: Option<String>,
}

#[tauri::command]
pub async fn pc_status(app: AppHandle) -> Result<PcStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PcState>();
        let config = state.config.lock().unwrap().clone();
        let probe = call_inner(&app, &state, "jobs.list", json!({}));
        Ok(PcStatus {
            connected: probe.is_ok(),
            running: photocraft_running(),
            config,
            error: probe.err(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pc_set_config(app: AppHandle, config: PcConfig) -> Result<(), String> {
    if config.port == 0 {
        return Err("제어 포트는 1~65535 사이여야 합니다".into());
    }
    // 진행 중인 호출이 연결 뮤텍스를 오래 잡고 있을 수 있으므로 UI 스레드가 아닌 블로킹 풀에서 처리
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PcState>();
        std::fs::write(config_file(&app)?, serde_json::to_string_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
        *state.config.lock().unwrap() = config;
        *state.conn.lock().unwrap() = None;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn probe(app: &AppHandle) -> bool {
    let state = app.state::<PcState>();
    call_inner(app, &state, "jobs.list", json!({})).is_ok()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

/// 제어 포트·토큰·자동화 루트를 지정해 PhotoCraft를 실행한다.
/// 이미 제어 없이 실행 중이면 인자가 전달되지 않으므로 오류로 알린다.
#[tauri::command]
pub async fn pc_launch(app: AppHandle) -> Result<(), String> {
    let config = app.state::<PcState>().config.lock().unwrap().clone();
    let a = app.clone();
    if blocking(move || probe(&a)).await? {
        return Ok(());
    }
    if blocking(photocraft_running).await? {
        return Err("RUNNING_WITHOUT_CONTROL".into());
    }
    let token = token_file(&app)?;
    let status = blocking(move || {
        std::process::Command::new("open")
            .arg("-a")
            .arg(&config.app_path)
            .arg("--args")
            .args(["--control", &config.port.to_string()])
            .arg("--control-token-file")
            .arg(&token)
            .arg("--automation-read-root")
            .arg(&config.root)
            .arg("--automation-write-root")
            .arg(&config.root)
            .status()
            .map_err(|e| e.to_string())
            .map(|s| (s.success(), config.app_path.clone()))
    })
    .await??;
    if !status.0 {
        return Err(format!("PhotoCraft 실행 실패: {}", status.1));
    }
    // 서버가 뜰 때까지 최대 20초 대기
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        tokio_sleep(400).await;
        let a = app.clone();
        if blocking(move || probe(&a)).await? {
            return Ok(());
        }
    }
    Err("PhotoCraft가 실행됐지만 제어 포트에 연결하지 못했습니다. 환경설정 › Integrations › Allow Agent Control을 확인하세요.".into())
}

/// 실행 중인 PhotoCraft를 종료한다(저장 안 된 문서가 있으면 PhotoCraft가 확인 창을 띄운다).
#[tauri::command]
pub async fn pc_quit(app: AppHandle) -> Result<(), String> {
    let a = app.clone();
    blocking(move || {
        let state = a.state::<PcState>();
        let _ = call_inner(&a, &state, "app.quit", json!({}));
        *state.conn.lock().unwrap() = None;
        if photocraft_running() {
            let _ = std::process::Command::new("osascript").args(["-e", "tell application \"PhotoCraft\" to quit"]).status();
        }
    })
    .await?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if !blocking(photocraft_running).await? {
            return Ok(());
        }
        tokio_sleep(300).await;
    }
    Err("PhotoCraft가 종료되지 않았습니다. 저장 확인 창을 확인하세요.".into())
}

async fn tokio_sleep(ms: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(Duration::from_millis(ms))).await;
}
