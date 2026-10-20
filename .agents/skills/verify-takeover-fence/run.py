#!/usr/bin/env python3
"""Check the takeover design and its model-level mutation self-tests."""

import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

VERSION = "1.7.4"
JAR_SHA256 = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
JAR_URL = f"https://github.com/tlaplus/tlaplus/releases/download/v{VERSION}/tla2tools.jar"
SYNC_COMMIT = "d142cf6dd8cbddcda21866cd2a795dd33abdb475"
COVERED_FILES = (
    "packages/core/src/compose.ts",
    "packages/core/src/engine/presence.ts",
    "packages/core/src/drive/execution.ts",
    "packages/core/src/fold/commit.ts",
    "packages/core/src/store/log.ts",
    "packages/core/src/store/refs.ts",
    "packages/host/src/sqlite.ts",
)


def review_notice(root):
    command = ["git", "log", "--oneline", f"{SYNC_COMMIT}..HEAD", "--", *COVERED_FILES]
    print("Coverage review notice, not a gate:", flush=True)
    print(" ".join(command), flush=True)
    try:
        result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            print(result.stdout or "No committed changes in the covered files.", end="\n", flush=True)
        else:
            print(f"History unavailable: {result.stderr.strip()}", flush=True)
    except (OSError, subprocess.SubprocessError) as error:
        print(f"History unavailable: {error}", flush=True)
    print("Also review uncommitted changes. Neither this notice nor TLC reads TypeScript semantics.", flush=True)


def cached_jar():
    cache = Path.home() / ".cache/nyte-verify"
    cache.mkdir(parents=True, exist_ok=True)
    jar = cache / f"tla2tools-{VERSION}.jar"
    if jar.exists():
        if hashlib.sha256(jar.read_bytes()).hexdigest() != JAR_SHA256:
            raise ValueError(f"Checksum mismatch: {jar}. Remove this cache file and retry.")
        return jar
    with tempfile.TemporaryDirectory(prefix="download-", dir=cache) as directory:
        download = Path(directory) / "tla2tools.jar"
        subprocess.run(
            [
                "curl", "--fail", "--location", "--silent", "--show-error",
                "--connect-timeout", "8", "--max-time", "30",
                JAR_URL, "--output", str(download),
            ],
            check=True,
            timeout=35,
        )
        if hashlib.sha256(download.read_bytes()).hexdigest() != JAR_SHA256:
            raise ValueError("Downloaded TLC checksum mismatch; refusing to execute it.")
        download.replace(jar)
    return jar


def check_model(jar, label, append_fence, delete_process, expect_counterexample):
    print(f"\n{label}: AppendProcessFence={append_fence}, DeleteProcessOnClaim={delete_process}", flush=True)
    with tempfile.TemporaryDirectory(prefix="nyte-takeover-fence-") as directory:
        work = Path(directory)
        shutil.copyfile(Path(__file__).with_name("TakeoverFence.tla"), work / "TakeoverFence.tla")
        config = "INIT Init\nNEXT Next\nINVARIANT NoStalePublication\nCHECK_DEADLOCK FALSE\nCONSTANTS\n"
        config += f"  AppendProcessFence = {str(append_fence).upper()}\n"
        config += f"  DeleteProcessOnClaim = {str(delete_process).upper()}\n"
        (work / "TakeoverFence.cfg").write_text(config)
        result = subprocess.run(
            [
                "java", "-Xmx512m", "-XX:+UseParallelGC", "-cp", str(jar), "tlc2.TLC",
                "-workers", "1", "-seed", "1", "-fp", "0", "-cleanup",
                "-config", "TakeoverFence.cfg", "TakeoverFence",
            ],
            cwd=work,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=20,
        )
        print(result.stdout, end="")
    violated = result.returncode != 0 and "Invariant NoStalePublication is violated" in result.stdout
    passed = result.returncode == 0 and "Model checking completed. No error has been found." in result.stdout
    if not violated and not passed:
        print(f"ERROR: {label} did not complete a valid check.", file=sys.stderr)
        return 2
    if expect_counterexample and not violated:
        print(f"FAIL: {label} survived; the model self-test no longer detects this design defect.")
        return 1
    if not expect_counterexample and violated:
        print("FAIL: baseline design violates NoStalePublication. Inspect the counterexample.")
        return 1
    print(f"PASS: {label} " + ("produced the expected model counterexample." if violated else "satisfies the bounded design property."))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    args = parser.parse_args()
    started = time.monotonic()
    review_notice(args.root)
    jar = cached_jar()
    results = [
        check_model(jar, "baseline", True, True, False),
        check_model(jar, "missing publication fence mutant", False, True, True),
        check_model(jar, "missing process revocation mutant", True, False, True),
    ]
    print(f"Elapsed: {time.monotonic() - started:.2f}s", flush=True)
    return max(results)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(2)
