mod files;
mod photocraft;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(photocraft::PcState::new())
        .setup(|app| {
            let handle = app.handle().clone();
            photocraft::load_config(&handle, &app.state::<photocraft::PcState>());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            photocraft::pc_call,
            photocraft::pc_status,
            photocraft::pc_set_config,
            photocraft::pc_launch,
            photocraft::pc_quit,
            files::fs_read_text,
            files::fs_read_base64,
            files::fs_write_text,
            files::fs_write_base64,
            files::fs_list_dir,
            files::fs_mkdir,
            files::fs_exists,
            files::fs_remove,
            files::fs_rename,
            files::fs_copy,
            files::fs_temp_dir,
            files::reveal_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
