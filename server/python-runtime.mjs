// Public checkout uses a configured interpreter or the system Python command.
export function pythonExecutable(env = process.env, platform = process.platform) {
  return env.COMPANION_XLSX_PYTHON || env.COMPANION_PYTHON || (platform === 'win32' ? 'python' : 'python3');
}
