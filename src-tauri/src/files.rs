//! 기능 코드가 쓰는 로컬 파일 유틸리티 (UXP의 localFileSystem 대체).

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified_ms: u64,
}

#[tauri::command]
pub fn fs_read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn fs_read_base64(path: String) -> Result<String, String> {
    std::fs::read(&path).map(|b| STANDARD.encode(b)).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn fs_write_text(path: String, text: String) -> Result<(), String> {
    ensure_parent(&path)?;
    std::fs::write(&path, text).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn fs_write_base64(path: String, data: String) -> Result<(), String> {
    ensure_parent(&path)?;
    let bytes = STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| format!("{path}: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified_ms,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn fs_mkdir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn fs_remove(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p)
    } else {
        std::fs::remove_file(p)
    }
    .map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    ensure_parent(&to)?;
    std::fs::rename(&from, &to).map_err(|e| format!("{from} → {to}: {e}"))
}

#[tauri::command]
pub fn fs_copy(from: String, to: String) -> Result<(), String> {
    ensure_parent(&to)?;
    std::fs::copy(&from, &to).map(|_| ()).map_err(|e| format!("{from} → {to}: {e}"))
}

/// 임시 작업 폴더: PhotoCraft 자동화 루트 안에 있어야 app.open/app.save가 접근할 수 있다.
#[tauri::command]
pub fn fs_temp_dir(root: String) -> Result<String, String> {
    let dir = Path::new(&root).join(".jp_plugin_tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Finder에서 경로를 연다.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    std::process::Command::new("open").arg(&path).status().map(|_| ()).map_err(|e| e.to_string())
}

fn ensure_parent(path: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}
