#define AppName "KMR"
#define AppVersion "1.4.1"
#define AppPublisher "KMR"
#define AppExeName "kmr.exe"

[Setup]
AppId={{96C640DA-0738-4D47-B997-A517E0F93EE5}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\KMR
DefaultGroupName=KMR
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=KMR_{#AppVersion}_x64_Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}

[Files]
Source: "..\..\src-tauri\target\release\kmr.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\src-tauri\binaries\kmr-server-x86_64-pc-windows-msvc.exe"; DestDir: "{app}"; DestName: "kmr-server.exe"; Flags: ignoreversion
Source: "..\..\src-tauri\binaries\kmr-ma-adapter-x86_64-pc-windows-msvc.exe"; DestDir: "{app}"; DestName: "kmr-ma-adapter.exe"; Flags: ignoreversion

[Icons]
Name: "{group}\KMR"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\KMR"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Symbol auf dem Desktop erstellen"; GroupDescription: "Zusätzliche Symbole:"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "KMR starten"; Flags: nowait postinstall skipifsilent
