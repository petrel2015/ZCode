import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";

// 远端遥测已移除；启用仅本地的崩溃转储，uploadToServer 始终为 false。
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(logger, false);
