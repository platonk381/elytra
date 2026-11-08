; Elytra — Windows installer (Inno Setup 6). Built automatically by GitHub Actions (.github/workflows/release.yml);
; locally install.bat builds it too if Inno Setup is installed.
#ifndef AppVer
  #define AppVer "0.10.1"
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
Source: "dist\Elytra.exe"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
; leftovers of the old install.bat setup
Type: files; Name: "{app}\uninstall.bat"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\Elytra"; Flags: deletekey dontcreatekey

[Icons]
Name: "{userprograms}\Elytra"; Filename: "{app}\Elytra.exe"
Name: "{userdesktop}\Elytra"; Filename: "{app}\Elytra.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Elytra.exe"; Description: "{cm:LaunchProgram,Elytra}"; Flags: nowait postinstall skipifsilent
