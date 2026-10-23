// 指定したプロセスの画面上のウィンドウ番号を出力する（screencapture -l に渡すため）。
import CoreGraphics
import Foundation

let pid = Int(CommandLine.arguments[1]) ?? -1
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
for window in windows where (window[kCGWindowOwnerPID as String] as? Int) == pid && (window[kCGWindowLayer as String] as? Int) == 0 {
  if let number = window[kCGWindowNumber as String] as? Int { print(number) }
}
