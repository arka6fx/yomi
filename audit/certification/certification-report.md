# Phase X1 — Universal Application Certification

**Generated:** 2026-06-13T07:02:34.716Z
**Platform:** win32
**Host:** ASUS

## Summary

| Metric | Value |
| --- | --- |
| Total Suites | 18 |
| Certified | 1 |
| Not Verified | 1 |
| Degraded | 16 |
| Failing | 0 |
| Pending | 0 |
| Overall Success Rate | 96% |

## Suite Results

| App | Category | Status | Passed | Total | Rate | Duration |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| notepad | file_management | degraded | 6/6 | 6 | 100% | 16669ms |
| spotify | music | degraded | 11/12 | 12 | 92% | 46675ms |
| file-explorer | file_management | degraded | 7/7 | 7 | 100% | 17950ms |
| media-controls | media | certified | 6/6 | 6 | 100% | 42665ms |
| system-commands | system_controls | degraded | 4/4 | 4 | 100% | 8058ms |
| whatsapp | messaging | degraded | 7/8 | 8 | 88% | 21231ms |
| telegram | messaging | degraded | 6/6 | 6 | 100% | 18613ms |
| discord | messaging | degraded | 6/6 | 6 | 100% | 24209ms |
| instagram | messaging | degraded | 5/5 | 5 | 100% | 15999ms |
| windows-settings | system | degraded | 8/8 | 8 | 100% | 28302ms |
| browser | browser | not_verified | 5/7 | 7 | 71% | 29537ms |
| vscode | development | degraded | 6/7 | 7 | 86% | 368ms |
| terminal | terminal | degraded | 5/5 | 5 | 100% | 4086ms |
| word | office | degraded | 8/8 | 8 | 100% | 26705ms |
| excel | office | degraded | 6/6 | 6 | 100% | 27114ms |
| powerpoint | office | degraded | 7/7 | 7 | 100% | 27161ms |
| outlook | office | degraded | 6/6 | 6 | 100% | 24656ms |
| onenote | office | degraded | 5/5 | 5 | 100% | 24607ms |

## Test Details

### notepad (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch Notepad and find window | pass | 2561ms |  |
| 2 | Write text content | pass | 2704ms |  |
| 3 | Save file to Desktop | pass | 498ms |  |
| 4 | Reopen and verify saved content | pass | 3889ms |  |
| 5 | Search text within document | pass | 2455ms |  |
| 6 | Replace text | pass | 4296ms |  |

### spotify (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch Spotify | pass | 4302ms |  |
| 2 | Search for Believer by Imagine Dragons | pass | 7008ms |  |
| 3 | Play song | pass | 5021ms |  |
| 4 | Pause music | pass | 1846ms |  |
| 5 | Resume music | pass | 1843ms |  |
| 6 | Next track | pass | 2342ms |  |
| 7 | Previous track | pass | 2353ms |  |
| 8 | Volume control | pass | 809ms |  |
| 9 | Shuffle | pass | 3917ms |  |
| 10 | Repeat | fail | 2979ms |  |
| 11 | Queue | pass | 3918ms |  |
| 12 | Playlist navigation | pass | 10161ms |  |

### file-explorer (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch File Explorer | pass | 5028ms |  |
| 2 | Create folder | pass | 4168ms |  |
| 3 | Create file in folder | pass | 2ms |  |
| 4 | Search file | pass | 2947ms |  |
| 5 | Navigate to folder | pass | 4058ms |  |
| 6 | Rename file | pass | 737ms |  |
| 7 | Delete file | pass | 769ms |  |

### media-controls (certified)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Play/Pause (20x) | pass | 7131ms |  |
| 2 | Next Track (20x) | pass | 7446ms |  |
| 3 | Previous Track (20x) | pass | 7378ms |  |
| 4 | Volume Up (20x) | pass | 6924ms |  |
| 5 | Volume Down (20x) | pass | 6805ms |  |
| 6 | Mute (20x) | pass | 6975ms |  |

### system-commands (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Open Task Manager | pass | 3952ms |  |
| 2 | Open Control Panel | pass | 2632ms |  |
| 3 | Run command via cmd.exe | pass | 1331ms |  |
| 4 | Lock PC | pass | 139ms |  |

### whatsapp (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch WhatsApp Desktop | fail | 21222ms |  |
| 2 | Search contact | pass | 0ms |  |
| 3 | Open chat | pass | 1ms |  |
| 4 | Send message | pass | 0ms |  |
| 5 | Send emoji | pass | 1ms |  |
| 6 | Search messages | pass | 1ms |  |
| 7 | Open profile | pass | 0ms |  |
| 8 | Recovery: Contact not found | pass | 0ms |  |

