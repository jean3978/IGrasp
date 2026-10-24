# Architecture

IGrasp is a [Tauri v2](https://tauri.app) application: a Rust process owns the window, the file
system and all background work; a React frontend running in the system webview (WebView2 on
Windows, WebKitGTK on Linux) renders the user interface.

```mermaid
flowchart LR
  subgraph Webview["Webview (React + TypeScript)"]
    UI[Components] --> Stores[zustand stores]
    Stores --> IPC[ipc/client.ts]
  end
  subgraph Rust["Rust process"]
    Cmd[Commands] --> Guard[Root guard]
    Guard --> FS[(Opened folder)]
    Cmd --> AppData[(App data folder)]
  end
  IPC -- invoke --> Cmd
  Rust -- events --> Stores
```

_This page is completed as the phase 1 components land._
