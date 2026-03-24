use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_notification::NotificationExt;

// ── Focus engine process ──────────────────────────────────────────────────────

struct FocusEngine(Mutex<Option<Child>>);

/// Find the focus_server binary.
/// Release: Contents/Resources/focus_server/focus_server (bundled by Tauri).
/// Dev:     project/focus-engine/dist/focus_server/focus_server (local PyInstaller build).
fn resolve_binary_path(app: &tauri::App) -> Option<std::path::PathBuf> {
    // Release build: bundled into Contents/Resources/focus_server/
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("focus_server").join("focus_server");
        if p.exists() {
            return Some(p);
        }
    }
    // Dev fallback: local PyInstaller dist next to the project root
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    if let Some(project_root) = manifest.parent() {
        let p = project_root
            .join("focus-engine")
            .join("dist")
            .join("focus_server")
            .join("focus_server");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Ensure the binary has execute permission (macOS may strip it during bundling).
fn ensure_executable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mode = meta.permissions().mode();
            if mode & 0o111 == 0 {
                let mut perms = meta.permissions();
                perms.set_mode(mode | 0o755);
                let _ = std::fs::set_permissions(path, perms);
            }
        }
    }
}

fn spawn_focus_engine(app: &tauri::App) -> Option<Child> {
    let binary = resolve_binary_path(app)?;
    ensure_executable(&binary);
    Command::new(&binary)
        .spawn()
        .map_err(|e| eprintln!("StudySight: failed to spawn focus engine: {e}"))
        .ok()
}

fn kill_focus_engine(app: &AppHandle) {
    if let Some(state) = app.try_state::<FocusEngine>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

// ── Tray command (called from JS to keep tray tooltip in sync) ────────────────

#[tauri::command]
fn update_tray_tooltip(app: AppHandle, label: String) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&label));
    }
}

#[tauri::command]
fn show_notification(app: AppHandle, title: String, body: String) {
    let _ = app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show();
}

#[tauri::command]
fn focus_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Open StudySight", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu      = Menu::with_items(app, &[&show_item, &quit_item])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("StudySight")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            build_tray(app)?;
            let child = spawn_focus_engine(app);
            app.manage(FocusEngine(Mutex::new(child)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![update_tray_tooltip, show_notification, focus_window])
        .build(tauri::generate_context!())
        .expect("error while running StudySight")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                kill_focus_engine(app);
            }
        });
}
