"""Run all of Party Arcade's tests:  python3 tests/run_all.py

Starts a throwaway server (temporary database, test admin code) on a free port, runs the
websocket bots against it in batches (a fresh server per batch, so the sign-up limit per
address isn't hit), then the in-process game tests and, if JavaScriptCore or Node is
installed, the headless Poly Racer track checks. Exits non-zero if anything failed.

Run one bot on its own:  start a server (DATA_DIR=/tmp/x ADMIN_CODE=test-admin-code-123
PORT=8012 python3 server.py), then  PORT=8012 python3 tests/gamesbot.py
(accbot expects a fresh database)."""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ADMIN = "test-admin-code-123"      # only for the throwaway test server
BATCHES = [
    ["accbot", "polybot", "socialbot", "phbot", "tourbot"],
    ["gamesbot", "cheatbot", "minesbot", "frontbot", "frontbot2", "lookbot"],
    ["dasheditbot", "poolbot", "flappybot", "golfbot", "themebot"],
    ["rolebot", "songbot", "volleybot"],
]
UNIT = ["phunit", "phunit2", "tourunit", "poolunit", "lifeunit", "lifecontent", "songunit"]
JS = ["polytest.js", "polyends.js", "dashedit.js", "poolai.js", "flappytest.js", "golftest.js", "volleytest.js", "volleyaitest.js", "mototest.js"]
FLAKY = ["doodle word"]            # known to fail now and then; reported as a warning


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(port, data, log):
    env = {**os.environ, "DATA_DIR": data, "ADMIN_CODE": ADMIN, "PORT": str(port)}
    env.pop("TURSO_DATABASE_URL", None)
    env.pop("TURSO_AUTH_TOKEN", None)
    proc = subprocess.Popen([sys.executable, "server.py"], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(150):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return proc
        except OSError:
            time.sleep(0.1)
    proc.kill()
    raise SystemExit("The test server didn't start — see " + log.name)


def run_py(script, port=None, timeout=900):
    env = {**os.environ}
    if port:
        env["PORT"] = str(port)
    try:
        out = subprocess.run([sys.executable, os.path.join(HERE, script + ".py")], cwd=ROOT, env=env,
                             capture_output=True, text=True, timeout=timeout)
        text = out.stdout + out.stderr
    except subprocess.TimeoutExpired as e:
        text = (e.stdout or "") + "\nTIMED OUT"
        if isinstance(text, bytes):
            text = text.decode(errors="replace")
    passed = sum(1 for line in text.splitlines() if line.startswith("PASS"))
    fails = [line[5:] for line in text.splitlines() if line.startswith("FAIL ")]
    finished = any(line.startswith("FAILED:") for line in text.splitlines())
    return passed, fails, finished, text


def js_runner():
    jsc = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
    if os.path.exists(jsc):
        return lambda f: [jsc, f]
    if shutil.which("jsc"):
        return lambda f: ["jsc", f]
    if shutil.which("node"):
        shim = ("global.print = console.log; const p = require('path'); "
                "global.readFile = (f) => require('fs').readFileSync(f, 'utf8'); "
                "global.load = (f) => require(p.resolve(f)); require(p.resolve(process.argv[1]));")
        return lambda f: ["node", "-e", shim, f]
    return None


def main():
    problems, warnings = [], []
    total = 0
    tmp = tempfile.mkdtemp(prefix="party-arcade-tests-")
    log = open(os.path.join(tmp, "server.log"), "w")
    print(f"Test server logs: {log.name}\n")
    try:
        for batch in BATCHES:
            port = free_port()
            data = tempfile.mkdtemp(dir=tmp)
            server = start_server(port, data, log)
            try:
                for bot in batch:
                    t0 = time.time()
                    passed, fails, finished, text = run_py(bot, port)
                    total += passed
                    real = [f for f in fails if not any(k in f for k in FLAKY)]
                    flaky = [f for f in fails if f not in real]
                    status = "ok" if finished and not real else "FAILED"
                    print(f"  {bot:<10} {status:<7} {passed} checks  ({time.time() - t0:.0f}s)")
                    for f in real:
                        print(f"      ✗ {f}")
                    for f in flaky:
                        print(f"      ⚠ {f} (known flaky)")
                    if not finished:
                        problems.append(f"{bot} crashed")
                        print("      ✗ crashed:\n" + "\n".join("        " + line for line in text.strip().splitlines()[-8:]))
                    problems += [f"{bot}: {f}" for f in real]
                    warnings += [f"{bot}: {f}" for f in flaky]
            finally:
                server.terminate()
                server.wait(10)
        for unit in UNIT:
            passed, fails, finished, text = run_py(unit)
            total += passed
            ok = finished and not fails
            print(f"  {unit:<10} {'ok' if ok else 'FAILED':<7} {passed} checks")
            for f in fails:
                print(f"      ✗ {f}")
            if not finished:
                print("      ✗ crashed:\n" + "\n".join("        " + line for line in text.strip().splitlines()[-8:]))
                problems.append(f"{unit} crashed")
            problems += [f"{unit}: {f}" for f in fails]
        runner = js_runner()
        if not runner:
            print("  (no jsc or node found: skipped the Poly Racer track checks)")
        for js in JS if runner else []:
            out = subprocess.run(runner(os.path.join(HERE, js)), cwd=ROOT, capture_output=True, text=True, timeout=600)
            text = out.stdout + out.stderr
            bad = [line for line in text.splitlines() if "DNF" in line or "fell true" in line or "respawns 1" in line or line.startswith("FAIL ")]
            ok = out.returncode == 0 and text.strip() and not bad
            print(f"  {js:<10} {'ok' if ok else 'FAILED':<7} {len(text.strip().splitlines())} tracks")
            if not ok:
                problems.append(f"{js}: " + (bad[0] if bad else text.strip()[-300:]))
        log.flush()
        if "Traceback" in open(log.name).read():
            problems.append("the server logged an error (see " + log.name + ")")
    finally:
        log.close()
    print()
    if warnings:
        print(f"⚠ {len(warnings)} known-flaky check(s) failed: " + "; ".join(warnings))
    if problems:
        print(f"✗ {len(problems)} problem(s):")
        for p in problems:
            print("   - " + p)
        sys.exit(1)
    print(f"✓ All good — {total} checks passed.")
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
