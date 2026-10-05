"""Pure launcher fixtures: no services, HTTP requests, credentials or model loading."""
import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("author_launcher", ROOT / "Start-Author-Demo.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def report(ready):
    return {"schema_version": 1, "read_only": True, "ready": ready, "status": "ready" if ready else "configuration-needed", "checks": [], "error_codes": [], "next_actions": [], "capabilities": {"text_ready": ready, "ui_startable": ready, "task_ready": ready}}


class LauncherTests(unittest.TestCase):
    def setUp(self):
        # These pure fixtures never start a process; supply the Windows flag on Linux CI.
        window_flag = patch.object(launcher.subprocess, "CREATE_NO_WINDOW", 0, create=True)
        window_flag.start()
        self.addCleanup(window_flag.stop)

    def test_missing_configuration_exits_before_logs_or_service_start(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(launcher, "ROOT", pathlib.Path(directory)), patch.object(launcher.shutil, "which", return_value="node"), patch.object(launcher, "preflight", return_value=report(False)), patch.object(launcher.subprocess, "Popen") as spawn, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(launcher.main(["--no-open"]), 2)
            spawn.assert_not_called()
            self.assertFalse((pathlib.Path(directory) / "logs").exists())

    def test_check_is_read_only_even_when_every_component_is_ready(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(launcher, "ROOT", pathlib.Path(directory)), patch.object(launcher.shutil, "which", return_value="node"), patch.object(launcher, "preflight", return_value=report(True)), patch.object(launcher.subprocess, "Popen") as spawn, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(launcher.main(["--check", "--json"]), 0)
            self.assertTrue(json.loads(output.getvalue())["read_only"])
            spawn.assert_not_called()
            self.assertFalse((pathlib.Path(directory) / "logs").exists())

    def test_text_mode_still_respects_configuration_guard(self):
        with patch.object(launcher.shutil, "which", return_value="node"), patch.object(launcher, "preflight", return_value=report(False)) as preflight, patch.object(launcher.subprocess, "Popen") as spawn, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(launcher.main(["--text-only", "--no-open"]), 2)
            preflight.assert_called_once_with("node", True)
            spawn.assert_not_called()

    def test_retries_reuse_verified_host_and_bridge_without_restarting_either(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(launcher, "ROOT", pathlib.Path(directory)), patch.object(launcher.shutil, "which", return_value="node"), patch.object(launcher, "preflight", return_value=report(True)), patch.object(launcher, "port_open", return_value=True), patch.object(launcher, "owner_is_expected", return_value=True), patch.object(launcher.subprocess, "Popen") as spawn, patch.object(launcher.urllib.request, "urlopen", return_value=io.StringIO('{"status":"ok","voice_ready":false}')), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertIsNone(launcher.main(["--text-only", "--no-open"]))
            spawn.assert_not_called()
            self.assertIn('"mode": "explicit-text"', output.getvalue())

    def test_changed_foreign_port_blocks_before_starting_either_service(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(launcher, "ROOT", pathlib.Path(directory)), patch.object(launcher.shutil, "which", return_value="node"), patch.object(launcher, "preflight", return_value=report(True)), patch.object(launcher, "port_open", return_value=True), patch.object(launcher, "owner_is_expected", return_value=False), patch.object(launcher.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(RuntimeError, "PORT_IN_USE"):
                launcher.main(["--no-open"])
            spawn.assert_not_called()

    def test_failed_or_unreadable_doctor_never_becomes_ready(self):
        failed = lambda *args, **kwargs: types.SimpleNamespace(returncode=2, stdout=json.dumps(report(True)))
        self.assertFalse(launcher.preflight("node", runner=failed)["ready"])
        invalid = lambda *args, **kwargs: types.SimpleNamespace(returncode=0, stdout="invalid-json")
        with self.assertRaisesRegex(RuntimeError, "DOCTOR_FAILED"):
            launcher.preflight("node", runner=invalid)


if __name__ == "__main__":
    unittest.main()
