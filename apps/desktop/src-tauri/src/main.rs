#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, State};

#[derive(Default)]
struct ServerState(Mutex<Option<Child>>);

fn collect_server_entry_candidates(app: &AppHandle) -> Vec<PathBuf> {
  let mut candidates = Vec::new();

  if let Ok(cwd) = std::env::current_dir() {
    candidates.push(cwd.join("apps").join("server").join("dist").join("index.js"));
    candidates.push(cwd.join("server").join("dist").join("index.js"));
  }

  if let Ok(resource_dir) = app.path().resource_dir() {
    candidates.push(resource_dir.join("server").join("dist").join("index.js"));
    candidates.push(resource_dir.join("dist").join("index.js"));
  }

  if let Ok(exe) = std::env::current_exe() {
    if let Some(exe_dir) = exe.parent() {
      candidates.push(exe_dir.join("resources").join("server").join("dist").join("index.js"));
      candidates.push(exe_dir.join("resources").join("dist").join("index.js"));
    }
  }

  candidates
}

fn find_server_entry(app: &AppHandle) -> Option<PathBuf> {
  collect_server_entry_candidates(app)
    .into_iter()
    .find(|entry| entry.exists())
}

fn spawn_server(app: &AppHandle) -> Result<Child, String> {
  let server_entry =
    find_server_entry(app).ok_or_else(|| "Cannot locate server/dist/index.js for desktop sidecar.".to_string())?;

  let mut command = Command::new("node");
  command.arg(server_entry);
  command.env("PORT", "8787");
  command.env("WEB_ORIGIN", "*");

  if cfg!(debug_assertions) {
    command.stdout(Stdio::inherit());
    command.stderr(Stdio::inherit());
  } else {
    command.stdout(Stdio::null());
    command.stderr(Stdio::null());
  }

  command
    .spawn()
    .map_err(|error| format!("Failed to start desktop sidecar server: {error}"))
}

fn wait_for_server_ready(timeout: Duration) -> bool {
  let start = Instant::now();
  while start.elapsed() < timeout {
    if TcpStream::connect("127.0.0.1:8787").is_ok() {
      return true;
    }
    thread::sleep(Duration::from_millis(150));
  }
  false
}

fn stop_server(state: &State<'_, ServerState>) {
  if let Ok(mut guard) = state.0.lock() {
    if let Some(child) = guard.as_mut() {
      let _ = child.kill();
      let _ = child.wait();
    }
    *guard = None;
  }
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      app.manage(ServerState::default());

      match spawn_server(&app.handle()) {
        Ok(child) => {
          let state: State<'_, ServerState> = app.state();
          if let Ok(mut guard) = state.0.lock() {
            *guard = Some(child);
          }
          if !wait_for_server_ready(Duration::from_secs(10)) {
            eprintln!("Desktop sidecar server did not become ready on http://127.0.0.1:8787 in time.");
          }
        }
        Err(error) => {
          eprintln!("{error}");
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("failed to build tauri app")
    .run(|app_handle, event| {
      if matches!(event, RunEvent::Exit) {
        let state: State<'_, ServerState> = app_handle.state();
        stop_server(&state);
      }
    });
}