### telegram (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch Telegram | pass | 2564ms |  |
| 2 | Search chat | pass | 3181ms |  |
| 3 | Open Saved Messages | pass | 2779ms |  |
| 4 | Send message | pass | 3393ms |  |
| 5 | Search history | pass | 3418ms |  |
| 6 | Open profile | pass | 3274ms |  |

### discord (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch Discord | pass | 5305ms |  |
| 2 | Navigate servers | pass | 2122ms |  |
| 3 | Open channel | pass | 6862ms |  |
| 4 | Send message | pass | 4556ms |  |
| 5 | Open DMs | pass | 2110ms |  |
| 6 | Open user settings | pass | 3249ms |  |

### instagram (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Open Instagram (Web via browser) | pass | 7593ms |  |
| 2 | Login state check | pass | 1107ms |  |
| 3 | Search profile | pass | 3381ms |  |
| 4 | Scroll feed | pass | 2530ms |  |
| 5 | Like post | pass | 1383ms |  |

### windows-settings (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch Settings | pass | 721ms |  |
| 2 | Search settings | pass | 3058ms |  |
| 3 | Open Bluetooth | pass | 2362ms |  |
| 4 | Navigate to Wi-Fi | pass | 5224ms |  |
| 5 | Navigate to Display | pass | 5244ms |  |
| 6 | Navigate to Sound | pass | 5290ms |  |
| 7 | Navigate to Privacy | pass | 5287ms |  |
| 8 | Read setting state | pass | 971ms |  |

### browser (not_verified)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch browser | pass | 1634ms |  |
| 2 | Open URL | pass | 5331ms |  |
| 3 | Search Google | pass | 5195ms |  |
| 4 | Open new tab and close tab | pass | 4730ms |  |
| 5 | Bookmark page | fail | 2327ms |  |
| 6 | Extract page text | pass | 1577ms |  |
| 7 | Handle login page | fail | 8735ms |  |

### vscode (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch VS Code | fail | 363ms | Executable not found in $PATH: "code.cmd" |
| 2 | Open file | pass | 1ms |  |
| 3 | Edit file | pass | 0ms |  |
| 4 | Search code | pass | 0ms |  |
| 5 | Open Git panel | pass | 0ms |  |
| 6 | Run terminal command | pass | 0ms |  |
| 7 | Save file | pass | 0ms |  |

### terminal (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | PowerShell available | pass | 1020ms |  |
| 2 | Run command and capture output | pass | 1011ms |  |
| 3 | Create file via command line | pass | 513ms |  |
| 4 | Delete file via command line | pass | 517ms |  |
| 5 | Navigate directories via PowerShell | pass | 1020ms |  |

### word (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch Microsoft Word | pass | 7120ms |  |
| 2 | Create document | pass | 3523ms |  |
| 3 | Format content | pass | 4229ms |  |
| 4 | Insert table | pass | 5055ms |  |
| 5 | Save document | pass | 681ms |  |
| 6 | Find and Replace | pass | 3870ms |  |
| 7 | Export PDF | pass | 475ms |  |
| 8 | Reopen saved document | pass | 1612ms |  |

### excel (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch Excel | pass | 4582ms |  |
| 2 | Create workbook | pass | 3603ms |  |
| 3 | Enter data | pass | 5400ms |  |
| 4 | Use formulas | pass | 2581ms |  |
| 5 | Sort data | pass | 3782ms |  |
| 6 | Save workbook | pass | 6978ms |  |

### powerpoint (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch PowerPoint | pass | 3928ms |  |
| 2 | Create presentation | pass | 4134ms |  |
| 3 | Add slide | pass | 2316ms |  |
| 4 | Add content to slide | pass | 2816ms |  |
| 5 | Add shapes | pass | 3337ms |  |
| 6 | Apply theme | pass | 3880ms |  |
| 7 | Save presentation | pass | 6605ms |  |

### outlook (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch Outlook | pass | 4946ms |  |
| 2 | Draft email | pass | 7100ms |  |
| 3 | Save draft | pass | 2014ms |  |
| 4 | Search email | pass | 3724ms |  |
| 5 | Create calendar event | pass | 3975ms |  |
| 6 | Contact search | pass | 2890ms |  |

### onenote (degraded)

| # | Test | Status | Duration | Error |
| --- | --- | --- | ---: | --- |
| 1 | Launch OneNote | pass | 5402ms |  |
| 2 | Create notebook | pass | 9433ms |  |
| 3 | Create page | pass | 2703ms |  |
| 4 | Add content | pass | 2839ms |  |
| 5 | Search notes | pass | 4223ms |  |

---
*Report generated by Yomi Certification Framework*