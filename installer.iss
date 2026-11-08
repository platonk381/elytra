; Elytra — Windows installer (Inno Setup 6). Built automatically by GitHub Actions (.github/workflows/release.yml);
; locally install.bat builds it too if Inno Setup is installed.
#ifndef AppVer
  #define AppVer "0.10.3"
#endif

[Setup]
AppId={{6E7A1C52-9B1E-4E2B-9D57-E1A7E0A0F0B1}
AppName=Elytra
AppVersion={#AppVer}
AppVerName=Elytra {#AppVer}
AppPublisher=Elytra
AppPublisherURL=https://platonk381.github.io/elytra/
DefaultDirName={localappdata}\Programs\Elytra
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=Elytra-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\Elytra.exe
UninstallDisplayName=Elytra
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "uk"; MessagesFile: "compiler:Languages\Ukrainian.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; folder build (fewer antivirus false alarms and faster start than a single packed exe)
Source: "build_dir\Elytra\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; leftovers of the old install.bat setup and of the previous build's libraries
Type: files; Name: "{app}\uninstall.bat"
Type: filesandordirs; Name: "{app}\_internal"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\Elytra"; Flags: deletekey dontcreatekey

[Icons]
Name: "{userprograms}\Elytra"; Filename: "{app}\Elytra.exe"
Name: "{userdesktop}\Elytra"; Filename: "{app}\Elytra.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Elytra.exe"; Description: "{cm:LaunchProgram,Elytra}"; Flags: nowait postinstall skipifsilent
; silent self-update from inside Elytra: start it again afterwards
Filename: "{app}\Elytra.exe"; Flags: nowait; Check: WizardSilent
