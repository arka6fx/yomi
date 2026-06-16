import { NotepadSuite } from "./notepad.js"
import { SpotifySuite } from "./spotify.js"
import { FileExplorerSuite } from "./file-explorer.js"
import { MediaControlsSuite } from "./media-controls.js"
import { SystemCommandsSuite } from "./system-commands.js"
import { WhatsAppSuite } from "./whatsapp.js"
import { TelegramSuite } from "./telegram.js"
import { InstagramSuite } from "./instagram.js"
import { WindowsSettingsSuite } from "./windows-settings.js"
import { BrowserSuite } from "./browser.js"
import { VSCodeSuite } from "./vscode.js"
import { TerminalSuite } from "./terminal.js"
import { WordSuite } from "./word.js"
import { ExcelSuite } from "./excel.js"
import { PowerPointSuite } from "./powerpoint.js"
import { OutlookSuite } from "./outlook.js"
import { OneNoteSuite } from "./onenote.js"
import type { BaseSuite } from "../suite.js"

export function registerAllSuites(): BaseSuite[] {
  return [
    new NotepadSuite(),
    new SpotifySuite(),
    new FileExplorerSuite(),
    new MediaControlsSuite(),
    new SystemCommandsSuite(),
    new WhatsAppSuite(),
    new TelegramSuite(),
    new InstagramSuite(),
    new WindowsSettingsSuite(),
    new BrowserSuite(),
    new VSCodeSuite(),
    new TerminalSuite(),
    new WordSuite(),
    new ExcelSuite(),
    new PowerPointSuite(),
    new OutlookSuite(),
    new OneNoteSuite(),
  ]
}
