; Elytra — Windows installer (Inno Setup 6, https://jrsoftware.org/isinfo.php)
; install.bat builds dist\Elytra.exe and then this file into dist\Elytra-Setup.exe automatically
; if Inno Setup is installed. Elytra-Setup.exe is the file to send to friends: no Python needed.
#define AppVer "0.9.0"

[Setup]
AppId={{6E7A1C52-9B1E-4E2B-9D57-E1A7E0A0F0B1}
AppName=Elytra
AppVersion={#AppVer}
AppPublisher=Elytra
DefaultDirName={localappdata}\Programs\Elytra
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=Elytra-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\Elytra.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

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

[Icons]
Name: "{userprograms}\Elytra"; Filename: "{app}\Elytra.exe"
Name: "{userdesktop}\Elytra"; Filename: "{app}\Elytra.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Elytra.exe"; Description: "{cm:LaunchProgram,Elytra}"; Flags: nowait postinstall skipifsilent
