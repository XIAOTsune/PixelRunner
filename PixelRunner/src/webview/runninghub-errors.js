import { getRunningHubErrorHint, isRunningHubPendingErrorCode } from "../shared/runninghub-error-hints.js";

const modules = (window.PixelRunnerModules = window.PixelRunnerModules || {});
modules.runningHubErrors = { getRunningHubErrorHint, isRunningHubPendingErrorCode };
