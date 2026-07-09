; KaiSync Workforce Windows installer — Inno Setup 6
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

#define MyAppName "KaiSync Workforce"
#define MyAppPublisher "KaiSync Tech"
#define MyAppExeName "KaiFlow.Timesheets.Maui.exe"
#define MyAppId "{{A7F3C2E1-9B4D-4F8A-8E2C-1D5A0F102026}"
#define MyAppURL "https://www.kaisyncworkforce.com/"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion} (build {#MyAppBuild})
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL=mailto:kaisynctech@gmail.com
AppUpdatesURL={#MyAppURL}download.html
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no
OutputDir=..\dist
OutputBaseFilename=KaiSyncWorkforceSetup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#MyAppExeName}
VersionInfoVersion={#MyAppVersion}.0
VersionInfoProductVersion={#MyAppVersion}.0
VersionInfoProductName={#MyAppName}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=KaiSync Workforce Platform
VersionInfoTextVersion={#MyAppVersion} (build {#MyAppBuild})
CloseApplications=force
RestartApplications=yes
MinVersion=10.0.17763

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
