import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
import zipfile
from package_candidate import SIBLING_SKILLS, TARGETS, package_candidate


class PortableCandidateTests(unittest.TestCase):
    def fixture(self, root):
        skill, release = Path(root) / "tracetoon", Path(root) / "release"
        (skill / "bin").mkdir(parents=True)
        release.mkdir()
        (skill / "bin/tracetoon").write_bytes(b"#!/bin/sh\necho synthetic\n")
        (skill / "SKILL.md").write_bytes(b"Synthetic instructions\n")
        for name in SIBLING_SKILLS:
            (Path(root) / name / "references").mkdir(parents=True)
            (Path(root) / name / "SKILL.md").write_bytes(b"Synthetic sibling\n")
            (Path(root) / name / "references" / "guide.md").write_bytes(b"Guide\n")
        (skill / "build.json").write_text(json.dumps({"recipe": {"native": {"targets": sorted(TARGETS)}}}), encoding="utf-8")
        for target in TARGETS:
            name = "tracetoon-" + target + (".exe" if target.startswith("windows-") else "")
            (release / name).write_bytes(b"synthetic native " + target.encode())
            (release / (name + ".build.json")).write_bytes(b"synthetic receipt " + target.encode())
        return skill, release

    def test_real_archives_keep_payloads_and_unix_executable_modes(self):
        with tempfile.TemporaryDirectory() as root:
            skill, release = self.fixture(root)
            outputs = package_candidate(skill, release)
            self.assertEqual(len(outputs), 6)
            for path in outputs:
                with zipfile.ZipFile(path) as archive:
                    self.assertIsNone(archive.testzip())
                    launcher = archive.getinfo("tracetoon/bin/tracetoon")
                    self.assertEqual(launcher.create_system, 3)
                    self.assertEqual(launcher.external_attr >> 16, stat.S_IFREG | 0o755)
                    self.assertEqual(archive.read(launcher), (skill / "bin/tracetoon").read_bytes())
                    for entry in archive.infolist():
                        if entry.filename.endswith(".build.json"):
                            self.assertEqual(entry.external_attr >> 16, stat.S_IFREG | 0o644)
            for target in TARGETS:
                name = "tracetoon-" + target + (".exe" if target.startswith("windows-") else "")
                with zipfile.ZipFile(release / ("tracetoon-skill-" + target + ".zip")) as archive:
                    native = archive.getinfo("tracetoon/bin/" + name)
                    self.assertEqual(archive.read(native), (release / name).read_bytes())
                    self.assertEqual(archive.read(native.filename + ".build.json"), (release / (name + ".build.json")).read_bytes())
                    self.assertEqual(native.external_attr >> 16, stat.S_IFREG | (0o644 if target.startswith("windows-") else 0o755))

    def test_sibling_skills_ship_beside_the_main_skill(self):
        with tempfile.TemporaryDirectory() as root:
            skill, release = self.fixture(root)
            for path in package_candidate(skill, release):
                with zipfile.ZipFile(path) as archive:
                    for name in SIBLING_SKILLS:
                        self.assertEqual(archive.read(name + "/SKILL.md"), b"Synthetic sibling\n")
                        self.assertEqual(archive.read(name + "/references/guide.md"), b"Guide\n")
                        self.assertEqual(archive.getinfo(name + "/SKILL.md").external_attr >> 16, stat.S_IFREG | 0o644)

    def test_missing_sibling_skill_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            skill, release = self.fixture(root)
            shutil.rmtree(Path(root) / SIBLING_SKILLS[0])
            with self.assertRaisesRegex(ValueError, "missing the"):
                package_candidate(skill, release)

    def test_stale_platform_runtime_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            skill, release = self.fixture(root)
            (skill / "bin/tracetoon-linux-x64").write_bytes(b"stale")
            with self.assertRaisesRegex(ValueError, "stale platform"):
                package_candidate(skill, release)

    def test_incomplete_platform_set_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            skill, release = self.fixture(root)
            (skill / "build.json").write_text('{"recipe":{"native":{"targets":["linux-x64"]}}}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "platform set"):
                package_candidate(skill, release)

    @unittest.skipUnless(os.name == "posix", "Unix extraction contract")
    def test_unzip_produces_a_runnable_launcher(self):
        with tempfile.TemporaryDirectory() as root:
            skill, release = self.fixture(root)
            package_candidate(skill, release)
            unzip = shutil.which("unzip")
            self.assertIsNotNone(unzip, "Unix CI must provide unzip")
            destination = Path(root) / "extracted"
            subprocess.run([unzip, "-q", str(release / "tracetoon-skill.zip"), "-d", str(destination)], check=True)
            launcher = destination / "tracetoon/bin/tracetoon"
            self.assertTrue(os.access(launcher, os.X_OK))
            result = subprocess.run([str(launcher)], capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.strip(), "synthetic")


if __name__ == "__main__":
    unittest.main()
