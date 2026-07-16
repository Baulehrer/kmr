use std::{
    fs,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{Manager, RunEvent};

struct Backend(Mutex<Option<Child>>);

fn executable(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn sidecar_path(name: &str) -> Result<PathBuf, String> {
    let current = std::env::current_exe().map_err(|error| error.to_string())?;
    let direct = current
        .parent()
        .unwrap_or(Path::new("."))
        .join(executable(name));
    if direct.exists() {
        return Ok(direct);
    }
    Err(format!("{name} wurde nicht im Programmpaket gefunden"))
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let listener = TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            drop(listener);

            let server = sidecar_path("kmr-server").map_err(std::io::Error::other)?;
            let adapter = sidecar_path("kmr-ma-adapter").map_err(std::io::Error::other)?;
            let child = Command::new(server)
                .env("KMR_HOST", "127.0.0.1")
                .env("KMR_PORT", port.to_string())
                .env("KMR_DB_PATH", data_dir.join("radio_cache.sqlite"))
                .env("KMR_LIBRARY_PATH", data_dir.join("artists"))
                .env("KMR_MA_ADAPTER", adapter)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?;
            *app.state::<Backend>().0.lock().unwrap() = Some(child);

            let window = app.get_webview_window("main").expect("main window");
            thread::spawn(move || {
                for _ in 0..120 {
                    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                        if let Ok(url) = format!("http://127.0.0.1:{port}").parse() {
                            let _ = window.navigate(url);
                        }
                        return;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("KMR konnte nicht gestartet werden");

    app.run(|handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(mut child) = handle.state::<Backend>().0.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
