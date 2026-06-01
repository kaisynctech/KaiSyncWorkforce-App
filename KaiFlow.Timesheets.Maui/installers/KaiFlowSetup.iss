; KaiFlow Windows installer — Inno Setup 6
; Build publish output first: scripts/build_windows_installer.ps1

#ifndef PublishDir
  #define PublishDir "..\publish\windows"
#endif

#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif

#ifndef MyAppBuild
  #define MyAppBuild "1"
#endif

#define MyAppName "KaiFlow"
#define MyAppPublisher "KaiSync Tech"
#define MyAppExeName "KaiFlow.Timesheets.Maui.exe"
#define MyAppId "{{A7F3C2E1-9B4D-4F8A-8E2C-1D5A0F102026}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion} (build {#MyAppBuild})
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://kaisyncworkforce.vercel.app/
AppSupportURL=mailto:kaisynctech@gmail.com
DefaultDirName={autopf}\KaiFlow
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no
OutputDir=..\dist
OutputBaseFilename=KaiFlowSetup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\{#MyAppExeName}
VersionInfoVersion={#MyAppVersion}.0
VersionInfoProductName={#MyAppName}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=KaiFlow Workforce Platform
VersionInfoTextVersion={#MyAppVersion} (build {#MyAppBuild})

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeSetup(): Boolean;
begin
  if not DirExists(ExpandConstant('{#PublishDir}')) then
  begin
    MsgBox('Publish folder not found. Run scripts\build_windows_installer.ps1 first.', mbError, MB_OK);
    Result := False;
  end
  else
    Result := True;
end;
