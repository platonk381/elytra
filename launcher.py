"""Elytra 0.3 — Minecraft launcher.
Logic in Python, interface in ui/ (pywebview).
Errors and statuses are sent to the UI as translation keys (see ui/i18n.js).
"""
import os, sys, json, re, time, uuid, gzip, zlib, hmac, base64, shutil, socket, struct, random, secrets, hashlib, zipfile
import webbrowser, tempfile, io, shlex, copy, atexit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading, functools, subprocess
import http.client, urllib.parse, urllib.request, urllib.error, traceback, concurrent.futures

import webview
import minecraft_launcher_lib as mll

VERSION = "0.10.12"

# ============================ SETUP (see SETUP.md) ============================
MS_CLIENT_ID = ""        # Azure «Application (client) ID» — paste it after Mojang approves the app
MS_REDIRECT = "https://login.microsoftonline.com/common/oauth2/nativeclient"
LICENSE_ONLY = True      # once Microsoft login is set up: play only with a licensed account
DISCORD_CLIENT_ID = "1568632716793085972"   # Discord Developer Portal → your app → «Application ID»
UPDATE_REPO = "platonk381/elytra"         # GitHub "user/repo" whose Releases contain Elytra.exe
# ==============================================================================
APPDATA = os.getenv("APPDATA") or os.path.expanduser("~")
BASE = os.path.join(APPDATA, ".elytra")
_OLD = os.path.join(APPDATA, ".mylauncher")  # folder from older versions
if os.path.isdir(_OLD) and not os.path.exists(BASE):
    try:
        os.rename(_OLD, BASE)
    except OSError:
        pass
INST_DIR = os.path.join(BASE, "instances")
CACHE_DIR = os.path.join(BASE, "cache")
DATA_FILE = os.path.join(BASE, "launcher.json")
API = "https://api.modrinth.com/v2"
UA = {"User-Agent": f"Elytra/{VERSION}"}
FOLDERS = {"mod": "mods", "resourcepack": "resourcepacks", "shader": "shaderpacks"}
FOLDER_TYPE = {v: k for k, v in FOLDERS.items()}
THEMES = ("emerald", "aurora")
LANGS = ("en", "ru", "uk", "de", "es")
DEFAULT_SETTINGS = {"nick": "Player", "ram": 4096, "java": "", "snapshots": False, "theme": "emerald",
                    "splash": True, "lang": "en", "auto_backup": True, "backups_keep": 5,
                    "accent": "", "discord": True, "account": "", "onboarded": False, "streamer": False, "navwide": False, "navpos": "bottom", "netsrc": "auto"}
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}

# «Boost FPS»: proven performance mods for each loader (Modrinth slugs)
BOOST_MODS = {
    "fabric": ["sodium", "lithium", "ferrite-core", "entityculling", "immediatelyfast", "modernfix", "dynamic-fps"],
    "quilt": ["sodium", "lithium", "ferrite-core", "entityculling", "immediatelyfast", "modernfix", "dynamic-fps"],
    "forge": ["embeddium", "ferrite-core", "entityculling", "modernfix"],
}
# optimised garbage collector flags (Aikar's flags)
BOOST_JVM = ["-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled", "-XX:MaxGCPauseMillis=200",
             "-XX:+UnlockExperimentalVMOptions", "-XX:+DisableExplicitGC", "-XX:G1NewSizePercent=30",
             "-XX:G1MaxNewSizePercent=40", "-XX:G1HeapRegionSize=8M", "-XX:G1ReservePercent=20",
             "-XX:G1HeapWastePercent=5", "-XX:G1MixedGCCountTarget=4", "-XX:InitiatingHeapOccupancyPercent=15",
             "-XX:G1MixedGCLiveThresholdPercent=90", "-XX:G1RSetUpdatingPauseTimePercent=5",
             "-XX:SurvivorRatio=32", "-XX:+PerfDisableSharedMem", "-XX:MaxTenuringThreshold=1"]
# mod id from logs -> Modrinth slug (when they differ)
MODID_SLUG = {"fabric": "fabric-api", "fabric-api-base": "fabric-api", "cloth-config2": "cloth-config",
              "cloth_config": "cloth-config", "architectury": "architectury-api", "geckolib3": "geckolib",
              "owo": "owo-lib", "yet_another_config_lib_v3": "yacl", "yet-another-config-lib": "yacl",
              "fabric-language-kotlin": "fabric-language-kotlin", "fabriclanguagekotlin": "fabric-language-kotlin",
              "forgeconfigapiport": "forge-config-api-port", "puzzleslib": "puzzles-lib",
              "cardinal-components": "cardinal-components-api", "kotlinforforge": "kotlin-for-forge"}
NOT_MODS = {"minecraft", "java", "fabricloader", "fabric-loader", "forge", "neoforge", "quilt_loader"}

os.makedirs(INST_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)

window = None
lock = threading.RLock()
running = {}       # instance id -> game process
launching = set()  # instances that are being prepared for launch
stopped = set()    # instances closed with the Stop button


class LauncherError(Exception):
    def __init__(self, key, **params):
        super().__init__(key)
        self.key, self.params = key, params


# ---------------- data ----------------
def load_data():
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    d.setdefault("instances", {})
    d.setdefault("servers", [])
    d.setdefault("accounts", [])
    d.setdefault("sets", [])
    d.setdefault("achievements", {})
    d.setdefault("counters", {})
    s = dict(DEFAULT_SETTINGS)
    s.update(d.get("settings", {}))
    d["settings"] = s
    if s.get("theme") not in THEMES:  # old name of the green theme
        s["theme"] = "emerald"
    for i in d["instances"].values():
        if i.get("status") == "installing":
            i["status"] = "broken"
    if d["instances"]:  # people who used older versions don't need the welcome tour
        s["onboarded"] = True
    return d


data = load_data()


def save():
    with lock:
        tmp = DATA_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DATA_FILE)


def resource(path):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, path)


def inst_path(iid):
    return os.path.join(INST_DIR, iid)


def get_inst(iid):
    inst = data["instances"].get(iid)
    if not inst:
        raise LauncherError("err.not_found")
    return inst


def safe_join(root, rel):
    root = os.path.normpath(root)
    p = os.path.normpath(os.path.join(root, rel))
    if p != root and not p.startswith(root + os.sep):
        raise LauncherError("err.bad_path", path=rel)
    return p


def new_id(name):
    base = re.sub(r"[^\w-]+", "-", name, flags=re.UNICODE).strip("-")[:40] or "instance"
    if base.upper() in RESERVED:
        base += "_"
    i, n = base, 2
    while i in data["instances"] or os.path.exists(inst_path(i)):
        i, n = f"{base}-{n}", n + 1
    return i


def system_ram_mb():
    try:
        if os.name == "nt":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("len", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong),
                            ("avail", ctypes.c_ulonglong), ("tpf", ctypes.c_ulonglong), ("apf", ctypes.c_ulonglong),
                            ("tv", ctypes.c_ulonglong), ("av", ctypes.c_ulonglong), ("aev", ctypes.c_ulonglong)]
            m = MS()
            m.len = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return int(m.total // 1048576)
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") // 1048576
    except Exception:
        return 8192


def recommended_ram(modded=True):
    total = system_ram_mb()
    want = 6144 if modded else 3072
    return max(1024, min(want, total // 2 // 512 * 512))


# ---------------- talking to the UI ----------------
def emit(event, payload=None):
    if window is None:
        return
    try:
        window.evaluate_js(
            f"window.onLauncherEvent && window.onLauncherEvent({json.dumps(event)}, {json.dumps(payload)})")
    except Exception:
        pass


def instances_list():
    with lock:
        lst = sorted(data["instances"].values(),
                     key=lambda i: i.get("last_played") or i.get("created", 0), reverse=True)
        return [dict({k: v for k, v in i.items() if k != "lookup_tried"}, running=i["id"] in running, launching=i["id"] in launching, icon=inst_icon(i),
                     content={k: {"project_id": v.get("project_id")} for k, v in i.get("content", {}).items()})
                for i in lst]


def push_instances():
    emit("instances", instances_list())


def toast(key, kind="info", **params):
    emit("toast", {"key": key, "params": params, "kind": kind})


def msg(key, **params):
    return {"key": key, "params": params}


class Task:
    _n = 0

    def __init__(self, key, **params):
        with lock:
            Task._n += 1
            self.id = Task._n
        self.title, self.status, self.value, self.max, self._last = msg(key, **params), "", 0, 0, 0
        self.send()

    def send(self, **extra):
        emit("task", dict(id=self.id, title=self.title, status=self.status,
                          value=self.value, max=self.max, **extra))

    def set_status(self, t):
        self.status = t
        self.send()

    def set_progress(self, v):
        self.value = v
        now = time.time()
        if now - self._last > 0.1:
            self._last = now
            self.send()

    def set_max(self, m):
        self.max, self.value = m, 0
        self.send()

    @property
    def cb(self):
        return {"setStatus": self.set_status, "setProgress": self.set_progress, "setMax": self.set_max}

    def finish(self, result=None, error=None):
        if error is not None:
            self.send(done=True, error=error)
        else:
            if not result:
                message = msg("done.ok")
            elif isinstance(result, dict):
                message = result
            elif isinstance(result, str):
                message = msg(result)
            else:
                message = msg(result[0], **(result[1] if len(result) > 1 and result[1] else {}))
            self.send(done=True, message=message)


def error_msg(e):
    if isinstance(e, LauncherError):
        return msg(e.key, **e.params)
    names = {c.__name__ for c in type(e).__mro__}
    if names & {"URLError", "TimeoutError", "ConnectionError", "ConnectTimeout", "ReadTimeout", "SSLError", "RemoteDisconnected", "IncompleteRead", "ChunkedEncodingError"}:
        m = re.search(r"https?://([^/\s'\"]+)", str(e)) or re.search(r"host='([^']+)'", str(e))
        return msg("err.network", host=m.group(1) if m else "?")
    return msg("err.generic", msg=f"{type(e).__name__}: {e}")


def run_task(key, params, fn, *args):
    def worker():
        task = Task(key, **params)
        try:
            task.finish(fn(task, *args))
        except Exception as e:
            log(f"task {key} failed:\n" + traceback.format_exc())
            task.finish(error=error_msg(e))
        push_instances()
        if key in ("task.install", "task.modpack", "task.import", "task.create", "task.apply_set"):
            check_achievements()
    threading.Thread(target=worker, daemon=True).start()


# ---------------- network ----------------
# Some networks (and whole countries) throttle Cloudflare / Mojang CDNs: the TLS handshake works,
# then the transfer freezes. Elytra probes each source at start-up and, for those that stall, transparently
# uses public mirrors: BMCLAPI for Mojang / Fabric / Forge / Quilt / NeoForge and MCIM for Modrinth.
BMCL = "https://bmclapi2.bangbang93.com"
MCIM = "https://mod.mcimirror.top"
NET_GROUPS = {   # group -> [(official prefix, mirror prefix)], probe URL
    "modrinth": ([("https://api.modrinth.com", MCIM + "/modrinth"), ("https://cdn.modrinth.com", MCIM)],
                 "https://api.modrinth.com/v2/search?limit=60"),
    "mojang": ([("https://piston-meta.mojang.com", BMCL), ("https://launchermeta.mojang.com", BMCL),
                ("https://piston-data.mojang.com", BMCL), ("https://launcher.mojang.com", BMCL),
                ("https://libraries.minecraft.net", BMCL + "/maven")],
               "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"),
    "assets": ([("https://resources.download.minecraft.net", BMCL + "/assets")],
               lambda: asset_probe_url()),
    "fabric": ([("https://meta.fabricmc.net", BMCL + "/fabric-meta"), ("https://maven.fabricmc.net", BMCL + "/maven")],
               "https://meta.fabricmc.net/v2/versions/game"),
    "quilt": ([("https://meta.quiltmc.org", BMCL + "/quilt-meta"), ("https://maven.quiltmc.org/repository/release", BMCL + "/maven")],
              "https://meta.quiltmc.org/v3/versions/game"),
    "forge": ([("https://maven.minecraftforge.net", BMCL + "/maven"), ("https://files.minecraftforge.net/maven", BMCL + "/maven"),
               ("https://maven.neoforged.net/releases", BMCL + "/maven")],
              "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"),
}
NET = {g: None for g in NET_GROUPS}      # None = not probed yet, "official", "mirror", "down"
NET_READY = {g: threading.Event() for g in NET_GROUPS}
BAD_STATUS = {403, 429, 451, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526}


def asset_probe_url():
    """A real, reasonably large asset object of the latest release."""
    man = http_json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", 15)
    vj = http_json(next(v for v in man["versions"] if v["id"] == man["latest"]["release"])["url"], 15)
    idx = http_json(vj["assetIndex"]["url"], 20)
    o = next(o for o in idx["objects"].values() if 150_000 < o.get("size", 0) < 600_000)
    return f"https://resources.download.minecraft.net/{o['hash'][:2]}/{o['hash']}"


def net_group(url):
    for g, (pairs, _) in NET_GROUPS.items():
        for off, mir in pairs:
            if url.startswith(off + "/") or url == off:
                return g, off, mir
    return None, None, None


def url_candidates(url, wait=True):
    """Official URL and its mirror, in the order they should be tried."""
    g, off, mir = net_group(url)
    if not g:
        return [url]
    mirror = mir + url[len(off):]
    mode = data["settings"].get("netsrc", "auto")
    if mode == "official":
        return [url]
    if mode == "mirror":
        return [mirror, url]
    if wait:
        NET_READY[g].wait(10)
    return [mirror, url] if NET[g] == "mirror" else [url, mirror]


def mark_mirror(url):
    g, _, _ = net_group(url)
    if g and NET[g] != "mirror" and data["settings"].get("netsrc", "auto") == "auto":
        NET[g] = "mirror"
        log(f"net: {g} -> mirror (official failed: {url[:80]})")


def open_url(url, timeout=30, data_=None, headers=None, method=None, read=False):
    """urlopen with mirror fallback. Returns an open response, or the body bytes with read=True
    (then a transfer that freezes half-way also falls back to the mirror)."""
    last = None
    cands = url_candidates(url)
    for n, u in enumerate(cands):
        req = urllib.request.Request(u, data=data_, method=method, headers={**UA, **(headers or {})})
        try:
            r = urllib.request.urlopen(req, timeout=timeout)
            if read:
                with r:
                    body = r.read()
            if n and u != url:
                mark_mirror(url)
            return body if read else r
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404 and n == len(cands) - 1:
                raise
            if e.code not in BAD_STATUS and e.code != 404:
                raise
        except (urllib.error.URLError, OSError, http.client.HTTPException) as e:   # timeouts, resets, TLS, DNS, cut-offs
            last = e
        if n == 0 and len(cands) > 1 and u == url:
            mark_mirror(url)
    raise last


def read_all(r, limit=None):
    with r:
        return r.read() if limit is None else r.read(limit)


def http_json(url, timeout=20):
    return json.loads(open_url(url, timeout, read=True))


def http_post_json(url, payload):
    return json.loads(open_url(url, 30, json.dumps(payload).encode(), {"Content-Type": "application/json"}, "POST", read=True))


def api(path, params=None):
    return http_json(API + path + ("?" + urllib.parse.urlencode(params) if params else ""))


_tls = threading.local()


def _session():
    """One keep-alive HTTP session per download thread: thousands of small files don't each pay
    for a new TLS handshake (this is most of the speed-up for game assets)."""
    sess = getattr(_tls, "sess", None)
    if sess is None:
        try:
            import requests
            from requests.adapters import HTTPAdapter
            sess = requests.Session()
            sess.headers.update(UA)
            sess.mount("https://", HTTPAdapter(pool_connections=8, pool_maxsize=8, max_retries=0))
        except ImportError:
            sess = False
        _tls.sess = sess
    return sess


def _fetch_to(url, f, h):
    sess = _session()
    if sess:
        with sess.get(url, stream=True, timeout=(10, 30)) as r:   # the patched Session.request adds mirror fallback
            if r.status_code >= 400:
                raise urllib.error.HTTPError(url, r.status_code, r.reason, r.headers, None)
            for chunk in r.iter_content(65536):
                h.update(chunk)
                f.write(chunk)
        return
    with open_url(url, 40) as r:
        while chunk := r.read(65536):
            h.update(chunk)
            f.write(chunk)


def download(url, dest, sha1=None, tries=3):
    if not url.startswith("https://"):
        raise LauncherError("err.unsafe_url", url=url)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + f".{threading.get_ident()}.part"
    for attempt in range(tries):
        h = hashlib.sha1()
        try:
            with open(tmp, "wb") as f:
                _fetch_to(url, f, h)
        except Exception:
            if attempt == tries - 1:
                if os.path.exists(tmp):
                    os.remove(tmp)
                raise
            mark_mirror(url)
            time.sleep(0.5 + attempt)
            continue
        if sha1 and h.hexdigest() != sha1:
            os.remove(tmp)
            if attempt == tries - 1:
                raise LauncherError("err.corrupt", file=os.path.basename(dest))
            continue
        os.replace(tmp, dest)
        return


def probe_network():
    """Runs once at start-up: decides official vs mirror for every source group."""
    def one(g):
        try:
            mode = data["settings"].get("netsrc", "auto")
            if mode != "auto":
                NET[g] = "official" if mode == "official" else "mirror"
                return
            pairs, url = NET_GROUPS[g]
            if callable(url):
                try:
                    url = url()
                except Exception as e:
                    log(f"net probe {g}: no probe url ({e!r})")
                    NET[g] = "unknown"
                    return

            def fetch(u):
                t0 = time.time()
                with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=6) as r:
                    got = 0
                    while got < 150_000 and (chunk := r.read(16384)):
                        got += len(chunk)
                        if time.time() - t0 > 8:
                            raise TimeoutError("too slow")
                return time.time() - t0
            off, mir = pairs[0]
            res = {}

            def timed(kind, u):
                try:
                    res[kind] = fetch(u)
                except Exception as e:
                    res[kind] = e
            ts = [threading.Thread(target=timed, args=("off", url), daemon=True),
                  threading.Thread(target=timed, args=("mir", mir + url[len(off):]), daemon=True)]
            for t_ in ts:
                t_.start()
            for t_ in ts:
                t_.join(16)
            o, m = res.get("off"), res.get("mir")
            o_ok, m_ok = isinstance(o, float), isinstance(m, float)
            if o_ok and (not m_ok or o <= m * 2.5):     # official unless the mirror is much faster
                NET[g] = "official"
            elif m_ok:
                NET[g] = "mirror"
            else:
                NET[g] = "down"
            log(f"net probe {g}: official={o if o_ok else type(o).__name__} mirror={m if m_ok else type(m).__name__} -> {NET[g]}")
        finally:
            NET_READY[g].set()
            emit("net", net_status())
    for g in NET_GROUPS:
        threading.Thread(target=one, args=(g,), daemon=True).start()


def net_status():
    return {g: NET[g] for g in NET_GROUPS}


def patch_requests():
    """minecraft-launcher-lib downloads with `requests`: route it through the same mirrors."""
    try:
        import requests
    except ImportError:
        return
    if getattr(requests.Session.request, "_elytra", False):
        return
    orig = requests.Session.request

    def request(self, method, url, *a, **kw):
        kw.setdefault("timeout", (10, 40))
        cands = url_candidates(url) if isinstance(url, str) else [url]
        last = None
        for n, u in enumerate(cands):
            try:
                r = orig(self, method, u, *a, **kw)
                if r.status_code in BAD_STATUS and n < len(cands) - 1:
                    last = requests.HTTPError(f"{r.status_code} {u}")
                    if u == url:
                        mark_mirror(url)
                    continue
                if n and u != url:
                    mark_mirror(url)
                return r
            except (requests.ConnectionError, requests.Timeout) as e:
                last = e
                if u == url and len(cands) > 1:
                    mark_mirror(url)
        raise last
    request._elytra = True
    requests.Session.request = request


# ---------------- log ----------------
_log_lock = threading.Lock()


def log(text):
    try:
        path = os.path.join(BASE, "elytra.log")
        with _log_lock:
            if os.path.exists(path) and os.path.getsize(path) > 2_000_000:
                os.replace(path, path + ".old")
            with open(path, "a", encoding="utf-8") as f:
                f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + text.rstrip() + "\n")
    except Exception:
        pass


def mask_home(s):
    home = os.path.expanduser("~")
    s = s.replace(home, "~") if home and len(home) > 3 else s
    return re.sub(r"(?i)(\\Users\\|/home/)[^\\/\s]+", r"\1<user>", s)


def build_report(lines=60):
    out = [f"Elytra {VERSION}", f"OS: {_platform.platform()} ({ARCH})",
           f"Installed: {'yes' if is_installed() else 'portable'}",
           "Net: " + ", ".join(f"{g}={v or '?'}" for g, v in net_status().items())]
    try:
        st = data.get("settings", {})
        out.append(f"Settings: netsrc={st.get('netsrc', 'auto')} ram={st.get('ram', '?')} java={'custom' if st.get('java') else 'auto'}")
        insts = list(data.get("instances", {}).values())
        out.append(f"Instances: {len(insts)}")
        for i in insts[:12]:
            out.append(f"  - {i.get('mc', '?')} {i.get('loader', '?')} mods={len(i.get('content', {}).get('mod', []) if isinstance(i.get('content'), dict) else i.get('mods', []) or [])} state={i.get('state', 'ok')}")
    except Exception as e:
        out.append(f"(instances: {type(e).__name__})")
    out.append("--- log ---")
    try:
        with open(os.path.join(BASE, "elytra.log"), encoding="utf-8", errors="replace") as f:
            out += [l.rstrip() for l in f.readlines()[-lines:]]
    except OSError:
        out.append("(no log)")
    return mask_home("\n".join(out))


# ---------------- support chat ----------------
# Messages go through ntfy.sh (no account needed). What a player writes is encrypted for the developer's
# key (X25519 + HMAC-SHA256), so only the developer's inbox page (docs/inbox.html) can read it.
# Replies come back on the player's own secret topic "elytra-r-<tid>".
SUPPORT_CFG = f"https://{UPDATE_REPO.split('/')[0]}.github.io/{UPDATE_REPO.split('/')[1]}/support.json"
_support = {"cfg": None, "checked": 0}

P25519 = 2 ** 255 - 19


def _x25519(k, u):
    P = P25519
    k = bytearray(k); k[0] &= 248; k[31] &= 127; k[31] |= 64
    k = int.from_bytes(k, "little"); u = int.from_bytes(u, "little") & ((1 << 255) - 1)
    x1, x2, z2, x3, z3, sw = u, 1, 0, u, 1, 0
    for t in range(254, -1, -1):
        b = (k >> t) & 1
        sw ^= b
        if sw:
            x2, x3, z2, z3 = x3, x2, z3, z2
        sw = b
        A = (x2 + z2) % P; AA = A * A % P; B = (x2 - z2) % P; BB = B * B % P; E = (AA - BB) % P
        C = (x3 + z3) % P; D = (x3 - z3) % P; DA = D * A % P; CB = C * B % P
        x3 = (DA + CB) ** 2 % P; z3 = x1 * (DA - CB) ** 2 % P; x2 = AA * BB % P; z2 = E * (AA + 121665 * E) % P
    if sw:
        x2, x3, z2, z3 = x3, x2, z3, z2
    return (x2 * pow(z2, P - 2, P) % P).to_bytes(32, "little")


def box_pub(priv):
    return _x25519(priv, (9).to_bytes(32, "little"))


def _box_keys(shared, epub, apub):
    k = hashlib.sha256(b"elytra-box-1" + shared + epub + apub).digest()
    return hmac.new(k, b"enc", hashlib.sha256).digest(), hmac.new(k, b"mac", hashlib.sha256).digest()


def _box_stream(key, nonce, n):
    out, i = bytearray(), 0
    while len(out) < n:
        out += hmac.new(key, nonce + i.to_bytes(4, "big"), hashlib.sha256).digest()
        i += 1
    return bytes(out[:n])


def box_seal(obj, apub):
    """Encrypt a JSON object for the developer's public key (same format as BOX.open in docs/inbox.html)."""
    plain = zlib.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), 9)
    eph = os.urandom(32)
    epub = box_pub(eph)
    ek, mk = _box_keys(_x25519(eph, apub), epub, apub)
    nonce = os.urandom(16)
    ct = bytes(a ^ b for a, b in zip(plain, _box_stream(ek, nonce, len(plain))))
    tag = hmac.new(mk, nonce + ct, hashlib.sha256).digest()[:16]
    return "E1." + base64.urlsafe_b64encode(epub + nonce + tag + ct).decode().rstrip("=")


def box_open(s, apriv):
    raw = base64.urlsafe_b64decode(s[3:] + "=" * (-len(s[3:]) % 4))
    epub, nonce, tag, ct = raw[:32], raw[32:48], raw[48:64], raw[64:]
    apub = box_pub(apriv)
    ek, mk = _box_keys(_x25519(apriv, epub), epub, apub)
    if not hmac.compare_digest(hmac.new(mk, nonce + ct, hashlib.sha256).digest()[:16], tag):
        raise ValueError("bad tag")
    return json.loads(zlib.decompress(bytes(a ^ b for a, b in zip(ct, _box_stream(ek, nonce, len(ct))))))


def support_cfg():
    """{ntfy, inbox, pub} from the website, so the developer can change it without a release."""
    if _support["cfg"] is not None and time.time() - _support["checked"] < 3600:
        return _support["cfg"]
    cfg = {}
    try:
        c = json.loads(open_url(SUPPORT_CFG, timeout=10, read=True).decode("utf-8"))
        if str(c.get("ntfy", "")).startswith("https://") and re.fullmatch(r"[\w-]{8,64}", str(c.get("inbox", ""))) \
                and re.fullmatch(r"[0-9a-f]{64}", str(c.get("pub", ""))):
            cfg = {"ntfy": c["ntfy"].rstrip("/"), "inbox": c["inbox"], "pub": bytes.fromhex(c["pub"])}
    except Exception as e:
        log(f"support cfg: {type(e).__name__}: {e}")
        if _support["cfg"]:
            return _support["cfg"]
    _support.update(cfg=cfg, checked=time.time())
    return cfg


def support_state():
    with lock:
        s = data.setdefault("support", {})
        if not s.get("tid"):
            s.update(tid=secrets.token_hex(16), msgs=[], seen=0, since="all")
            save()
        return s


def support_http(url, body=None, headers=None):
    try:
        req = urllib.request.Request(url, data=body.encode("utf-8") if body is not None else None,
                                     headers={**UA, **(headers or {})}, method="POST" if body is not None else "GET")
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raise LauncherError("sup.rate" if e.code == 429 else "sup.fail", err=f"HTTP {e.code}")
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise LauncherError("sup.fail", err=type(e).__name__)


def support_publish(obj):
    cfg = support_cfg()
    if not cfg:
        raise LauncherError("sup.off")
    sealed = box_seal(obj, cfg["pub"])
    support_http(f"{cfg['ntfy']}/{cfg['inbox']}", sealed, {"Title": "Elytra: new support message", "Tags": "speech_balloon"})
    return sealed


def support_fit(obj):
    """ntfy keeps messages up to 4 KB: drop the oldest report lines until the sealed message fits."""
    cfg = support_cfg()
    while len(box_seal(obj, cfg["pub"])) > 3900:
        rep = obj.get("rep", "")
        if not rep:
            raise LauncherError("sup.long")
        lines = rep.split("\n")
        obj["rep"] = "\n".join(lines[:6] + lines[6 + max(1, len(lines) // 5):]) if len(lines) > 8 else ""
    return obj


def support_poll():
    """Fetch replies/acks from our topic, ack replies, resend our messages the developer hasn't seen. Returns new reply count."""
    cfg = support_cfg()
    if not cfg:
        return 0
    st = support_state()
    raw = support_http(f"{cfg['ntfy']}/elytra-r-{st['tid']}/json?poll=1&since={st.get('since') or 'all'}")
    new, ack_ids, last = 0, [], None
    with lock:
        have = {m.get("id") for m in st["msgs"]}
        for line in raw.splitlines():
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("event") != "message":
                continue
            last = ev.get("id") or last
            try:
                m = json.loads(ev.get("message") or "{}")
            except ValueError:
                continue
            if m.get("t") == "reply" and m.get("id") and m["id"] not in have:
                st["msgs"].append({"id": str(m["id"])[:32], "from": "dev", "text": str(m.get("text", ""))[:4000], "ts": int(m.get("ts") or time.time())})
                have.add(m["id"]); new += 1
            if m.get("t") == "reply" and m.get("id"):
                ack_ids.append(str(m["id"])[:32])
            if m.get("t") == "ack":
                for x in st["msgs"]:
                    if x.get("from") == "me" and x.get("id") in (m.get("ids") or []):
                        x["acked"] = True
        if last:
            st["since"] = last
        st["msgs"].sort(key=lambda x: x.get("ts", 0))
        st["msgs"] = st["msgs"][-200:]
        save()
    if ack_ids:
        try:
            support_publish({"t": "ack", "tid": st["tid"], "ids": ack_ids[-50:]})
        except LauncherError:
            pass
    now = time.time()
    for x in list(st["msgs"]):     # the developer's inbox only keeps messages ~12 h: resend unseen ones
        if x.get("from") == "me" and not x.get("acked") and now - x.get("sent_at", 0) > 5 * 3600 and now - x.get("ts", 0) < 4 * 86400:
            try:
                support_publish(support_fit({"t": "msg", "tid": st["tid"], "id": x["id"], "text": x["text"], "ts": x["ts"],
                                             "name": x.get("name", ""), "ver": VERSION, "rep": x.get("rep", "")}))
                with lock:
                    x["sent_at"] = now
                    save()
            except LauncherError:
                break
    return new


def support_public(st):
    return [{k: m.get(k) for k in ("id", "from", "text", "ts", "acked")} for m in st.get("msgs", [])]


def support_unread():
    s = data.get("support") or {}
    return sum(1 for m in s.get("msgs", []) if m.get("from") == "dev" and m.get("ts", 0) > s.get("seen", 0))


def support_poller():
    """While a conversation is recent, check for replies every minute and tell the UI."""
    while True:
        time.sleep(60)
        try:
            s = data.get("support") or {}
            msgs = s.get("msgs") or []
            if not msgs or time.time() - max(m.get("ts", 0) for m in msgs) > 14 * 86400:
                continue
            if support_poll():
                emit("support", {"msgs": support_public(data["support"]), "unread": support_unread(), "new": True})
        except Exception:
            pass


def copy_text(text):
    try:
        if os.name == "nt":
            subprocess.run(["clip"], input=text.encode("utf-16-le"), check=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=5)
            return True
    except Exception:
        pass
    return False


def harden_webview():
    """pywebview adds the WebView2 loader folders of every CPU type to PATH and stops with
    'Cannot find win-arm64' if one is missing (e.g. after an interrupted update). Only the
    folder for our own CPU matters, so skip the others instead of crashing."""
    try:
        import webview.util as wu
        orig = wu.interop_dll_path
        if getattr(orig, "_elytra", False):
            return

        def safe(name):
            try:
                return orig(name)
            except FileNotFoundError:
                if str(name).startswith("win-"):
                    log(f"webview runtime {name} missing, skipped")
                    return tempfile.gettempdir()
                raise
        safe._elytra = True
        wu.interop_dll_path = safe
    except Exception as e:
        log(f"harden_webview: {type(e).__name__}: {e}")


def file_hashes(path):
    h1, h5 = hashlib.sha1(), hashlib.sha512()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h1.update(chunk)
            h5.update(chunk)
    return h1.hexdigest(), h5.hexdigest()


def file_dialog(kind, **kw):
    fd = getattr(webview, "FileDialog", None)
    t = getattr(fd, kind) if fd else getattr(webview, kind + "_DIALOG")
    res = window.create_file_dialog(t, **kw)
    if not res:
        return None
    return res[0] if isinstance(res, (list, tuple)) else res


# ---------------- avatars ----------------
IMG_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}
MAX_IMG = 4 * 1024 * 1024
_icon_cache = {}


def image_data_url(path):
    ext = os.path.splitext(path)[1].lower()
    if ext not in IMG_TYPES:
        raise LauncherError("err.image_type")
    if os.path.getsize(path) > MAX_IMG:
        raise LauncherError("err.image_size")
    key = (path, os.path.getmtime(path))
    if key not in _icon_cache:
        with open(path, "rb") as f:
            _icon_cache[key] = f"data:{IMG_TYPES[ext]};base64," + base64.b64encode(f.read()).decode()
    return _icon_cache[key]


def inst_icon(i):
    if i.get("icon_file"):
        try:
            return image_data_url(os.path.join(inst_path(i["id"]), i["icon_file"]))
        except Exception:
            pass
    return i.get("icon")


def apply_icon(iid, src):
    inst, root = get_inst(iid), inst_path(iid)
    for ext in IMG_TYPES:
        old = os.path.join(root, "icon" + ext)
        if os.path.exists(old):
            os.remove(old)
    inst.pop("icon_file", None)
    if src:
        image_data_url(src)
        name = "icon" + os.path.splitext(src)[1].lower()
        shutil.copyfile(src, os.path.join(root, name))
        inst["icon_file"] = name
    save()


# ---------------- fast, parallel game download ----------------
# minecraft-launcher-lib downloads thousands of small files one after another. Elytra fetches them first in
# 16 parallel streams (through the mirrors if needed); the library then only verifies what is already there.
import platform as _platform
OS_NAME = {"win32": "windows", "darwin": "osx"}.get(sys.platform, "linux")
ARCH = _platform.machine().lower()
JRE_PLATFORM = {"windows": "windows-arm64" if ARCH in ("arm64", "aarch64") else ("windows-x64" if sys.maxsize > 2**32 else "windows-x86"),
                "linux": "linux" if ARCH in ("x86_64", "amd64") else None, "osx": None}[OS_NAME]
PARALLEL = 24


def rules_ok(rules):
    if not rules:
        return True
    allow = False
    for r in rules:
        osr, ok = r.get("os") or {}, True
        if osr.get("name") and osr["name"] != OS_NAME:
            ok = False
        if osr.get("arch") == "x86" and sys.maxsize > 2**32:
            ok = False
        if r.get("features"):
            ok = False
        if ok:
            allow = r.get("action") == "allow"
    return allow


def maven_path(name):
    parts = name.split(":")
    group, art, ver = parts[0], parts[1], parts[2]
    ext = "jar"
    if "@" in parts[-1]:
        parts[-1], ext = parts[-1].split("@", 1)
        ver = parts[2]
    cls = f"-{parts[3]}" if len(parts) > 3 else ""
    return "/".join(group.split(".") + [art, ver, f"{art}-{ver}{cls}.{ext}"])


def file_ok(dest, size=None):
    return os.path.isfile(dest) and (size is None or os.path.getsize(dest) == size)


def parallel_download(task, jobs):
    """jobs: (url, dest, sha1, size). Already present files are skipped."""
    seen, todo = set(), []
    for j in jobs:
        if j[1] not in seen and not file_ok(j[1], j[3]):
            seen.add(j[1])
            todo.append(j)
    if not todo:
        return 0
    t0 = time.time()
    task.set_status(msg("st.fetch", n=len(todo)))
    task.set_max(len(todo))
    errors, done = [], 0
    with concurrent.futures.ThreadPoolExecutor(PARALLEL) as ex:
        futs = [ex.submit(download, u, d, s) for u, d, s, _ in todo]
        for f in concurrent.futures.as_completed(futs):
            try:
                f.result()
            except Exception as e:
                errors.append(e)
            done += 1
            task.set_progress(done)
    log(f"parallel download: {len(todo)} files in {time.time() - t0:.0f}s, groups: {net_status()}")
    if errors:
        log(f"parallel download: {len(errors)} of {len(todo)} failed, first: {errors[0]!r}")
        if len(errors) > len(todo) // 2:
            raise errors[0]
    # a few failures are fine: minecraft-launcher-lib will fetch the rest itself
    return len(errors)


def lib_jobs(libs, default_repo="https://libraries.minecraft.net/"):
    jobs = []
    for lib in libs:
        if not rules_ok(lib.get("rules")):
            continue
        dl = lib.get("downloads") or {}
        art = dl.get("artifact")
        if art and art.get("url") and art.get("path"):
            jobs.append((art["url"], os.path.join(BASE, "libraries", *art["path"].split("/")), art.get("sha1"), art.get("size")))
        elif not dl and lib.get("name"):
            p = maven_path(lib["name"])
            repo = (lib.get("url") or default_repo).rstrip("/")
            jobs.append((f"{repo}/{p}", os.path.join(BASE, "libraries", *p.split("/")), lib.get("sha1"), lib.get("size")))
        nat = (lib.get("natives") or {}).get(OS_NAME)
        if nat:
            c = (dl.get("classifiers") or {}).get(nat.replace("${arch}", "64" if sys.maxsize > 2**32 else "32"))
            if c and c.get("url"):
                jobs.append((c["url"], os.path.join(BASE, "libraries", *c["path"].split("/")), c.get("sha1"), c.get("size")))
    return jobs


def prefetch_vanilla(mc, task):
    """Returns True when everything the game needs is on disk (so the slow library re-check can be skipped)."""
    try:
        task.set_status(msg("st.prepare", mc=mc))
        vdir = os.path.join(BASE, "versions", mc)
        vfile = os.path.join(vdir, f"{mc}.json")
        if os.path.isfile(vfile):
            with open(vfile, encoding="utf-8") as f:
                vj = json.load(f)
        else:
            man = http_json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
            entry = next((v for v in man["versions"] if v["id"] == mc), None)
            if not entry:
                return
            vj = http_json(entry["url"])
            os.makedirs(vdir, exist_ok=True)
            with open(vfile, "w", encoding="utf-8") as f:
                json.dump(vj, f)
        jobs = lib_jobs(vj.get("libraries", []))
        cl = (vj.get("downloads") or {}).get("client")
        if cl:
            jobs.append((cl["url"], os.path.join(vdir, f"{mc}.jar"), cl.get("sha1"), cl.get("size")))
        ai = vj.get("assetIndex")
        if ai:
            ipath = os.path.join(BASE, "assets", "indexes", f"{ai['id']}.json")
            if not file_ok(ipath, ai.get("size")):
                download(ai["url"], ipath, ai.get("sha1"))
            with open(ipath, encoding="utf-8") as f:
                objs = json.load(f).get("objects", {})
            for o in objs.values():
                h = o["hash"]
                jobs.append((f"https://resources.download.minecraft.net/{h[:2]}/{h}",
                             os.path.join(BASE, "assets", "objects", h[:2], h), h, o.get("size")))
        rt = runtime_jobs(vj)
        jobs += rt
        failed = parallel_download(task, jobs)
        legacy = any((lib.get("natives") or {}) for lib in vj.get("libraries", [])) or \
            (ai or {}).get("id") in ("legacy", "pre-1.6") or not cl
        need_rt = bool((vj.get("javaVersion") or {}).get("component")) and not data["settings"].get("java")
        return not failed and not legacy and (bool(rt) or not need_rt)
    except LauncherError:
        raise
    except Exception:
        log("prefetch failed, falling back to the normal installer:\n" + traceback.format_exc())
    return False


def runtime_jobs(vj):
    comp = (vj.get("javaVersion") or {}).get("component")
    if not comp or not JRE_PLATFORM or data["settings"].get("java"):
        return []
    try:
        allj = http_json("https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json")
        entry = (allj.get(JRE_PLATFORM, {}).get(comp) or [None])[0]
        if not entry:
            return []
        man = http_json(entry["manifest"]["url"])
        root = os.path.join(BASE, "runtime", comp, JRE_PLATFORM, comp)
        out = []
        for rel, f in man.get("files", {}).items():
            raw = (f.get("downloads") or {}).get("raw")
            if f.get("type") == "file" and raw:
                out.append((raw["url"], os.path.join(root, *rel.split("/")), raw.get("sha1"), raw.get("size")))
        return out
    except Exception:
        log("runtime prefetch skipped:\n" + traceback.format_exc())
        return []


LOADER_META = {"fabric": ("https://meta.fabricmc.net/v2", "https://maven.fabricmc.net/"),
               "quilt": ("https://meta.quiltmc.org/v3", "https://maven.quiltmc.org/repository/release/")}


def latest_loader(kind, mc):
    meta = LOADER_META[kind][0]
    lst = http_json(f"{meta}/versions/loader/{urllib.parse.quote(mc)}")
    if not lst:
        raise LauncherError("err.loader_no_mc", loader=kind.capitalize(), mc=mc)
    stable = [x for x in lst if x["loader"].get("stable", "beta" not in x["loader"]["version"])]
    return (stable or lst)[0]["loader"]["version"]


def install_fabric_like(kind, mc, lv, task, full=False):
    """Fabric/Quilt without their Java installer: write the profile JSON and fetch libraries in parallel."""
    meta, repo = LOADER_META[kind]
    lv = lv or latest_loader(kind, mc)
    task.set_status(msg("st.prepare", mc=f"{kind.capitalize()} {lv}"))
    prof = http_json(f"{meta}/versions/loader/{urllib.parse.quote(mc)}/{urllib.parse.quote(lv)}/profile/json")
    vid = prof["id"]
    vdir = os.path.join(BASE, "versions", vid)
    os.makedirs(vdir, exist_ok=True)
    with open(os.path.join(vdir, f"{vid}.json"), "w", encoding="utf-8") as f:
        json.dump(prof, f, indent=1)
    complete = prefetch_vanilla(mc, task)
    failed = parallel_download(task, lib_jobs(prof.get("libraries", []), repo))
    if full or not complete or failed:
        mll.install.install_minecraft_version(vid, BASE, callback=task.cb)
    ensure_version_jar(vid)
    return vid, lv


# ---------------- game installation ----------------
def ensure_version_jar(vid):
    """A loader version (Fabric/Quilt/Forge) is launched with versions/<id>/<id>.jar, a copy of the vanilla
    game jar. Without it Fabric stops with 'Knot.createGameProvider' (it can't find Minecraft)."""
    try:
        vdir = os.path.join(BASE, "versions", vid)
        with open(os.path.join(vdir, f"{vid}.json"), encoding="utf-8") as f:
            vj = json.load(f)
        parent = vj.get("inheritsFrom")
        if not parent or vj.get("jar"):
            return
        own, src = os.path.join(vdir, f"{vid}.jar"), os.path.join(BASE, "versions", parent, f"{parent}.jar")
        if not os.path.isfile(src):
            return
        if os.path.isfile(own) and os.path.getsize(own) == os.path.getsize(src):
            return
        tmp = own + ".tmp"
        shutil.copyfile(src, tmp)
        os.replace(tmp, own)
        log(f"restored game jar for {vid}")
    except Exception as e:
        log(f"ensure_version_jar {vid}: {type(e).__name__}: {e}")


_skip_tl = threading.local()


def _install_skip_hooks():
    """Wrap minecraft-launcher-lib's version/asset installers so one thread can skip re-checking a
    vanilla version it has just verified. Other threads are unaffected."""
    if getattr(mll.install, "_elytra_hooks", False):
        return
    orig_imv, orig_assets = mll.install.install_minecraft_version, mll.install.install_assets

    def imv(version, minecraft_directory, callback=None):
        if getattr(_skip_tl, "mc", None) == version:
            return
        return orig_imv(version, minecraft_directory, callback=callback)

    def assets(versiondata, *a, **kw):
        mc = getattr(_skip_tl, "mc", None)
        if mc and mc in (versiondata.get("id"), versiondata.get("inheritsFrom")):
            return
        return orig_assets(versiondata, *a, **kw)
    mll.install.install_minecraft_version = imv
    mll.install.install_assets = assets
    if hasattr(mll, "forge") and hasattr(mll.forge, "install_minecraft_version"):
        mll.forge.install_minecraft_version = imv
    mll.install._elytra_hooks = True


class skip_vanilla_checks:
    def __init__(self, mc):
        self.mc = mc

    def __enter__(self):
        if self.mc:
            try:
                _install_skip_hooks()
            except Exception as e:
                log(f"skip hooks: {type(e).__name__}: {e}")
            _skip_tl.mc = self.mc

    def __exit__(self, *exc):
        _skip_tl.mc = None


def prefetch_forge(fv, task):
    """Download Forge's libraries in parallel first; the installer then finds them and only checks hashes."""
    try:
        task.set_status(msg("st.prepare", mc=f"Forge {fv}"))
        body = open_url(f"https://maven.minecraftforge.net/net/minecraftforge/forge/{fv}/forge-{fv}-installer.jar", timeout=60, read=True)
        libs = []
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            for name in ("install_profile.json", "version.json"):
                try:
                    libs += json.loads(zf.read(name)).get("libraries", [])
                except KeyError:
                    pass
        jobs = [j for j in lib_jobs(libs, "https://maven.minecraftforge.net/") if j[0].startswith("https://")]
        if jobs:
            parallel_download(task, jobs)
    except Exception as e:
        log(f"forge prefetch skipped: {type(e).__name__}: {e}")


def forge_java(mc):
    if data["settings"]["java"]:
        return data["settings"]["java"]
    try:
        info = mll.runtime.get_version_runtime_information(mc, BASE)
        return mll.runtime.get_executable_path(info["name"], BASE)
    except Exception:
        return None


def install_loader(mc, loader, lv, task, full=False):
    if loader == "vanilla":
        if not prefetch_vanilla(mc, task) or full:
            mll.install.install_minecraft_version(mc, BASE, callback=task.cb)
        return mc, None
    if loader in ("fabric", "quilt"):
        try:
            return install_fabric_like(loader, mc, lv, task, full)
        except LauncherError:
            raise
        except Exception:
            log(f"own {loader} install failed, trying the official installer:\n" + traceback.format_exc())
        if loader == "fabric":
            lv = lv or mll.fabric.get_latest_loader_version()
            mll.fabric.install_fabric(mc, BASE, loader_version=lv, callback=task.cb)
            return f"fabric-loader-{lv}-{mc}", lv
        lv = lv or mll.quilt.get_latest_loader_version()
        mll.quilt.install_quilt(mc, BASE, loader_version=lv, callback=task.cb)
        return f"quilt-loader-{lv}-{mc}", lv
    if loader == "forge":
        fv = f"{mc}-{lv}" if lv else mll.forge.find_forge_version(mc)
        if not fv:
            raise LauncherError("err.forge_missing", mc=mc)
        complete = prefetch_vanilla(mc, task)
        if full or not complete:
            mll.install.install_minecraft_version(mc, BASE, callback=task.cb)
        prefetch_forge(fv, task)
        # The forge installer re-checks the whole vanilla game (thousands of asset hashes) three times;
        # it was just verified/downloaded above, so skip those passes.
        with skip_vanilla_checks(mc if (complete and not full) else None):
            mll.forge.install_forge_version(fv, BASE, callback=task.cb, java=forge_java(mc))
        return mll.forge.forge_to_installed_version(fv), fv.split("-", 1)[1]
    raise LauncherError("err.loader_unsupported", loader=loader)


def add_instance(name, mc, loader, icon=None, extra=None):
    with lock:
        iid = new_id(name)
        data["instances"][iid] = dict(id=iid, name=name, mc=mc, loader=loader, icon=icon, status="installing",
                                      created=time.time(), content={}, playtime=0, sessions=0, **(extra or {}))
        os.makedirs(inst_path(iid), exist_ok=True)
        save()
    push_instances()
    return iid


def seed_ready_versions():
    """Versions that existing working instances already use count as installed."""
    ready = data.setdefault("ready_versions", {})
    for inst in data["instances"].values():
        vid = inst.get("version_id")
        if inst.get("status") == "ready" and vid and os.path.isfile(os.path.join(BASE, "versions", vid, f"{vid}.json")):
            ready.setdefault(f"{inst['loader']}|{inst['mc']}|{inst.get('loader_version') or ''}", [vid, inst.get("loader_version")])
            ready.setdefault(f"{inst['loader']}|{inst['mc']}|", [vid, inst.get("loader_version")])


def ensure_version(mc, loader, lv, task, force=False):
    """Installs a game version once. Later instances on the same version reuse it instantly
    instead of re-checking thousands of files (Repair passes force=True for a full check)."""
    key = f"{loader}|{mc}|{lv or ''}"
    ready = data.setdefault("ready_versions", {})
    hit = ready.get(key)
    if hit and not force and os.path.isfile(os.path.join(BASE, "versions", hit[0], f"{hit[0]}.json")):
        return hit[0], hit[1]
    t0 = time.time()
    vid, lv2 = install_loader(mc, loader, lv, task, full=force)
    log(f"installed {loader} {mc} ({vid}) in {time.time() - t0:.0f}s")
    with lock:
        ready[key] = [vid, lv2]
        ready[f"{loader}|{mc}|{lv2 or ''}"] = [vid, lv2]
        if not lv:
            ready[f"{loader}|{mc}|"] = [vid, lv2]
        save()
    return vid, lv2


def setup_job(task, iid, lv=None, force=False):
    inst = get_inst(iid)
    try:
        vid, lv = ensure_version(inst["mc"], inst["loader"], lv, task, force)
    except Exception:
        inst["status"] = "broken"
        save()
        raise
    with lock:
        inst.update(version_id=vid, loader_version=lv, status="ready")
        save()
    return "done.ready", {"name": inst["name"]}


# ---------------- Modrinth content ----------------
def pick_file(version):
    return next((f for f in version["files"] if f.get("primary")), version["files"][0])


def mark_dirty(iid):
    with lock:
        get_inst(iid)["dirty"] = True
        save()


class Installer:
    """Installs projects into an instance together with their required dependencies."""

    def __init__(self, task, iid):
        self.task, self.iid, self.inst = task, iid, get_inst(iid)
        self.seen, self.installed = set(), []

    def has(self, pid):
        return any(m.get("project_id") == pid for m in self.inst["content"].values())

    def one(self, pid, kind="mod", version_id=None, optional=False):
        inst = self.inst
        proj = api(f"/project/{pid}")
        rid = proj["id"]
        if rid in self.seen or self.has(rid):
            return
        self.seen.add(rid)
        kind = proj.get("project_type", kind)
        if kind not in FOLDERS:
            raise LauncherError("err.type_unsupported", type=kind)
        if version_id:
            v = api(f"/version/{version_id}")
        else:
            params = {"game_versions": json.dumps([inst["mc"]])}
            if kind == "mod":
                params["loaders"] = json.dumps([inst["loader"]])
            vers = api(f"/project/{rid}/version", params)
            if not vers:
                if optional:
                    return
                raise LauncherError("err.no_version", title=proj["title"], mc=inst["mc"], loader=inst["loader"])
            v = vers[0]
        f = pick_file(v)
        folder = FOLDERS[kind]
        fname = os.path.basename(f["filename"])
        self.task.set_status(msg("st.download", name=proj["title"]))
        download(f["url"], safe_join(inst_path(self.iid), f"{folder}/{fname}"), f.get("hashes", {}).get("sha1"))
        with lock:
            inst["content"][f"{folder}/{fname}"] = dict(project_id=rid, title=proj["title"], icon=proj.get("icon_url"),
                                                       type=kind, version=v["version_number"])
            inst["dirty"] = True
            save()
        self.installed.append(proj["title"])
        for dep in v.get("dependencies", []):
            if dep.get("dependency_type") == "required" and dep.get("project_id"):
                self.one(dep["project_id"], "mod", dep.get("version_id"))


def install_project_job(task, pid, ptype, iid):
    inst = get_inst(iid)
    if inst.get("status") != "ready":
        raise LauncherError("err.not_ready")
    if ptype == "mod" and inst["loader"] == "vanilla":
        raise LauncherError("err.vanilla_mods")
    ins = Installer(task, iid)
    ins.one(pid, ptype)
    if ptype == "shader" and inst["loader"] in ("fabric", "quilt"):
        ins.one("iris", "mod", optional=True)
    if not ins.installed:
        return "done.already", {}
    return "done.installed", {"list": ", ".join(ins.installed)}


def enrich_content(iid, items):
    """items: [(rel, sha1)] — find titles and icons on Modrinth by file hash. Returns how many were found."""
    if not items:
        return 0
    try:
        vers = http_post_json(API + "/version_files", {"hashes": [h for _, h in items], "algorithm": "sha1"})
        pids = sorted({v["project_id"] for v in vers.values()})
        projs = {p["id"]: p for p in api("/projects", {"ids": json.dumps(pids)})} if pids else {}
        inst = get_inst(iid)
        with lock:
            for rel, h in items:
                v = vers.get(h)
                if not v:
                    continue
                p = projs.get(v["project_id"], {})
                inst["content"][rel] = dict(project_id=v["project_id"], title=p.get("title"), icon=p.get("icon_url"),
                                            type=FOLDER_TYPE.get(rel.split("/")[0], "mod"),
                                            version=v.get("version_number"))
            save()
        return sum(1 for _, h in items if h in vers)
    except Exception:
        return 0


# ---------------- icons packed inside mods / resource packs ----------------
_local_meta_cache = {}
MAX_ICON = 512 * 1024


def _pick_icon(ic):
    if isinstance(ic, dict) and ic:  # {"16": "a.png", "128": "b.png"} -> largest
        ic = ic[max(ic, key=lambda k: int(k) if str(k).isdigit() else 0)]
    return ic if isinstance(ic, str) else None


def local_meta(path):
    """Read the icon and name that the mod / pack file carries itself."""
    try:
        key = (path, os.path.getmtime(path))
    except OSError:
        return {}
    if key in _local_meta_cache:
        return _local_meta_cache[key]
    out, cands = {}, []
    try:
        with zipfile.ZipFile(path) as z:
            names = set(z.namelist())
            if "fabric.mod.json" in names:
                j = json.loads(z.read("fabric.mod.json").decode("utf-8", "replace"), strict=False)
                out["title"] = j.get("name")
                cands.append(_pick_icon(j.get("icon")))
            if "quilt.mod.json" in names:
                q = json.loads(z.read("quilt.mod.json").decode("utf-8", "replace")).get("quilt_loader", {})
                out["title"] = out.get("title") or q.get("metadata", {}).get("name")
                cands.append(_pick_icon(q.get("metadata", {}).get("icon")))
            for toml in ("META-INF/mods.toml", "META-INF/neoforge.mods.toml"):
                if toml in names:
                    txt = z.read(toml).decode("utf-8", "replace")
                    m = re.search(r'logoFile\s*=\s*"([^"]+)"', txt)
                    if m:
                        cands.append(m.group(1))
                    m = re.search(r'displayName\s*=\s*"([^"]+)"', txt)
                    if m and "${" not in m.group(1):
                        out["title"] = out.get("title") or m.group(1)
            cands += ["pack.png", "icon.png"]
            for c in cands:
                if not c:
                    continue
                c = c.lstrip("/")
                ext = os.path.splitext(c)[1].lower()
                if c in names and ext in IMG_TYPES and z.getinfo(c).file_size <= MAX_ICON:
                    out["icon"] = f"data:{IMG_TYPES[ext]};base64," + base64.b64encode(z.read(c)).decode()
                    break
    except Exception:
        pass
    _local_meta_cache[key] = out
    return out


_lookup_running = set()


def lookup_unknown(iid, files):
    """Background: find files that were added by hand on Modrinth, then tell the UI."""
    if iid in _lookup_running:
        return
    _lookup_running.add(iid)

    def work():
        try:
            inst = get_inst(iid)
            tried = set(inst.get("lookup_tried", []))
            items = []
            for rel, full in files:
                sha1 = file_hashes(full)[0]
                if sha1 not in tried:
                    items.append((rel, sha1))
            if not items:
                return
            found = enrich_content(iid, items)
            with lock:
                inst["lookup_tried"] = sorted(tried | {h for _, h in items})[-2000:]
                save()
            if found:
                emit("content_changed", {"id": iid})
        except Exception:
            pass
        finally:
            _lookup_running.discard(iid)
    threading.Thread(target=work, daemon=True).start()


def install_mrpack(task, pack, title=None, icon=None, extra=None):
    with zipfile.ZipFile(pack) as z:
        try:
            index = json.loads(z.read("modrinth.index.json"))
            mc = index["dependencies"]["minecraft"]
        except (KeyError, ValueError):
            raise LauncherError("err.bad_pack")
        deps = index["dependencies"]
        loader, lv = "vanilla", None
        for key, name in (("fabric-loader", "fabric"), ("quilt-loader", "quilt"), ("forge", "forge"), ("neoforge", "neoforge")):
            if key in deps:
                loader, lv = name, deps[key]
        iid = add_instance(title or index.get("name") or "Modpack", mc, loader, icon, extra)
        root = inst_path(iid)
        try:
            files = [x for x in index.get("files", []) if x.get("env", {}).get("client") != "unsupported"]
            task.set_max(len(files))
            known = []
            for n, x in enumerate(files, 1):
                task.set_status(msg("st.pack_files", n=n, total=len(files)))
                sha1 = x.get("hashes", {}).get("sha1")
                download(x["downloads"][0], safe_join(root, x["path"]), sha1)
                if sha1 and x["path"].split("/")[0] in FOLDER_TYPE:
                    known.append((x["path"], sha1))
                task.set_progress(n)
            for member in z.namelist():
                if member.endswith("/"):
                    continue
                for prefix in ("overrides/", "client-overrides/"):
                    if member.startswith(prefix):
                        dest = safe_join(root, member[len(prefix):])
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        with z.open(member) as src, open(dest, "wb") as out:
                            shutil.copyfileobj(src, out)
                if re.fullmatch(r"elytra-icon\.(png|jpe?g|gif|webp)", member):
                    ext = os.path.splitext(member)[1]
                    with z.open(member) as src, open(os.path.join(root, "icon" + ext), "wb") as out:
                        shutil.copyfileobj(src, out)
                    get_inst(iid)["icon_file"] = "icon" + ext
            enrich_content(iid, known)
        except Exception:
            get_inst(iid)["status"] = "broken"
            save()
            raise
    return setup_job(task, iid, lv)


def install_modpack_job(task, pid, version_id=None):
    proj = api(f"/project/{pid}")
    if version_id:
        v = api(f"/version/{version_id}")
    else:
        vers = api(f"/project/{pid}/version")
        if not vers:
            raise LauncherError("err.no_versions_pack")
        v = vers[0]
    f = pick_file(v)
    pack = os.path.join(CACHE_DIR, os.path.basename(f["filename"]))
    task.set_status(msg("st.pack_download"))
    download(f["url"], pack, f.get("hashes", {}).get("sha1"))
    return install_mrpack(task, pack, proj["title"], proj.get("icon_url"), {"modpack": proj["id"]})


def import_job(task, path):
    return install_mrpack(task, path)


# ---------------- share (export to .mrpack) ----------------
EXPORT_EXTRA = ("config", "defaultconfigs", "kubejs", "options.txt", "servers.dat")


def export_job(task, iid, dest):
    inst, root = get_inst(iid), inst_path(iid)
    task.set_status(msg("st.hashing"))
    items = []
    for folder in FOLDERS.values():
        d = os.path.join(root, folder)
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            full = os.path.join(d, fn)
            if os.path.isfile(full) and not fn.endswith((".disabled", ".part")):
                items.append((f"{folder}/{fn}", full, *file_hashes(full), os.path.getsize(full)))
    vers = {}
    if items:
        try:
            vers = http_post_json(API + "/version_files", {"hashes": [i[2] for i in items], "algorithm": "sha1"})
        except Exception:
            vers = {}
    files, overrides = [], []
    for rel, full, sha1, sha512, size in items:
        v = vers.get(sha1)
        url = next((f["url"] for f in v["files"] if f.get("hashes", {}).get("sha1") == sha1), None) if v else None
        if url:
            files.append({"path": rel, "hashes": {"sha1": sha1, "sha512": sha512},
                          "env": {"client": "required", "server": "optional"}, "downloads": [url], "fileSize": size})
        else:
            overrides.append((full, rel))
    for extra in EXPORT_EXTRA:
        p = os.path.join(root, extra)
        if os.path.isfile(p):
            overrides.append((p, extra))
        elif os.path.isdir(p):
            for dp, _, fns in os.walk(p):
                for fn in fns:
                    full = os.path.join(dp, fn)
                    overrides.append((full, os.path.relpath(full, root).replace(os.sep, "/")))
    deps = {"minecraft": inst["mc"]}
    key = {"fabric": "fabric-loader", "quilt": "quilt-loader", "forge": "forge"}.get(inst["loader"])
    if key and inst.get("loader_version"):
        deps[key] = inst["loader_version"]
    index = {"formatVersion": 1, "game": "minecraft", "versionId": "1.0.0", "name": inst["name"],
             "summary": f"Shared from Elytra {VERSION}", "files": files, "dependencies": deps}
    task.set_status(msg("st.zipping"))
    tmp = dest + ".part"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("modrinth.index.json", json.dumps(index, ensure_ascii=False, indent=2))
        for full, rel in overrides:
            z.write(full, "overrides/" + rel)
        if inst.get("icon_file"):
            z.write(os.path.join(root, inst["icon_file"]), "elytra-icon" + os.path.splitext(inst["icon_file"])[1])
    os.replace(tmp, dest)
    bump("shared")
    return "done.exported", {"file": os.path.basename(dest)}


# ---------------- boost ----------------
def boost_job(task, iid):
    inst = get_inst(iid)
    if inst.get("status") != "ready":
        raise LauncherError("err.not_ready")
    with lock:
        inst["boosted"] = True
        rec = recommended_ram(inst["loader"] != "vanilla")
        if data["settings"]["ram"] < rec:
            data["settings"]["ram"] = rec
        save()
    mods = BOOST_MODS.get(inst["loader"])
    if not mods:
        return "done.boost_vanilla", {"ram": round(data["settings"]["ram"] / 1024, 1)}
    ins = Installer(task, iid)
    for slug in mods:
        try:
            ins.one(slug, "mod", optional=True)
        except LauncherError:
            pass
    check_achievements()
    return "done.boost", {"n": len(ins.installed), "ram": round(data["settings"]["ram"] / 1024, 1)}


# ---------------- world backups ----------------
def backups_dir(iid):
    return os.path.join(inst_path(iid), "backups")


def has_worlds(iid):
    saves = os.path.join(inst_path(iid), "saves")
    return os.path.isdir(saves) and any(os.path.isdir(os.path.join(saves, w)) for w in os.listdir(saves))


def backup_saves(iid, reason="manual", only=None):
    root = inst_path(iid)
    saves = os.path.join(root, "saves")
    if not has_worlds(iid):
        raise LauncherError("err.no_worlds")
    if only:
        saves = safe_join(saves, only)
    bdir = backups_dir(iid)
    os.makedirs(bdir, exist_ok=True)
    name = time.strftime("%Y-%m-%d_%H-%M-%S") + f"_{reason}.zip"
    tmp = os.path.join(bdir, name + ".part")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, _, fns in os.walk(saves):
            for fn in fns:
                if fn == "session.lock":
                    continue
                full = os.path.join(dp, fn)
                try:
                    z.write(full, os.path.relpath(full, root).replace(os.sep, "/"))
                except OSError:
                    pass
    os.replace(tmp, os.path.join(bdir, name))
    keep = int(data["settings"].get("backups_keep", 5))
    zips = sorted(f for f in os.listdir(bdir) if f.endswith(".zip"))
    for old in zips[:-keep] if len(zips) > keep else []:
        try:
            os.remove(os.path.join(bdir, old))
        except OSError:
            pass
    with lock:
        get_inst(iid)["last_backup"] = time.time()
        save()
    return name


def backup_job(task, iid):
    task.set_status(msg("st.backup"))
    backup_saves(iid, "manual")
    return "done.backup", {}


def restore_job(task, iid, name):
    if iid in running:
        raise LauncherError("err.close_game")
    root = inst_path(iid)
    src = safe_join(backups_dir(iid), name)
    if not os.path.isfile(src):
        raise LauncherError("err.not_found")
    if has_worlds(iid):
        task.set_status(msg("st.backup"))
        backup_saves(iid, "before-restore")
    task.set_status(msg("st.restoring"))
    saves = os.path.join(root, "saves")
    with zipfile.ZipFile(src) as z:
        worlds = {m.split("/")[1] for m in z.namelist() if m.startswith("saves/") and m.count("/") >= 2}
        for w in worlds:  # worlds that are not in this backup stay untouched
            shutil.rmtree(safe_join(saves, w), ignore_errors=True)
        for member in z.namelist():
            if member.endswith("/") or not member.startswith("saves/"):
                continue
            dest = safe_join(root, member)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with z.open(member) as s, open(dest, "wb") as out:
                shutil.copyfileobj(s, out)
    return "done.restored", {}


# ---------------- my servers: ping ----------------
def _varint(n):
    out, n = b"", n & 0xFFFFFFFF
    while True:
        b, n = n & 0x7F, n >> 7
        out += bytes([b | (0x80 if n else 0)])
        if not n:
            return out


def _read_exact(s, n):
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("closed")
        buf += chunk
    return buf


def _read_varint(s):
    num = 0
    for i in range(5):
        b = _read_exact(s, 1)[0]
        num |= (b & 0x7F) << (7 * i)
        if not b & 0x80:
            return num
    raise ValueError("varint too big")


def _dns_name(buf, off):
    labels, jumped, end = [], False, off
    for _ in range(64):
        ln = buf[off]
        if ln == 0:
            off += 1
            break
        if ln & 0xC0 == 0xC0:
            ptr = ((ln & 0x3F) << 8) | buf[off + 1]
            if not jumped:
                end = off + 2
            off, jumped = ptr, True
            continue
        labels.append(buf[off + 1:off + 1 + ln].decode(errors="replace"))
        off += 1 + ln
    return ".".join(labels), (end if jumped else off)


def resolve_srv(host):
    """_minecraft._tcp SRV lookup — many servers use it instead of a port."""
    qid = random.randint(0, 65535)
    q = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0)
    for part in f"_minecraft._tcp.{host}".split("."):
        q += bytes([len(part)]) + part.encode()
    q += b"\x00" + struct.pack(">HH", 33, 1)
    for dns in ("1.1.1.1", "8.8.8.8"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(2)
                s.sendto(q, (dns, 53))
                buf = s.recv(2048)
            rid, _, qd, an = struct.unpack(">HHHH", buf[:8])
            if rid != qid or an == 0:
                return None
            off = 12
            for _ in range(qd):
                _, off = _dns_name(buf, off)
                off += 4
            for _ in range(an):
                _, off = _dns_name(buf, off)
                rtype, _, _, rdlen = struct.unpack(">HHIH", buf[off:off + 10])
                off += 10
                if rtype == 33:
                    _, _, port = struct.unpack(">HHH", buf[off:off + 6])
                    target, _ = _dns_name(buf, off + 6)
                    return target.rstrip("."), port
                off += rdlen
            return None
        except Exception:
            continue
    return None


def parse_address(addr):
    m = re.fullmatch(r"([A-Za-z0-9.\-_]{1,253})(?::(\d{1,5}))?", (addr or "").strip())
    if not m or (m.group(2) and not 0 < int(m.group(2)) < 65536):
        raise LauncherError("err.server_address")
    return m.group(1), int(m.group(2)) if m.group(2) else None


def _motd_text(d):
    if isinstance(d, str):
        return d
    if isinstance(d, dict):
        return d.get("text", "") + "".join(_motd_text(x) for x in d.get("extra", []))
    if isinstance(d, list):
        return "".join(_motd_text(x) for x in d)
    return ""


def mc_ping(addr):
    host, port = parse_address(addr)
    conn_host, conn_port = host, port or 25565
    if port is None and not re.fullmatch(r"[\d.]+", host):
        srv = resolve_srv(host)
        if srv:
            conn_host, conn_port = srv
    t0 = time.time()
    with socket.create_connection((conn_host, conn_port), timeout=5) as s:
        s.settimeout(5)
        connect_ms = (time.time() - t0) * 1000
        hb = host.encode()
        hs = _varint(0) + _varint(767) + _varint(len(hb)) + hb + struct.pack(">H", conn_port) + _varint(1)
        s.sendall(_varint(len(hs)) + hs + b"\x01\x00")
        _read_varint(s)
        _read_varint(s)
        status = json.loads(_read_exact(s, _read_varint(s)).decode("utf-8", errors="replace"))
        ping = connect_ms
        try:
            t1 = time.time()
            s.sendall(_varint(9) + _varint(1) + struct.pack(">q", int(t1 * 1000)))
            _read_varint(s)
            _read_varint(s)
            _read_exact(s, 8)
            ping = (time.time() - t1) * 1000
        except Exception:
            pass
    fav = (status.get("favicon") or "").replace("\n", "")
    players = status.get("players", {})
    return {"online": True, "players": players.get("online", 0), "max": players.get("max", 0),
            "version": _motd_text(status.get("version", {}).get("name", "")),
            "motd": re.sub(r"§.", "", _motd_text(status.get("description", ""))).strip(),
            "favicon": fav if fav.startswith("data:image/png;base64,") else None, "ping": round(ping)}


def version_tuple(v):
    m = re.match(r"(\d+)\.(\d+)(?:\.(\d+))?", v or "")
    return tuple(int(x or 0) for x in m.groups()) if m else (0, 0, 0)


# ---------------- doctor ----------------
def mod_id_of(path):
    try:
        with zipfile.ZipFile(path) as z:
            names = set(z.namelist())
            if "fabric.mod.json" in names:
                return json.loads(z.read("fabric.mod.json").decode("utf-8", "replace"), strict=False).get("id")
            if "quilt.mod.json" in names:
                return json.loads(z.read("quilt.mod.json").decode("utf-8", "replace")).get("quilt_loader", {}).get("id")
            if "META-INF/mods.toml" in names:
                m = re.search(r'modId\s*=\s*"([^"]+)"', z.read("META-INF/mods.toml").decode("utf-8", "replace"))
                return m.group(1) if m else None
    except Exception:
        return None


def find_mod_rel(iid, modid):
    d = os.path.join(inst_path(iid), "mods")
    if not os.path.isdir(d):
        return None
    for fn in os.listdir(d):
        if fn.endswith(".jar") and mod_id_of(os.path.join(d, fn)) == modid:
            return f"mods/{fn}"
    return None


def read_tail(path, size=400_000):
    try:
        with open(path, "rb") as f:
            f.seek(max(0, os.path.getsize(path) - size))
            return f.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def diagnose(iid):
    inst, root = get_inst(iid), inst_path(iid)
    log = read_tail(os.path.join(root, "launcher_log.txt"))
    crash = ""
    cdir = os.path.join(root, "crash-reports")
    if os.path.isdir(cdir):
        reports = sorted((os.path.join(cdir, f) for f in os.listdir(cdir) if f.endswith(".txt")),
                         key=os.path.getmtime, reverse=True)
        if reports and os.path.getmtime(reports[0]) >= inst.get("last_played", 0) - 5:
            crash = read_tail(reports[0])
    text = crash + "\n" + log
    found, keys = [], set()

    def add(key, action=None, **params):
        sig = (key, json.dumps(params, sort_keys=True))
        if sig not in keys:
            keys.add(sig)
            found.append({"key": key, "params": params, "action": action})

    def missing(dep, by):
        dep = dep.strip().strip("'\"").lower()
        if dep == "minecraft":
            add("doc.wrong_mc", None, mod=by or "?", mc=inst["mc"])
        elif dep not in NOT_MODS:
            slug = MODID_SLUG.get(dep, dep)
            add("doc.missing", {"type": "install", "slug": slug}, dep=dep, mod=by or "?")

    for m in re.finditer(r"Mod '([^']+)' \(([\w\-]+)\)[^\n]*? requires (?:any version|version [^\n]*?) of "
                         r"(?:'[^']*' \(([\w\-]+)\)|([\w\-]+))", text):
        missing(m.group(3) or m.group(4), m.group(1))
    for m in re.finditer(r"- Install ([\w\-]+), ", text):
        missing(m.group(1), None)
    for m in re.finditer(r"Mod ID: '([\w\-]+)', Requested by: '([\w\-]+)'", text):
        missing(m.group(1), m.group(2))
    for m in re.finditer(r"Mod '([^']+)' \(([\w\-]+)\)[^\n]*? is incompatible with", text):
        rel = find_mod_rel(iid, m.group(2))
        add("doc.incompatible", {"type": "disable", "rel": rel} if rel else None, mod=m.group(1))
    for m in re.finditer(r"Mixin apply for mod ([\w\-]+) failed|from mod ([\w\-]+) failed injection check", text):
        modid = m.group(1) or m.group(2)
        rel = find_mod_rel(iid, modid)
        add("doc.mixin", {"type": "disable", "rel": rel} if rel else None, mod=modid)
    if re.search(r"[Dd]uplicate mod|Found \d+ duplicates? ", text):
        add("doc.duplicate", {"type": "content"})
    if "java.lang.OutOfMemoryError" in text:
        cur = data["settings"]["ram"]
        new = min(max(cur + 2048, recommended_ram()), max(1024, system_ram_mb() * 3 // 4 // 512 * 512))
        add("doc.memory", {"type": "ram", "value": new} if new > cur else None, gb=round(new / 1024, 1))
    if re.search(r"UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime", text):
        add("doc.java", {"type": "java_auto"} if data["settings"]["java"] else None)
    if re.search(r"Pixel format not accelerated|GLFW error 65542|driver does not appear to support OpenGL"
                 r"|Could not create context|OpenGL 3\.2 Core", text):
        add("doc.gpu")
    if not found and crash:
        m = re.search(r"Suspected Mods?: ([^\n]+)", crash)
        if m and m.group(1).strip().lower() not in ("none", "unknown", ""):
            for part in m.group(1).split(",")[:3]:
                mm = re.match(r"\s*(.+?)\s*\(([\w\-]+)\)", part)
                if mm:
                    rel = find_mod_rel(iid, mm.group(2))
                    add("doc.suspect", {"type": "disable", "rel": rel} if rel else None, mod=mm.group(1))
    tail = [ln for ln in (crash or log).strip().splitlines() if ln.strip()][-12:]
    return {"findings": found, "tail": "\n".join(tail), "has_log": bool(log or crash)}



# ---------------- mod updates ----------------
UPDATE_LOADERS = {"resourcepacks": ["minecraft"], "shaderpacks": ["iris", "optifine", "canvas", "vanilla"]}


def content_files(iid):
    """[(rel_without_disabled, full_path, enabled)] for mods, resource packs and shaders."""
    root, out = inst_path(iid), []
    for folder in FOLDERS.values():
        d = os.path.join(root, folder)
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            full = os.path.join(d, fn)
            if os.path.isfile(full) and not fn.endswith(".part"):
                enabled = not fn.endswith(".disabled")
                out.append((f"{folder}/{fn if enabled else fn[:-9]}", full, enabled))
    return out


def check_updates(iid):
    inst = get_inst(iid)
    groups = {}
    for rel, full, _ in content_files(iid):
        groups.setdefault(rel.split("/")[0], []).append((rel, file_hashes(full)[0]))
    result = []
    for folder, items in groups.items():
        loaders = [inst["loader"]] if folder == "mods" else UPDATE_LOADERS.get(folder, [])
        if folder == "mods" and inst["loader"] == "vanilla":
            continue
        body = {"hashes": [h for _, h in items], "algorithm": "sha1", "game_versions": [inst["mc"]]}
        if loaders:
            body["loaders"] = loaders
        latest = http_post_json(API + "/version_files/update", body)
        for rel, h in items:
            v = latest.get(h)
            if not v or not v.get("files"):
                continue
            f = pick_file(v)
            if f.get("hashes", {}).get("sha1") == h:
                continue
            meta = inst["content"].get(rel, {})
            result.append({"rel": rel, "title": meta.get("title") or os.path.basename(rel),
                           "from": meta.get("version") or "?", "to": v["version_number"], "version_id": v["id"]})
    with lock:
        inst["updates"] = result
        inst["updates_checked"] = time.time()
        save()
    return result


def update_content_job(task, iid, rels=None):
    inst = get_inst(iid)
    if iid in running:
        raise LauncherError("err.close_game")
    todo = [u for u in inst.get("updates", []) if rels is None or u["rel"] in rels]
    if not todo:
        return "done.no_updates", {}
    if has_worlds(iid):
        task.set_status(msg("st.backup"))
        backup_saves(iid, "before-update")
    root, ins, done = inst_path(iid), Installer(task, iid), []
    task.set_max(len(todo))
    for n, u in enumerate(todo, 1):
        v = api(f"/version/{u['version_id']}")
        f = pick_file(v)
        old = safe_join(root, u["rel"])
        enabled = os.path.exists(old)
        folder = u["rel"].split("/")[0]
        new_rel = f"{folder}/{os.path.basename(f['filename'])}"
        dest = safe_join(root, new_rel) + ("" if enabled else ".disabled")
        task.set_status(msg("st.download", name=u["title"]))
        download(f["url"], dest + ".new", f.get("hashes", {}).get("sha1"))
        for p in (old, old + ".disabled"):
            if os.path.exists(p):
                os.remove(p)
        os.replace(dest + ".new", dest)
        with lock:
            meta = inst["content"].pop(u["rel"], {})
            meta.update(version=v["version_number"], project_id=v["project_id"])
            inst["content"][new_rel] = meta
            inst["dirty"] = True
            save()
        for dep in v.get("dependencies", []):
            if dep.get("dependency_type") == "required" and dep.get("project_id"):
                try:
                    ins.one(dep["project_id"], "mod", optional=True)
                except LauncherError:
                    pass
        done.append(u["title"])
        task.set_progress(n)
    with lock:
        inst["updates"] = [u for u in inst.get("updates", []) if u not in todo]
        save()
    return "done.updated", {"n": len(done)}


# ---------------- skins (served locally, so blocked skin sites don't matter) ----------------
def _png(w, h, px):
    """Minimal RGBA PNG encoder. px: function (x, y) -> (r, g, b, a)."""
    import zlib
    raw = b"".join(b"\x00" + b"".join(bytes(px(x, y)) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", __import__("zlib").crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def fallback_skin():
    """A plain, original skin used only when nothing else can be loaded."""
    skin, hair, eye, shirt, pants, shoe = (214, 170, 130, 255), (70, 45, 30, 255), (40, 60, 120, 255), (27, 160, 110, 255), (50, 60, 110, 255), (60, 60, 60, 255)

    def px(x, y):
        if y < 16:                       # head
            if 32 <= x:
                return (0, 0, 0, 0)
            if y < 8:
                return hair
            if 8 <= x < 16:              # face
                if y == 8 or y == 9 and x not in (9, 10, 13, 14):
                    return hair
                if y == 12 and x in (9, 14):
                    return eye
                return skin
            return hair if y < 10 else skin
        if 16 <= y < 32:
            if 16 <= x < 40:
                return shirt
            if x < 16:
                return pants if y < 30 else shoe
            if 40 <= x < 56:
                return shirt if y < 24 else skin
        if 48 <= y and 16 <= x < 48:
            if x < 32:
                return pants if y < 62 else shoe
            return shirt if y < 56 else skin
        return (0, 0, 0, 0)
    return _png(64, 64, px)


def default_skin():
    cache = os.path.join(BASE, "cache", "skins", "_default.png")
    if os.path.isfile(cache):
        with open(cache, "rb") as f:
            return f.read()
    vroot = os.path.join(BASE, "versions")
    for v in sorted(os.listdir(vroot), reverse=True) if os.path.isdir(vroot) else []:
        jar = os.path.join(vroot, v, f"{v}.jar")
        if not os.path.isfile(jar):
            continue
        try:
            with zipfile.ZipFile(jar) as z:
                for name in ("assets/minecraft/textures/entity/player/wide/steve.png", "assets/minecraft/textures/entity/steve.png"):
                    if name in z.namelist():
                        png = z.read(name)
                        os.makedirs(os.path.dirname(cache), exist_ok=True)
                        with open(cache, "wb") as f:
                            f.write(png)
                        return png
        except Exception:
            continue
    return fallback_skin()


def skin_png(name):
    """Skin of a Minecraft account name via Mojang's API, cached for 6 hours (stale cache beats nothing)."""
    if not re.fullmatch(r"[A-Za-z0-9_]{1,16}", name or ""):
        return default_skin()
    path = os.path.join(BASE, "cache", "skins", name.lower() + ".png")
    if os.path.isfile(path) and time.time() - os.path.getmtime(path) < 6 * 3600:
        with open(path, "rb") as f:
            return f.read()
    try:
        try:
            uid = http_json(f"https://api.mojang.com/users/profiles/minecraft/{name}", 8)["id"]
        except urllib.error.HTTPError as e:
            if e.code in (204, 404):
                raise KeyError(name)
            uid = http_json(f"https://api.minecraftservices.com/minecraft/profile/lookup/name/{name}", 8)["id"]
        prof = http_json(f"https://sessionserver.mojang.com/session/minecraft/profile/{uid}", 8)
        tex = json.loads(base64.b64decode(next(p["value"] for p in prof["properties"] if p["name"] == "textures")))
        png = open_url(tex["textures"]["SKIN"]["url"].replace("http://", "https://", 1), 10, read=True)
        if png[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError("not a png")
    except Exception as e:
        if os.path.isfile(path):
            with open(path, "rb") as f:
                return f.read()
        if not isinstance(e, (KeyError, StopIteration)):
            log(f"skin {name}: {e!r}")
        png = default_skin()
        if isinstance(e, (KeyError, StopIteration)):     # no such premium account: remember the default
            pass
        else:
            return png
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)
    return png


# ---------------- worlds & screenshots (served to the UI by a tiny local server) ----------------
MEDIA_TOKEN = secrets.token_urlsafe(18)
MEDIA_BASE = ""
SHOT_EXT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


class MediaHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            parts = [urllib.parse.unquote(x) for x in self.path.split("?")[0].strip("/").split("/")]
            if len(parts) == 4 and parts[1] == "cmd" and secrets.compare_digest(parts[0], MEDIA_TOKEN):
                run_command(parts[2], parts[3])
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"ok")
                return
            if len(parts) == 3 and parts[1] == "skin" and secrets.compare_digest(parts[0], MEDIA_TOKEN):
                body = skin_png(parts[2][:-4] if parts[2].endswith(".png") else parts[2])
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "max-age=600")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
                return
            if len(parts) != 4 or not secrets.compare_digest(parts[0], MEDIA_TOKEN) or parts[1] not in data["instances"]:
                raise FileNotFoundError
            root = inst_path(parts[1])
            if parts[2] == "shot":
                path = safe_join(os.path.join(root, "screenshots"), parts[3])
            elif parts[2] == "world":
                path = os.path.join(safe_join(os.path.join(root, "saves"), parts[3]), "icon.png")
            else:
                raise FileNotFoundError
            ext = os.path.splitext(path)[1].lower()
            if ext not in SHOT_EXT or not os.path.isfile(path):
                raise FileNotFoundError
            self.send_response(200)
            self.send_header("Content-Type", SHOT_EXT[ext])
            self.send_header("Content-Length", str(os.path.getsize(path)))
            self.send_header("Cache-Control", "max-age=30")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            with open(path, "rb") as f:
                shutil.copyfileobj(f, self.wfile)
        except Exception:
            try:
                self.send_error(404)
            except Exception:
                pass

    def log_message(self, *a):
        pass


def start_media_server():
    global MEDIA_BASE
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", 0), MediaHandler)
        srv.daemon_threads = True
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        MEDIA_BASE = f"http://127.0.0.1:{srv.server_address[1]}/{MEDIA_TOKEN}"
    except OSError:
        MEDIA_BASE = ""


def list_screenshots(iid):
    d = os.path.join(inst_path(iid), "screenshots")
    if not os.path.isdir(d):
        return []
    out = []
    for fn in os.listdir(d):
        p = os.path.join(d, fn)
        if os.path.isfile(p) and os.path.splitext(fn)[1].lower() in SHOT_EXT:
            out.append({"name": fn, "time": os.path.getmtime(p), "size": os.path.getsize(p)})
    return sorted(out, key=lambda x: x["time"], reverse=True)


def _nbt_find(raw, tag, name, size):
    key = bytes([tag]) + struct.pack(">H", len(name)) + name.encode()
    i = raw.find(key)
    return None if i < 0 else raw[i + len(key): i + len(key) + size]


def world_info(path):
    info = {"folder": os.path.basename(path), "name": os.path.basename(path)}
    try:
        with gzip.open(os.path.join(path, "level.dat")) as f:
            raw = f.read(400_000)
        b = _nbt_find(raw, 8, "LevelName", 2)
        if b:
            ln = struct.unpack(">H", b)[0]
            i = raw.find(b"\x08\x00\x09LevelName") + 14
            info["name"] = raw[i:i + ln].decode("utf-8", "replace") or info["name"]
        b = _nbt_find(raw, 3, "GameType", 4)
        if b and len(b) == 4:
            info["mode"] = struct.unpack(">i", b)[0]
        b = _nbt_find(raw, 1, "hardcore", 1)
        if b:
            info["hardcore"] = b[0] == 1
        b = _nbt_find(raw, 4, "LastPlayed", 8)
        if b and len(b) == 8:
            info["last"] = struct.unpack(">q", b)[0] / 1000
    except Exception:
        pass
    size = 0
    for dp, _, fns in os.walk(path):
        for fn in fns:
            try:
                size += os.path.getsize(os.path.join(dp, fn))
            except OSError:
                pass
    info["size"] = size
    info["icon"] = os.path.isfile(os.path.join(path, "icon.png"))
    info.setdefault("last", os.path.getmtime(path))
    return info


def list_worlds(iid):
    saves = os.path.join(inst_path(iid), "saves")
    if not os.path.isdir(saves):
        return []
    worlds = [world_info(os.path.join(saves, w)) for w in os.listdir(saves) if os.path.isdir(os.path.join(saves, w))]
    return sorted(worlds, key=lambda w: w.get("last", 0), reverse=True)


def copy_world_job(task, iid, folder, target):
    if target in running:
        raise LauncherError("err.close_game")
    src = safe_join(os.path.join(inst_path(iid), "saves"), folder)
    if not os.path.isdir(src) or target not in data["instances"]:
        raise LauncherError("err.not_found")
    dst_root = os.path.join(inst_path(target), "saves")
    os.makedirs(dst_root, exist_ok=True)
    name, n = folder, 2
    while os.path.exists(os.path.join(dst_root, name)):
        name, n = f"{folder} ({n})", n + 1
    task.set_status(msg("st.copying"))
    shutil.copytree(src, os.path.join(dst_root, name), ignore=shutil.ignore_patterns("session.lock"))
    return "done.world_copied", {"name": get_inst(target)["name"]}


# ---------------- Discord status ----------------
PRESENCE = {
    "en": {"menu": "In the launcher", "single": "Singleplayer / LAN", "server": "On a server", "mods": "{n} mods"},
    "ru": {"menu": "В лаунчере", "single": "Одиночная игра", "server": "На сервере", "mods": "модов: {n}"},
    "uk": {"menu": "У лаунчері", "single": "Одиночна гра", "server": "На сервері", "mods": "модів: {n}"},
    "de": {"menu": "Im Launcher", "single": "Einzelspieler", "server": "Auf einem Server", "mods": "{n} Mods"},
    "es": {"menu": "En el launcher", "single": "Un jugador", "server": "En un servidor", "mods": "{n} mods"},
}


class DiscordRPC:
    """Minimal Discord Rich Presence over the local IPC pipe — no extra libraries needed."""

    def __init__(self):
        self.conn, self.lock, self.started = None, threading.Lock(), int(time.time())
        self.last_error, self.ok = "", False

    def _connect(self):
        if os.name == "nt":
            for i in range(10):
                try:
                    self.conn = open(rf"\\?\pipe\discord-ipc-{i}", "r+b", buffering=0)
                    break
                except OSError:
                    continue
        else:
            base = os.environ.get("XDG_RUNTIME_DIR") or os.environ.get("TMPDIR") or "/tmp"
            for sub in ("", "app/com.discordapp.Discord", "snap.discord"):
                for i in range(10):
                    try:
                        sock = socket.socket(socket.AF_UNIX)
                        sock.settimeout(3)
                        sock.connect(os.path.join(base, sub, f"discord-ipc-{i}"))
                        self.conn = sock
                        break
                    except OSError:
                        continue
                if self.conn:
                    break
        if not self.conn:
            self.last_error = "not_running"
            return False
        self._send(0, {"v": 1, "client_id": DISCORD_CLIENT_ID})
        ready = self._recv()
        if ready.get("evt") == "ERROR" or ready.get("cmd") != "DISPATCH":
            self.last_error = str(ready.get("data", {}).get("message") or ready)[:200]
            log(f"discord handshake: {ready}")
            self.close()
            return False
        return True

    def _write(self, b):
        self.conn.write(b) if hasattr(self.conn, "write") else self.conn.sendall(b)

    def _read(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.conn.read(n - len(buf)) if hasattr(self.conn, "read") else self.conn.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("discord closed")
            buf += chunk
        return buf

    def _send(self, op, payload):
        raw = json.dumps(payload).encode()
        self._write(struct.pack("<II", op, len(raw)) + raw)

    def _recv(self):
        _, ln = struct.unpack("<II", self._read(8))
        return json.loads(self._read(ln))

    def close(self):
        try:
            self.conn and self.conn.close()
        except Exception:
            pass
        self.conn = None

    def set(self, activity):
        """Returns True when Discord accepted the activity."""
        enabled = bool(DISCORD_CLIENT_ID) and data["settings"].get("discord", True)
        if not enabled:
            if not self.conn:
                return False
            activity = None
        with self.lock:
            for _ in range(2):
                try:
                    if not self.conn and not self._connect():
                        self.ok = False
                        return False
                    self._send(1, {"cmd": "SET_ACTIVITY", "args": {"pid": os.getpid(), "activity": activity},
                                   "nonce": uuid.uuid4().hex})
                    while True:   # skip unrelated events until our command's answer
                        r = self._recv()
                        if r.get("cmd") == "SET_ACTIVITY":
                            break
                    if r.get("evt") == "ERROR":
                        self.last_error = str(r.get("data", {}).get("message") or r)[:200]
                        log(f"discord SET_ACTIVITY error: {r}")
                        self.ok = False
                        return False
                    self.ok, self.last_error = activity is not None, ""
                    return self.ok
                except Exception as e:
                    self.last_error = f"{type(e).__name__}: {e}"
                    self.close()
            log(f"discord rpc failed: {self.last_error}")
            self.ok = False
            return False


rpc = DiscordRPC()


def update_presence(wait=False):
    def work():
        txt = PRESENCE.get(data["settings"].get("lang"), PRESENCE["en"])
        assets = {"large_image": "elytra", "large_text": f"Elytra {VERSION}"}
        playing = [(iid, info) for iid, info in game_sessions.items() if iid in running]
        if playing:
            iid, info = playing[-1]
            inst = data["instances"].get(iid, {})
            mods = sum(1 for k in inst.get("content", {}) if k.startswith("mods/"))
            state = (txt["server"] if data["settings"].get("streamer") else f"{txt['server']}: {info['server']}") \
                if info.get("server") else txt["single"]
            details = f"{inst.get('name', 'Minecraft')} · {inst.get('loader', '').capitalize()} {inst.get('mc', '')}"
            if mods:
                details += " · " + txt["mods"].format(n=mods)
            rpc.set({"details": details[:128], "state": state[:128], "timestamps": {"start": info["start"]}, "assets": assets})
        else:
            rpc.set({"details": txt["menu"], "timestamps": {"start": rpc.started}, "assets": assets})
    if wait:
        work()
        return {"ok": rpc.ok, "error": rpc.last_error}
    threading.Thread(target=work, daemon=True).start()


game_sessions = {}  # iid -> {"start": ts, "server": address}


# ---------------- Minecraft news ----------------
_news_cache = {"t": 0, "data": None}
NEWS_URL = "https://launchercontent.mojang.com/v2/news.json"


def get_news():
    if _news_cache["data"] and time.time() - _news_cache["t"] < 1800:
        return _news_cache["data"]
    out = {"items": [], "latest": {}}
    try:
        out["latest"] = mll.utils.get_latest_version()
    except Exception:
        pass
    try:
        raw = http_json(NEWS_URL)
        for e in raw.get("entries", []):
            types = [t.lower() for t in e.get("newsType", [])]
            if types and not any("java" in t for t in types):
                continue
            img = (e.get("newsPageImage") or e.get("playPageImage") or {}).get("url", "")
            link = e.get("readMoreLink", "")
            out["items"].append({"title": e.get("title", ""), "text": e.get("text", ""), "tag": e.get("tag", ""),
                                 "date": e.get("date", ""),
                                 "image": ("https://launchercontent.mojang.com" + img) if img.startswith("/") else img,
                                 "link": link if link.startswith("https://") else ""})
            if len(out["items"]) >= 8:
                break
    except Exception:
        pass
    _news_cache.update(t=time.time(), data=out)
    return out


# ---------------- Microsoft accounts ----------------
def _dpapi(data_bytes, protect):
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]
    buf = ctypes.create_string_buffer(data_bytes, len(data_bytes))
    inp, out = BLOB(len(data_bytes), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), BLOB()
    fn = ctypes.windll.crypt32.CryptProtectData if protect else ctypes.windll.crypt32.CryptUnprotectData
    if not fn(ctypes.byref(inp), None, None, None, None, 0, ctypes.byref(out)):
        raise OSError("DPAPI failed")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out.pbData)


def protect(text):
    """Refresh tokens are encrypted with the Windows user key (DPAPI), so copying launcher.json is useless."""
    raw = text.encode()
    if os.name == "nt":
        try:
            return "dpapi:" + base64.b64encode(_dpapi(raw, True)).decode()
        except Exception:
            pass
    return "b64:" + base64.b64encode(raw).decode()


def unprotect(text):
    kind, _, body = (text or "").partition(":")
    raw = base64.b64decode(body)
    return (_dpapi(raw, False) if kind == "dpapi" else raw).decode()


def ms_enabled():
    return bool(MS_CLIENT_ID)


def public_accounts():
    return [{"id": a["id"], "name": a["name"]} for a in data["accounts"]]


def save_account(acc):
    with lock:
        data["accounts"] = [a for a in data["accounts"] if a["id"] != acc["id"]]
        data["accounts"].append({"id": acc["id"], "name": acc["name"], "refresh": protect(acc["refresh_token"])})
        data["settings"]["account"] = acc["id"]
        save()


def ms_login_flow():
    if not ms_enabled():
        raise LauncherError("err.ms_not_setup")
    ma = mll.microsoft_account
    url, state, verifier = ma.get_secure_login_data(MS_CLIENT_ID, MS_REDIRECT)
    win = webview.create_window("Microsoft", url, width=520, height=700)
    closed, code = threading.Event(), None
    try:
        win.events.closed += closed.set
    except Exception:
        pass
    deadline = time.time() + 600
    while not closed.is_set() and time.time() < deadline:
        try:
            cur = win.get_current_url() or ""
        except Exception:
            cur = ""
        if cur.startswith(MS_REDIRECT):
            try:
                code = ma.parse_auth_code_url(cur, state)
            except Exception:
                code = None
            break
        time.sleep(0.4)
    try:
        win.destroy()
    except Exception:
        pass
    if not code:
        raise LauncherError("err.login_cancelled")
    try:
        acc = ma.complete_login(MS_CLIENT_ID, None, MS_REDIRECT, code, verifier)
    except Exception as e:
        if "NotOwnMinecraft" in type(e).__name__ or "own" in str(e).lower():
            raise LauncherError("err.no_license")
        raise LauncherError("err.login_failed", msg=str(e)[:120])
    save_account(acc)
    return acc["name"]


_token_cache = {}


def active_login():
    """(username, uuid, access_token) for the game; offline data if no account is active."""
    s = data["settings"]
    acc = next((a for a in data["accounts"] if a["id"] == s.get("account")), None)
    if acc and ms_enabled():
        cached = _token_cache.get(acc["id"])
        if cached and time.time() - cached[1] < 1200:
            return acc["name"], acc["id"], cached[0]
        try:
            new = mll.microsoft_account.complete_refresh(MS_CLIENT_ID, None, MS_REDIRECT, unprotect(acc["refresh"]))
        except Exception:
            raise LauncherError("err.login_expired", name=acc["name"])
        save_account(new)
        _token_cache[new["id"]] = (new["access_token"], time.time())
        return new["name"], new["id"], new["access_token"]
    if ms_enabled() and LICENSE_ONLY:
        raise LauncherError("err.need_account")
    return s["nick"], offline_uuid(s["nick"]), ""


# ---------------- launcher self-update (GitHub Releases) ----------------
_update_info = {}
UPDATE_MIRRORS = ("https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/")


def check_self_update():
    if not UPDATE_REPO:
        return None
    try:
        rel = http_json(f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest")
    except Exception as e:
        # api.github.com is sometimes unreachable (e.g. in Russia): the release info is also published as
        # latest.json on the website and through the jsDelivr CDN
        log(f"update check via GitHub API failed ({type(e).__name__}), trying latest.json")
        rel = None
        user, repo = UPDATE_REPO.split("/")
        for u in (f"https://{user}.github.io/{repo}/latest.json", f"https://cdn.jsdelivr.net/gh/{UPDATE_REPO}@main/docs/latest.json",
                  f"https://fastly.jsdelivr.net/gh/{UPDATE_REPO}@main/docs/latest.json"):
            try:
                rel = http_json(u, 15)
                break
            except Exception:
                continue
        if rel is None:
            raise
    tag = rel.get("tag_name", "").lstrip("vV")
    if version_tuple(tag) <= version_tuple(VERSION):
        return None
    exes = [a for a in rel.get("assets", []) if a.get("name", "").lower().endswith(".exe")]
    # installed copies update by running the new installer silently; the portable Elytra.exe replaces itself
    if is_installed():
        asset = next((a for a in exes if "setup" in a["name"].lower()), None)
    else:
        asset = next((a for a in exes if a["name"].lower() == "elytra.exe"), None) or \
            next((a for a in exes if "setup" not in a["name"].lower()), None)
    if not asset:
        return None
    _update_info.update(version=tag, url=asset["browser_download_url"], digest=asset.get("digest") or "",
                        notes=(rel.get("body") or "")[:1500], size=asset.get("size", 0))
    return {k: _update_info[k] for k in ("version", "notes", "size")}


def is_installed():
    """Installed by Elytra-Setup.exe (Inno Setup leaves its uninstaller next to the exe)."""
    return getattr(sys, "frozen", False) and os.path.isfile(os.path.join(os.path.dirname(sys.executable), "unins000.exe"))


def apply_self_update_job(task):
    if not getattr(sys, "frozen", False) or os.name != "nt":
        raise LauncherError("err.update_exe_only")
    if not _update_info:
        raise LauncherError("err.not_found")
    exe = sys.executable
    new = (os.path.join(tempfile.gettempdir(), "Elytra-Setup.part") if is_installed() else exe + ".new")
    task.set_status(msg("st.download", name=f"Elytra {_update_info['version']}"))
    url = _update_info["url"]
    if not url.startswith("https://"):
        raise LauncherError("err.unsafe_url", url=url)
    digest = _update_info.get("digest", "")
    want = digest[7:].lower() if digest.startswith("sha256:") else ""
    # GitHub's download servers are sometimes unreachable: then try public GitHub download mirrors.
    # A mirror's file is only accepted when its SHA-256 matches the one GitHub published.
    cands = [url] + ([m + url for m in UPDATE_MIRRORS] if want else [])
    last, h = None, None
    for n, u in enumerate(cands):
        if n:
            task.set_status(msg("st.download", name=f"Elytra {_update_info['version']} ({urllib.parse.urlparse(u).hostname})"))
        try:
            h = hashlib.sha256()
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r, open(new, "wb") as f:
                while chunk := r.read(65536):
                    h.update(chunk)
                    f.write(chunk)
            if want and h.hexdigest() != want:
                last = LauncherError("err.corrupt", file="Elytra.exe")
                log(f"update download from {urllib.parse.urlparse(u).hostname}: checksum mismatch")
                continue
            last = None
            break
        except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
            log(f"update download from {urllib.parse.urlparse(u).hostname} failed: {type(e).__name__}: {e}")
            last = LauncherError("err.network", host="GitHub")
    if last:
        try:
            os.remove(new)
        except OSError:
            pass
        raise last
    if want and want != h.hexdigest():
        os.remove(new)
        raise LauncherError("err.corrupt", file="Elytra.exe")
    if is_installed():
        setup = os.path.join(tempfile.gettempdir(), f"Elytra-Setup-{_update_info['version']}.exe")
        os.replace(new, setup)
        # Start the installer only after this process has fully exited: if it runs while Elytra still holds
        # its files, it deletes what it can, fails on the locked rest and leaves a broken install.
        q = setup.replace("'", "''")
        ps = (f"Wait-Process -Id {os.getpid()} -Timeout 90 -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800; "
              f"Start-Process -FilePath '{q}' -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CLOSEAPPLICATIONS'")
        subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", ps],
                         creationflags=0x08000000 | 0x00000200, close_fds=True)
        threading.Timer(0.6, lambda: window.destroy()).start()
        threading.Timer(8.0, lambda: os._exit(0)).start()
        return "done.updating", {"version": _update_info["version"]}
    # Windows lets a running exe be renamed (not deleted). The one-file build runs as two processes
    # (a small launcher plus Python) that keep the file locked a moment after closing, which is why
    # replacing it from a script afterwards used to fail silently and leave the old version.
    old = exe + ".old"
    try:
        if os.path.exists(old):
            os.remove(old)
    except OSError:
        old = exe + f".{int(time.time())}.old"
    os.replace(exe, old)
    try:
        os.replace(new, exe)
    except OSError:
        os.replace(old, exe)          # put the working version back
        raise
    log(f"self-update to {_update_info['version']}: swapped files, restarting")
    subprocess.Popen([exe], creationflags=0x00000008 | 0x00000200, close_fds=True, cwd=os.path.dirname(exe))
    threading.Timer(1.5, lambda: os._exit(0)).start()
    return "done.updating", {"version": _update_info["version"]}


# ---------------- game statistics (read from the worlds' stats files) ----------------
STAT_DISTANCE = ["walk_one_cm", "sprint_one_cm", "crouch_one_cm", "swim_one_cm", "walk_on_water_one_cm",
                 "walk_under_water_one_cm", "fly_one_cm", "aviate_one_cm", "boat_one_cm", "horse_one_cm",
                 "minecart_one_cm", "pig_one_cm", "strider_one_cm", "climb_one_cm"]


def collect_stats(iids):
    tot = dict(diamonds=0, blocks=0, distance=0, elytra=0, deaths=0, mob_kills=0, creepers=0, jumps=0, fish=0,
               ticks=0, crafted=0, trades=0, worlds=0, players=0)
    mined, killed, killed_by = {}, {}, {}

    def merge(dst, src):
        for k, v in (src or {}).items():
            if isinstance(v, (int, float)):
                dst[k] = dst.get(k, 0) + v
    for iid in iids:
        saves = os.path.join(inst_path(iid), "saves")
        if not os.path.isdir(saves):
            continue
        for w in os.listdir(saves):
            sdir = os.path.join(saves, w, "stats")
            if not os.path.isdir(sdir):
                continue
            tot["worlds"] += 1
            for fn in os.listdir(sdir):
                if not fn.endswith(".json"):
                    continue
                try:
                    with open(os.path.join(sdir, fn), encoding="utf-8") as f:
                        st = json.load(f).get("stats", {})
                except (OSError, ValueError):
                    continue
                tot["players"] += 1
                c = st.get("minecraft:custom", {})
                m = st.get("minecraft:mined", {})
                merge(mined, m)
                merge(killed, st.get("minecraft:killed"))
                merge(killed_by, st.get("minecraft:killed_by"))
                tot["blocks"] += sum(v for v in m.values() if isinstance(v, (int, float)))
                tot["diamonds"] += m.get("minecraft:diamond_ore", 0) + m.get("minecraft:deepslate_diamond_ore", 0)
                tot["distance"] += sum(c.get("minecraft:" + k, 0) for k in STAT_DISTANCE)
                tot["elytra"] += c.get("minecraft:aviate_one_cm", 0)
                tot["deaths"] += c.get("minecraft:deaths", 0)
                tot["mob_kills"] += c.get("minecraft:mob_kills", 0)
                tot["jumps"] += c.get("minecraft:jump", 0)
                tot["fish"] += c.get("minecraft:fish_caught", 0)
                tot["trades"] += c.get("minecraft:traded_with_villager", 0)
                tot["ticks"] += c.get("minecraft:play_time", c.get("minecraft:play_one_minute", 0))
                tot["crafted"] += sum(v for v in st.get("minecraft:crafted", {}).values() if isinstance(v, (int, float)))
    tot["creepers"] = killed.get("minecraft:creeper", 0)

    def top(d, n):
        return [[k.split(":")[-1], v] for k, v in sorted(d.items(), key=lambda x: -x[1])[:n]]
    tot.update(top_mined=top(mined, 5), top_killed=top(killed, 5), nemesis=top(killed_by, 1))
    return tot


# ---------------- Elytra Wrapped (monthly recap) ----------------
WRAP_KEYS = ("diamonds", "blocks", "distance", "elytra", "deaths", "mob_kills", "creepers", "jumps", "fish", "crafted", "trades")


def month_key(ts=None):
    return time.strftime("%Y-%m", time.localtime(ts or time.time()))


def snapshot_month():
    """Remembers world-stat totals the first time we see a month, so later we can show what changed in it."""
    try:
        mk = month_key()
        base = data.setdefault("wrapped_base", {})
        if mk not in base:
            st = collect_stats(list(data["instances"]))
            with lock:
                base[mk] = {"t": int(time.time()), **{k: st[k] for k in WRAP_KEYS}}
                for old in sorted(base)[:-14]:
                    base.pop(old, None)
                save()
    except Exception:
        log("wrapped snapshot failed:\n" + traceback.format_exc())


def log_session(iid, start, end):
    with lock:
        pl = data.setdefault("play_log", [])
        pl.append([iid, int(start), int(end)])
        del pl[:-3000]
        save()


PLAYER_TYPES = ("miner", "traveler", "warrior", "pilot", "daredevil", "night_owl", "marathon", "builder", "explorer")


def wrapped(period):
    """period: 'YYYY-MM' or 'all'."""
    now = time.time()
    insts = data["instances"]
    log_all = [s for s in data.get("play_log", []) if s[0] in insts]
    if period == "all":
        sessions = log_all
        per_inst = {iid: i.get("playtime", 0) for iid, i in insts.items()}
        total = sum(per_inst.values())
        n_sessions = sum(i.get("sessions", 0) for i in insts.values())
        st = collect_stats(list(insts))
        delta = {k: st[k] for k in WRAP_KEYS}
        since = None
    else:
        sessions = [s for s in log_all if month_key(s[1]) == period]
        per_inst = {}
        for iid, a, b in sessions:
            per_inst[iid] = per_inst.get(iid, 0) + (b - a)
        total = sum(per_inst.values())
        n_sessions = len(sessions)
        st = collect_stats(list(insts))
        base = data.get("wrapped_base", {}).get(period)
        if base:
            delta = {k: max(0, st[k] - base.get(k, 0)) for k in WRAP_KEYS}
            since = base["t"]
        else:
            delta, since = {k: 0 for k in WRAP_KEYS}, None
    fav = max(per_inst.items(), key=lambda x: x[1], default=(None, 0))
    fav_inst = insts.get(fav[0]) if fav[0] else None
    days = sorted({time.strftime("%Y-%m-%d", time.localtime(a)) for _, a, _ in sessions})
    streak, best = 0, 0
    prev = None
    for d in days:
        t = time.mktime(time.strptime(d, "%Y-%m-%d"))
        streak = streak + 1 if prev is not None and round((t - prev) / 86400) == 1 else 1
        best, prev = max(best, streak), t
    hours = [0] * 24
    for _, a, b in sessions:
        hours[time.localtime(a).tm_hour] += b - a
    peak = max(range(24), key=lambda h: hours[h]) if any(hours) else None
    longest = max((b - a for _, a, b in sessions), default=0)
    night = sum(hours[h] for h in (22, 23, 0, 1, 2, 3, 4)) / max(1, sum(hours))
    km = delta["distance"] / 100000
    scores = {
        "miner": delta["blocks"] / 800, "traveler": km / 15, "warrior": delta["mob_kills"] / 120,
        "pilot": delta["elytra"] / 100000 / 4, "daredevil": delta["deaths"] / 15,
        "night_owl": (night - 0.4) * 4 if sessions else 0, "marathon": (longest / 3600 - 2) if longest else 0,
        "builder": delta["crafted"] / 600,
    }
    ptype = max(scores, key=scores.get)
    if scores[ptype] < 0.5:
        ptype = "explorer"
    top_mined = st["top_mined"][:3]
    mods = sum(1 for i in insts.values() for k in i.get("content", {}) if k.startswith("mods/"))
    if period != "all":
        bump_once("wrapped_seen")
    return {
        "period": period, "since": since, "seconds": int(total), "sessions": n_sessions, "days": len(days), "streak": best,
        "longest": int(longest), "peak_hour": peak, "night_share": round(night, 2),
        "fav": {"id": fav[0], "name": fav_inst["name"], "loader": fav_inst["loader"], "mc": fav_inst["mc"],
                "icon": fav_inst.get("icon"), "seconds": int(fav[1]), "share": round(fav[1] / total, 2) if total else 0} if fav_inst else None,
        "stats": {"km": round(km, 1), "elytra_km": round(delta["elytra"] / 100000, 1), "blocks": delta["blocks"],
                  "diamonds": delta["diamonds"], "deaths": delta["deaths"], "mob_kills": delta["mob_kills"],
                  "creepers": delta["creepers"], "jumps": delta["jumps"], "fish": delta["fish"], "crafted": delta["crafted"]},
        "top_mined": top_mined, "nemesis": (st["nemesis"] or [[None, 0]])[0][0], "type": ptype,
        "instances": len(insts), "mods": mods, "months": sorted({month_key(a) for _, a, _ in log_all}, reverse=True),
        "has_month_stats": bool(period == "all" or data.get("wrapped_base", {}).get(period)),
    }


def bump_once(counter):
    if not data["counters"].get(counter):
        bump(counter)


def save_png(data_url, name):
    if not data_url.startswith("data:image/png;base64,"):
        raise LauncherError("err.generic", msg="bad image")
    png = base64.b64decode(data_url.split(",", 1)[1])
    if png[:8] != b"\x89PNG\r\n\x1a\n" or len(png) > 20_000_000:
        raise LauncherError("err.generic", msg="bad image")
    pics = os.path.join(os.path.expanduser("~"), "Pictures")
    folder = os.path.join(pics if os.path.isdir(pics) else os.path.expanduser("~"), "Elytra")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, re.sub(r"[^\w.-]+", "_", name)[:80] + ".png")
    with open(path, "wb") as f:
        f.write(png)
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select,", path])
    return path


# ---------------- pre-launch check ----------------
BUILTIN_IDS = {"minecraft", "java", "fabricloader", "fabric-loader", "quilt_loader", "quilt_base", "forge", "neoforge",
               "javafml", "fml", "lowcodefml", "mixinextras", "mixin"}
_manifest_cache = {}
TRIPLE = chr(39) * 3


def _toml_blocks(txt):
    """Tiny reader for mods.toml: returns [(header, {key: value})]."""
    blocks, cur = [], ("", {})
    for line in txt.splitlines():
        if line.strip().startswith("description") or TRIPLE in line or '"""' in line:
            continue
        line = line.split("#", 1)[0].strip()
        m = re.match(r"^\[\[?\s*([\w.\-]+)\s*\]\]?$", line)
        if m:
            blocks.append(cur)
            cur = (m.group(1), {})
            continue
        m = re.match(r'^([\w]+)\s*=\s*"?([^"]*)"?\s*$', line)
        if m:
            cur[1][m.group(1)] = m.group(2)
    blocks.append(cur)
    return blocks


def _read_manifest(z, depth=0):
    names = set(z.namelist())
    out = {"ids": set(), "id": None, "deps": {}, "kind": None, "name": None}

    def nested(paths):
        for p in paths:
            if p in names and depth < 2:
                try:
                    with zipfile.ZipFile(io.BytesIO(z.read(p))) as nz:
                        out["ids"] |= _read_manifest(nz, depth + 1)["ids"]
                except Exception:
                    pass
    if "fabric.mod.json" in names:
        j = json.loads(z.read("fabric.mod.json").decode("utf-8", "replace"), strict=False)
        out.update(kind="fabric", id=j.get("id"), name=j.get("name"))
        out["ids"] |= {j.get("id")} | set(x for x in j.get("provides", []) if isinstance(x, str))
        out["deps"] = {k: v for k, v in (j.get("depends") or {}).items()}
        nested([x.get("file") for x in j.get("jars", []) if isinstance(x, dict)])
    elif "quilt.mod.json" in names:
        q = json.loads(z.read("quilt.mod.json").decode("utf-8", "replace")).get("quilt_loader", {})
        out.update(kind="quilt", id=q.get("id"), name=q.get("metadata", {}).get("name"))
        out["ids"] |= {q.get("id")} | {p if isinstance(p, str) else p.get("id") for p in q.get("provides", [])}
        for d in q.get("depends", []):
            if isinstance(d, str):
                out["deps"][d] = "*"
            elif isinstance(d, dict) and d.get("id") and not d.get("optional"):
                out["deps"][d["id"]] = d.get("versions", "*")
        nested([x for x in q.get("jars", []) if isinstance(x, str)])
    else:
        for toml in ("META-INF/neoforge.mods.toml", "META-INF/mods.toml"):
            if toml in names:
                out["kind"] = "forge"
                for head, kv in _toml_blocks(z.read(toml).decode("utf-8", "replace")):
                    if head == "mods" and kv.get("modId"):
                        out["ids"].add(kv["modId"])
                        out["id"] = out["id"] or kv["modId"]
                        if kv.get("displayName") and "${" not in kv["displayName"]:
                            out["name"] = out["name"] or kv["displayName"]
                    elif head.startswith("dependencies") and kv.get("modId"):
                        required = kv.get("mandatory", "").lower() == "true" or kv.get("type", "").lower() == "required"
                        if required:
                            out["deps"][kv["modId"]] = kv.get("versionRange", "*")
                break
    out["ids"].discard(None)
    return out


def mod_manifest(path):
    try:
        key = (path, os.path.getmtime(path))
    except OSError:
        return None
    if key not in _manifest_cache:
        try:
            with zipfile.ZipFile(path) as z:
                _manifest_cache[key] = _read_manifest(z)
        except Exception:
            _manifest_cache[key] = None
    return _manifest_cache[key]


def _maven_ok(rng, v):
    for part in re.findall(r"[\[\(][^\]\)]*[\]\)]", rng):
        m = re.fullmatch(r"([\[\(])\s*([^,\]\)]*)\s*(,\s*([^\]\)]*))?\s*([\]\)])", part)
        if not m:
            continue
        lo, has_comma, hi = m.group(2).strip(), m.group(3), (m.group(4) or "").strip()
        if not has_comma:
            if version_tuple(lo) == v:
                return True
            continue
        ok = True
        if lo:
            ok &= v >= version_tuple(lo) if m.group(1) == "[" else v > version_tuple(lo)
        if hi:
            ok &= v <= version_tuple(hi) if m.group(5) == "]" else v < version_tuple(hi)
        if ok:
            return True
    return False


def mc_matches(rng, mc):
    """Does Minecraft `mc` satisfy a mod's version range? Unknown formats are treated as OK."""
    v = version_tuple(mc)
    if v == (0, 0, 0):
        return True
    if isinstance(rng, list):
        return not rng or any(mc_matches(r, mc) for r in rng)
    rng = str(rng or "*").strip()
    if rng in ("*", ""):
        return True
    try:
        if rng[0] in "[(":
            return _maven_ok(rng, v)
        for cond in re.sub(r"(>=|<=|>|<|=|~|\^)\s+", r"\1", rng).split():
            m = re.fullmatch(r"(>=|<=|>|<|=|~|\^)?(.+)", cond)
            op, target = m.group(1) or "=", m.group(2)
            if "x" in target.lower() or "*" in target:
                pre = [int(p) for p in re.split(r"[.\-]", target) if p.isdigit()]
                ok = list(v[:len(pre)]) == pre
            else:
                t = version_tuple(target)
                if t == (0, 0, 0):
                    continue
                ok = {"=": v == t, ">=": v >= t, "<=": v <= t, ">": v > t, "<": v < t,
                      "~": t <= v < (t[0], t[1] + 1, 0), "^": t <= v < (t[0] + 1, 0, 0)}[op]
            if not ok:
                return False
        return True
    except Exception:
        return True


def preflight(iid):
    inst = get_inst(iid)
    if inst["loader"] == "vanilla":
        return []
    d = os.path.join(inst_path(iid), "mods")
    if not os.path.isdir(d):
        return []
    mods = []
    for fn in sorted(os.listdir(d)):
        full = os.path.join(d, fn)
        if fn.endswith(".jar") and os.path.isfile(full):
            man = mod_manifest(full)
            if man and man["kind"]:
                mods.append((f"mods/{fn}", man))
    provided = set(BUILTIN_IDS)
    for _, man in mods:
        provided |= man["ids"]
    issues, seen, keys = [], {}, set()

    def add(key, action=None, **params):
        sig = (key, json.dumps(params, sort_keys=True))
        if sig not in keys:
            keys.add(sig)
            issues.append({"key": key, "params": params, "action": action})
    loader = inst["loader"]
    for rel, man in mods:
        name = man["name"] or os.path.basename(rel)
        if (loader in ("fabric", "quilt") and man["kind"] == "forge") or (loader == "forge" and man["kind"] in ("fabric", "quilt")):
            add("pre.wrong_loader", {"type": "disable", "rel": rel}, mod=name, kind=man["kind"].capitalize(),
                loader=loader.capitalize())
            continue
        for dep, rng in man["deps"].items():
            if dep == "minecraft":
                if not mc_matches(rng, inst["mc"]):
                    add("doc.wrong_mc", {"type": "disable", "rel": rel}, mod=name, mc=inst["mc"])
            elif dep not in provided:
                add("doc.missing", {"type": "install", "slug": MODID_SLUG.get(dep, dep)}, dep=dep, mod=name)
        if man["id"]:
            if man["id"] in seen:
                add("pre.duplicate", {"type": "disable", "rel": rel}, mod=name, file=os.path.basename(rel),
                    other=os.path.basename(seen[man["id"]]))
            else:
                seen[man["id"]] = rel
    return issues


# ---------------- templates for new instances ----------------
TEMPLATES = {
    "fps": {"loader": "fabric", "mods": BOOST_MODS["fabric"], "boost": True},
    "shaders": {"loader": "fabric", "mods": ["sodium", "iris", "lithium", "ferrite-core", "entityculling"],
                "shaders": ["complementary-reimagined"], "boost": True},
    "vanilla": {"loader": "vanilla"},
}


def template_job(task, iid, tpl):
    result = setup_job(task, iid)
    t = TEMPLATES.get(tpl, {})
    ins = Installer(task, iid)
    for kind, slugs in (("mod", t.get("mods", [])), ("shader", t.get("shaders", []))):
        for slug in slugs:
            try:
                ins.one(slug, kind, optional=True)
            except LauncherError:
                pass
    if t.get("boost"):
        with lock:
            get_inst(iid)["boosted"] = True
            data["settings"]["ram"] = max(data["settings"]["ram"], recommended_ram())
            save()
    return result


# ---------------- clone ----------------
def clone_job(task, iid, name, with_worlds):
    src = get_inst(iid)
    if src.get("status") != "ready":
        raise LauncherError("err.not_ready")
    keep = {k: copy.deepcopy(src[k]) for k in ("version_id", "loader_version", "content", "boosted", "opts", "icon_file", "modpack")
            if k in src}
    new = add_instance(name, src["mc"], src["loader"], src.get("icon"))
    with lock:
        get_inst(new).update(keep)
        save()
    task.set_status(msg("st.copying_files"))
    skip = ["launcher_log.txt", "backups", "session.lock", "crash-reports", "logs", "*.part", ".trash", "shortcut.ico"] + ([] if with_worlds else ["saves"])
    try:
        shutil.copytree(inst_path(iid), inst_path(new), ignore=shutil.ignore_patterns(*skip), dirs_exist_ok=True)
    except Exception:
        get_inst(new)["status"] = "broken"
        save()
        raise
    with lock:
        get_inst(new)["status"] = "ready"
        save()
    return "done.cloned", {"name": name}


# ---------------- skins & capes (licensed accounts) ----------------
MC_API = "https://api.minecraftservices.com"


def ms_token():
    if not ms_enabled() or not data["settings"].get("account"):
        raise LauncherError("err.skin_license")
    return active_login()[2]


def mc_api(path, token, method="GET", body=None, ctype=None):
    headers = {**UA, "Authorization": f"Bearer {token}"}
    if ctype:
        headers["Content-Type"] = ctype
    req = urllib.request.Request(MC_API + path, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def fetch_data_url(url):
    url = url.replace("http://", "https://", 1)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return "data:image/png;base64," + base64.b64encode(r.read(2 * 1024 * 1024)).decode()


def skin_profile():
    prof = mc_api("/minecraft/profile", ms_token())
    skin = next((x for x in prof.get("skins", []) if x.get("state") == "ACTIVE"), None)
    capes = [{"id": c["id"], "alias": c.get("alias", ""), "active": c.get("state") == "ACTIVE",
              "url": fetch_data_url(c["url"]) if c.get("url") else None} for c in prof.get("capes", [])]
    return {"name": prof.get("name"), "skin": fetch_data_url(skin["url"]) if skin else None,
            "slim": bool(skin and skin.get("variant", "").upper() == "SLIM"), "capes": capes}


def upload_skin(path, slim):
    with open(path, "rb") as f:
        raw = f.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024 or raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise LauncherError("err.skin_file")
    w, h = struct.unpack(">II", raw[16:24])
    if (w, h) not in ((64, 64), (64, 32)):
        raise LauncherError("err.skin_file")
    boundary = "----elytra" + secrets.token_hex(8)
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"variant\"\r\n\r\n{'slim' if slim else 'classic'}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"skin.png\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + raw + f"\r\n--{boundary}--\r\n".encode()
    mc_api("/minecraft/profile/skins", ms_token(), "POST", body, f"multipart/form-data; boundary={boundary}")


def set_cape(cape_id):
    token = ms_token()
    if cape_id:
        mc_api("/minecraft/profile/capes/active", token, "PUT", json.dumps({"capeId": cape_id}).encode(), "application/json")
    else:
        mc_api("/minecraft/profile/capes/active", token, "DELETE")


# ---------------- mod sets (collections) ----------------
def public_sets():
    return data["sets"]


def save_set(sid, name, items=None):
    name = str(name or "").strip()[:40]
    if not name:
        raise LauncherError("err.name_required")
    with lock:
        cur = next((x for x in data["sets"] if x["id"] == sid), None)
        if not cur:
            cur = {"id": uuid.uuid4().hex[:10], "items": [], "created": time.time()}
            data["sets"].append(cur)
        cur["name"] = name
        if items is not None:
            seen, clean = set(), []
            for it in items:
                pid = str(it.get("project_id") or "")
                if pid and pid not in seen:
                    seen.add(pid)
                    clean.append({"project_id": pid, "title": str(it.get("title") or pid)[:80],
                                  "icon": it.get("icon") if str(it.get("icon") or "").startswith("https://") else None,
                                  "type": it.get("type") if it.get("type") in FOLDERS else "mod"})
            cur["items"] = clean[:300]
        save()
    check_achievements()
    return data["sets"]


def set_from_instance(iid, name):
    inst = get_inst(iid)
    items = [{"project_id": m.get("project_id"), "title": m.get("title"), "icon": m.get("icon"), "type": m.get("type", "mod")}
             for m in inst.get("content", {}).values() if m.get("project_id")]
    if not items:
        raise LauncherError("err.set_empty")
    return save_set(None, name, items)


def add_to_set(sid, item):
    with lock:
        cur = next((x for x in data["sets"] if x["id"] == sid), None)
        if not cur:
            raise LauncherError("err.not_found")
        items = cur["items"] + [item]
    return save_set(sid, cur["name"], items)


def apply_set_job(task, sid, iid):
    st = next((x for x in data["sets"] if x["id"] == sid), None)
    if not st:
        raise LauncherError("err.not_found")
    inst = get_inst(iid)
    if inst.get("status") != "ready":
        raise LauncherError("err.not_ready")
    ins, missing = Installer(task, iid), []
    task.set_max(len(st["items"]))
    for n, it in enumerate(st["items"], 1):
        if it["type"] == "mod" and inst["loader"] == "vanilla":
            missing.append(it["title"])
            continue
        before = len(ins.installed)
        try:
            ins.one(it["project_id"], it["type"], optional=True)
        except LauncherError:
            pass
        if len(ins.installed) == before and not ins.has(it["project_id"]):
            missing.append(it["title"])
        task.set_progress(n)
    if missing:
        return "done.set_partial", {"n": len(ins.installed), "missing": ", ".join(missing[:8])}
    return "done.set_applied", {"n": len(ins.installed)}


# ---------------- play with a friend (e4mc) ----------------
E4MC_RE = re.compile(r"\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.e4mc\.link)\b", re.I)
friend_links = {}  # iid -> domain


def friend_job(task, iid):
    inst = get_inst(iid)
    if inst["loader"] == "vanilla":
        raise LauncherError("err.friend_vanilla")
    if not any(m.get("title", "").lower() == "e4mc" or "e4mc" in k for k, m in inst.get("content", {}).items()):
        Installer(task, iid).one("e4mc", "mod")
    return "done.friend_ready", {}


def watch_log(iid, path, proc):
    """Follow the game log while it runs: catches the e4mc address to share with friends."""
    pos, stage, started = 0, -1, time.time()
    emit("launch_stage", {"id": iid, "stage": 0, "mods": None})
    while proc.poll() is None:
        time.sleep(0.5 if stage < len(LAUNCH_STAGES) - 1 else 1)
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                f.seek(pos)
                chunk = f.read()
                pos = f.tell()
        except OSError:
            continue
        if stage < len(LAUNCH_STAGES) - 1:
            new, mods = parse_stage(chunk, stage)
            if new != stage or mods:
                stage = max(new, 0)
                emit("launch_stage", {"id": iid, "stage": stage, "mods": mods, "t": int(time.time() - started)})
        m = E4MC_RE.search(chunk)
        if m and friend_links.get(iid) != m.group(1).lower():
            friend_links[iid] = m.group(1).lower()
            with lock:
                data["counters"]["friend_hosts"] = data["counters"].get("friend_hosts", 0) + 1
                save()
            emit("friend_link", {"id": iid, "domain": friend_links[iid]})
            check_achievements()
    friend_links.pop(iid, None)


# ---------------- achievements ----------------
ACHIEVEMENTS = [
    ("first_flight", "wings", "sessions", 1), ("hours_10", "⏱️", "hours", 10), ("hours_100", "🕰️", "hours", 100),
    ("diamond_1", "💎", "diamonds", 1), ("diamond_100", "💠", "diamonds", 100), ("diamond_1000", "👑", "diamonds", 1000),
    ("elytra_10", "🪂", "elytra_km", 10), ("elytra_100", "🚀", "elytra_km", 100), ("walker_100", "👣", "distance_km", 100),
    ("creeper_100", "💥", "creepers", 100), ("mobs_1000", "⚔️", "mob_kills", 1000), ("deaths_100", "💀", "deaths", 100),
    ("fisher_100", "🎣", "fish", 100), ("trader_100", "🤝", "trades", 100), ("jumper_10000", "🦘", "jumps", 10000),
    ("crafter_1000", "🔨", "crafted", 1000), ("mods_50", "🧩", "mods", 50), ("instances_5", "🗂️", "instances", 5),
    ("servers_3", "🌐", "servers", 3), ("modpack_1", "📦", "modpacks", 1), ("boost_1", "⚡", "boosted", 1),
    ("share_1", "🔗", "shared", 1), ("friend_1", "👥", "friend_hosts", 1), ("night_owl", "🦉", "night", 1),
    ("sets_1", "🎒", "sets", 1), ("pilot_50", "🪽", "game_best", 50), ("pilot_200", "🏆", "game_best", 200),
    ("wrapped_1", "🎁", "wrapped", 1),
]


def achievement_metrics():
    st = collect_stats(list(data["instances"]))
    insts = list(data["instances"].values())
    c = data["counters"]
    return {
        "sessions": sum(i.get("sessions", 0) for i in insts), "hours": sum(i.get("playtime", 0) for i in insts) / 3600,
        "diamonds": st["diamonds"], "elytra_km": st["elytra"] / 100000, "distance_km": st["distance"] / 100000,
        "creepers": st["creepers"], "mob_kills": st["mob_kills"], "deaths": st["deaths"], "fish": st["fish"],
        "trades": st["trades"], "jumps": st["jumps"], "crafted": st["crafted"],
        "mods": sum(1 for i in insts for k in i.get("content", {}) if k.startswith("mods/")),
        "instances": len(insts), "servers": len(data["servers"]),
        "modpacks": sum(1 for i in insts if i.get("modpack")), "boosted": sum(1 for i in insts if i.get("boosted")),
        "shared": c.get("shared", 0), "friend_hosts": c.get("friend_hosts", 0), "night": c.get("night", 0),
        "sets": len(data["sets"]), "game_best": data.get("game", {}).get("best", 0), "wrapped": c.get("wrapped_seen", 0),
    }


_ach_lock = threading.Lock()


def check_achievements(notify=True):
    with _ach_lock:
        try:
            m = achievement_metrics()
        except Exception:
            return []
        out, new = [], []
        for aid, emoji, metric, goal in ACHIEVEMENTS:
            val = m.get(metric, 0)
            unlocked = data["achievements"].get(aid)
            if not unlocked and val >= goal:
                unlocked = data["achievements"][aid] = time.time()
                new.append(aid)
            out.append({"id": aid, "emoji": emoji, "value": val, "goal": goal, "unlocked": unlocked})
        if new:
            with lock:
                save()
            if notify:
                for aid in new:
                    a = next(x for x in out if x["id"] == aid)
                    emit("achievement", a)
        return out


def bump(counter):
    with lock:
        data["counters"][counter] = data["counters"].get(counter, 0) + 1
        save()
    check_achievements()


# ---------------- moving over from other launchers ----------------
IMPORT_ITEMS = ["mods", "resourcepacks", "shaderpacks", "config", "defaultconfigs", "kubejs", "options.txt",
                "servers.dat", "screenshots"]
_scan_cache = {}


def parse_version_id(vid):
    """'fabric-loader-0.16.9-1.21.1', '1.20.1-forge-47.2.0', 'Fabric 1.21.1', '1.21.1' -> (mc, loader, loader_version)."""
    vid = (vid or "").strip()
    m = re.match(r"(fabric|quilt)-loader-([\w.+-]+?)-(\d+\.\d+(?:\.\d+)?)$", vid, re.I)
    if m:
        return m.group(3), m.group(1).lower(), m.group(2)
    m = re.match(r"(\d+\.\d+(?:\.\d+)?)-forge-?(\d[\w.]*)", vid, re.I)
    if m:
        return m.group(1), "forge", m.group(2)
    if re.match(r"neoforge", vid, re.I):
        nm = re.search(r"(\d+)\.(\d+)", vid)
        return (f"1.{nm.group(1)}.{nm.group(2)}".replace(".0", "") if nm else None), "neoforge", None
    mc = re.search(r"\b(1\.\d+(?:\.\d+)?)\b", vid)
    if not mc:
        return None, None, None
    low = vid.lower()
    loader = "fabric" if "fabric" in low else "quilt" if "quilt" in low else "forge" if "forge" in low else "vanilla"
    return mc.group(1), loader, None


def _count(path, sub, exts=None):
    d = os.path.join(path, sub)
    if not os.path.isdir(d):
        return 0
    return sum(1 for f in os.listdir(d) if (exts is None and os.path.isdir(os.path.join(d, f))) or (exts and f.lower().endswith(exts)))


def _entry(source, name, path, mc, loader, lv):
    eid = hashlib.sha1(path.encode("utf-8", "replace")).hexdigest()[:12]
    e = {"id": eid, "source": source, "name": (name or source)[:40], "path": path, "mc": mc, "loader": loader,
         "loader_version": lv, "mods": _count(path, "mods", (".jar",)), "worlds": _count(path, "saves"),
         "supported": bool(mc) and loader in ("vanilla", "fabric", "quilt", "forge")}
    _scan_cache[eid] = e
    return e


def guess_from_mods(gdir):
    """Last resort when a launcher keeps no readable metadata: look at fabric.mod.json / mods.toml of the mods."""
    mods = os.path.join(gdir, "mods")
    loader, mc = None, None
    if os.path.isdir(mods):
        for fn in os.listdir(mods)[:60]:
            if not fn.endswith(".jar"):
                continue
            try:
                with zipfile.ZipFile(os.path.join(mods, fn)) as z:
                    names = z.namelist()
                    if "fabric.mod.json" in names:
                        loader = loader or "fabric"
                        dep = json.loads(z.read("fabric.mod.json")).get("depends", {}).get("minecraft")
                        m = re.search(r"1\.\d+(?:\.\d+)?", json.dumps(dep)) if dep else None
                        mc = mc or (m.group(0) if m else None)
                    elif "quilt.mod.json" in names:
                        loader = loader or "quilt"
                    elif "META-INF/neoforge.mods.toml" in names:
                        loader = loader or "neoforge"
                    elif "META-INF/mods.toml" in names:
                        loader = loader or "forge"
            except Exception:
                continue
            if loader and mc:
                break
    return mc, loader, None


def scan_launchers():
    found, home = [], os.path.expanduser("~")
    # official launcher / TLauncher: one shared .minecraft folder
    dot = os.path.join(APPDATA, ".minecraft")
    if os.path.isdir(dot) and (os.path.isdir(os.path.join(dot, "saves")) or os.path.isdir(os.path.join(dot, "mods"))):
        vid = None
        try:
            with open(os.path.join(dot, "launcher_profiles.json"), encoding="utf-8") as f:
                profs = json.load(f).get("profiles", {}).values()
            used = sorted((p for p in profs if p.get("lastVersionId") and not p["lastVersionId"].startswith("latest-")),
                          key=lambda p: p.get("lastUsed", ""), reverse=True)
            vid = used[0]["lastVersionId"] if used else None
        except (OSError, ValueError, KeyError):
            pass
        vdir = os.path.join(dot, "versions")
        if not vid and os.path.isdir(vdir):
            vers = sorted((d for d in os.listdir(vdir) if os.path.isdir(os.path.join(vdir, d))),
                          key=lambda d: os.path.getmtime(os.path.join(vdir, d)), reverse=True)
            vid = vers[0] if vers else None
        tl = os.path.exists(os.path.join(dot, "TlauncherProfiles.json")) or os.path.isdir(os.path.join(APPDATA, ".tlauncher"))
        found.append(_entry("tlauncher" if tl else "official", "TLauncher" if tl else "Minecraft", dot, *parse_version_id(vid)))
    # Prism / PolyMC / MultiMC
    for src, base in (("prism", os.path.join(APPDATA, "PrismLauncher", "instances")), ("prism", os.path.join(APPDATA, "PolyMC", "instances")),
                      ("multimc", os.path.join(APPDATA, "MultiMC", "instances"))):
        if not os.path.isdir(base):
            continue
        for d in os.listdir(base):
            idir = os.path.join(base, d)
            if not os.path.isfile(os.path.join(idir, "mmc-pack.json")):
                continue
            name, mc, loader, lv = d, None, "vanilla", None
            try:
                with open(os.path.join(idir, "instance.cfg"), encoding="utf-8", errors="replace") as f:
                    for line in f:
                        if line.startswith("name="):
                            name = line[5:].strip()
                with open(os.path.join(idir, "mmc-pack.json"), encoding="utf-8") as f:
                    for c in json.load(f).get("components", []):
                        uid, ver = c.get("uid"), c.get("version")
                        if uid == "net.minecraft":
                            mc = ver
                        elif uid in ("net.fabricmc.fabric-loader", "org.quiltmc.quilt-loader", "net.minecraftforge", "net.neoforged"):
                            loader = {"net.fabricmc.fabric-loader": "fabric", "org.quiltmc.quilt-loader": "quilt",
                                      "net.minecraftforge": "forge", "net.neoforged": "neoforge"}[uid]
                            lv = ver
            except (OSError, ValueError):
                continue
            gdir = next((os.path.join(idir, s) for s in (".minecraft", "minecraft") if os.path.isdir(os.path.join(idir, s))), idir)
            found.append(_entry(src, name, gdir, mc, loader, lv))
    # CurseForge
    cf = os.path.join(home, "curseforge", "minecraft", "Instances")
    if os.path.isdir(cf):
        for d in os.listdir(cf):
            idir = os.path.join(cf, d)
            try:
                with open(os.path.join(idir, "minecraftinstance.json"), encoding="utf-8") as f:
                    j = json.load(f)
            except (OSError, ValueError):
                continue
            mc = j.get("gameVersion") or (j.get("baseModLoader") or {}).get("minecraftVersion")
            ml = ((j.get("baseModLoader") or {}).get("name") or "").lower()
            loader, lv = "vanilla", None
            m = re.match(r"(forge|fabric|quilt|neoforge)-([\w.+]+?)(?:-\d+\.\d+(?:\.\d+)?)?$", ml)
            if m:
                loader, lv = m.group(1), m.group(2)
            found.append(_entry("curseforge", j.get("name") or d, idir, mc, loader, lv))
    # Modrinth App: "ModrinthApp" since 0.8.0, "com.modrinth.theseus" before
    seen_mr = set()
    for mr in (os.path.join(APPDATA, "ModrinthApp"), os.path.join(APPDATA, "com.modrinth.theseus")):
        pdir = os.path.join(mr, "profiles")
        if not os.path.isdir(pdir):
            continue
        rows = {}
        try:
            import sqlite3
            con = sqlite3.connect(f"file:{os.path.join(mr, 'app.db')}?mode=ro", uri=True)
            cols = [r[1] for r in con.execute("PRAGMA table_info(profiles)")]
            pick = lambda *names: next((c for c in names if c in cols), None)
            want = [pick("path"), pick("name"), pick("game_version"), pick("mod_loader", "loader"), pick("mod_loader_version", "loader_version")]
            sel = ", ".join(c or "NULL" for c in want)
            for r in con.execute(f"SELECT {sel} FROM profiles"):
                if r[0]:
                    rows[r[0]] = r
            con.close()
        except Exception as e:
            log(f"modrinth app db: {e!r}")
        for d in os.listdir(pdir):          # folders the database doesn't know about (or older versions with profile.json)
            if d in rows or not os.path.isdir(os.path.join(pdir, d)):
                continue
            name, mc, loader, lvv = d, None, None, None
            try:
                with open(os.path.join(pdir, d, "profile.json"), encoding="utf-8") as f:
                    md = json.load(f).get("metadata", {})
                name, mc, loader, lvv = md.get("name") or d, md.get("game_version"), md.get("loader"), md.get("loader_version")
                lvv = lvv.get("id") if isinstance(lvv, dict) else lvv
            except (OSError, ValueError):
                pass
            rows[d] = (d, name, mc, loader, lvv)
        for path, name, mc, loader, lv in rows.values():
            gdir = os.path.join(pdir, path)
            if os.path.isdir(gdir) and os.path.realpath(gdir) not in seen_mr:
                seen_mr.add(os.path.realpath(gdir))
                if not mc:
                    mc, loader2, lv2 = guess_from_mods(gdir)
                    loader, lv = loader or loader2, lv or lv2
                found.append(_entry("modrinth", name or path, gdir, mc, (loader or "vanilla").lower(), lv))
    return found


def import_launcher_job(task, ids, with_worlds):
    """1) copy every instance (they show up right away), 2) install each distinct game version once."""
    entries = [e for e in (_scan_cache[i] for i in ids if i in _scan_cache) if e["supported"]]
    done, made = [], []
    task.set_max(len(entries) * 2)
    step = 0

    def copy_one(e):
        iid = add_instance(e["name"], e["mc"], e["loader"], None, {"imported_from": e["source"]})
        root = inst_path(iid)
        for item in IMPORT_ITEMS + (["saves"] if with_worlds else []):
            src = os.path.join(e["path"], item)
            if os.path.isdir(src):
                shutil.copytree(src, os.path.join(root, item), ignore=shutil.ignore_patterns("session.lock", "*.part"),
                                dirs_exist_ok=True)
            elif os.path.isfile(src):
                shutil.copy2(src, os.path.join(root, item))
        return iid

    task.set_status(msg("st.importing", name=", ".join(e["name"] for e in entries[:3]) + ("…" if len(entries) > 3 else "")))
    with concurrent.futures.ThreadPoolExecutor(4) as ex:      # copying is disk-bound: a few at once is faster
        futs = {ex.submit(copy_one, e): e for e in entries}
        for f in concurrent.futures.as_completed(futs):
            step += 1
            task.set_progress(step)
            try:
                made.append((futs[f], f.result()))
            except Exception:
                log(f"import copy failed for {futs[f]['name']}:\n" + traceback.format_exc())
    push_instances()
    groups = {}
    for e, iid in made:
        groups.setdefault((e["mc"], e["loader"], e["loader_version"]), []).append(iid)
    for (mc, loader, lv), iids in groups.items():
        task.set_status(msg("st.importing", name=get_inst(iids[0])["name"]))
        try:
            try:
                vid, lv2 = ensure_version(mc, loader, lv, task)
            except Exception:
                vid, lv2 = ensure_version(mc, loader, None, task)   # that exact loader build may be gone — take the latest
            with lock:
                for iid in iids:
                    get_inst(iid).update(version_id=vid, loader_version=lv2, status="ready")
                save()
            done += [get_inst(i)["name"] for i in iids]
        except Exception:
            log(f"import install failed for {loader} {mc}:\n" + traceback.format_exc())
            with lock:
                for iid in iids:
                    get_inst(iid)["status"] = "broken"
                save()
        step += len(iids)
        task.set_max(len(entries) * 2)
        task.set_progress(step)
        push_instances()
    check_achievements()
    return "done.imported_launchers", {"n": len(done)}


# ---------------- desktop shortcuts & one running copy ----------------
INSTANCE_FILE = os.path.join(BASE, "running.json")
HIDDEN = {"on": False, "shortcut": False}
PENDING = []


def png_to_ico(png):
    w, h = struct.unpack(">II", png[16:24])
    entry = struct.pack("<BBBBHHII", w if w < 256 else 0, h if h < 256 else 0, 0, 0, 1, 32, len(png), 22)
    return struct.pack("<HHH", 0, 1, 1) + entry + png


def shortcut_icon(iid):
    inst, root = get_inst(iid), inst_path(iid)
    png = None
    if inst.get("icon_file", "").endswith(".png"):
        with open(os.path.join(root, inst["icon_file"]), "rb") as f:
            png = f.read()
    elif str(inst.get("icon") or "").startswith("https://"):
        try:
            png = read_all(open_url(inst["icon"], 15), 1024 * 1024)
        except Exception:
            png = None
    if png and png[:8] == b"\x89PNG\r\n\x1a\n" and max(struct.unpack(">II", png[16:24])) <= 256:
        path = os.path.join(root, "shortcut.ico")
        with open(path, "wb") as f:
            f.write(png_to_ico(png))
        return path
    return resource("icon.ico")


def create_shortcut(iid):
    if os.name != "nt":
        raise LauncherError("err.windows_only")
    inst = get_inst(iid)
    if getattr(sys, "frozen", False):
        target, args = sys.executable, f'--play "{iid}"'
    else:
        pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
        target, args = (pyw if os.path.exists(pyw) else sys.executable), f'"{os.path.abspath(__file__)}" --play "{iid}"'
    name = (re.sub(r'[\\/:*?"<>|]+', "_", inst["name"]).strip() or "Minecraft") + ".lnk"
    ps = ("$d=[Environment]::GetFolderPath('Desktop');$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d $env:ELY_NAME));"
          "$s.TargetPath=$env:ELY_TARGET;$s.Arguments=$env:ELY_ARGS;$s.IconLocation=$env:ELY_ICON;$s.WorkingDirectory=$env:ELY_WD;"
          "$s.Description='Elytra';$s.Save()")
    env = {**os.environ, "ELY_NAME": name, "ELY_TARGET": target, "ELY_ARGS": args, "ELY_ICON": shortcut_icon(iid),
           "ELY_WD": os.path.dirname(target)}
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
                       env=env, capture_output=True, timeout=30, creationflags=0x08000000)
    if r.returncode != 0:
        raise LauncherError("err.shortcut")
    return name[:-4]


def build_stamp():
    """Identifies this exact build: an old copy still running must not swallow a freshly installed one."""
    path = sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__)
    try:
        return f"{VERSION}|{path}|{int(os.path.getmtime(path))}"
    except OSError:
        return VERSION


def handoff(cmd, arg=""):
    """If Elytra already runs, pass the command to it and return True.
    If the running copy is an older build, ask it to quit and start fresh instead."""
    try:
        with open(INSTANCE_FILE, encoding="utf-8") as f:
            info = json.load(f)
        if info.get("build") != build_stamp():
            url = f"http://127.0.0.1:{int(info['port'])}/{info['token']}/cmd/quit/-"
            try:
                urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=2).close()
                time.sleep(1.5)
            except Exception:
                pass
            return False
        url = f"http://127.0.0.1:{int(info['port'])}/{info['token']}/cmd/{cmd}/{urllib.parse.quote(arg or '-')}"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url, timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def run_command(cmd, arg):
    if cmd == "quit":
        log("a newer Elytra build started, closing this one")
        threading.Timer(0.3, lambda: os._exit(0)).start()
        return
    if cmd == "play" and arg in data["instances"]:
        threading.Thread(target=shortcut_play, args=(arg,), daemon=True).start()
    show_window()


def show_window():
    if window is not None and HIDDEN["on"]:
        HIDDEN["on"] = False
        try:
            window.show()
        except Exception:
            pass
    try:
        window.restore()
    except Exception:
        pass


def shortcut_play(iid):
    res = Api().play(iid)
    if not res.get("ok"):
        PENDING.append({"type": "toast", **res["error"], "kind": "error"})
        show_window()
        emit("toast", {**res["error"], "kind": "error"})
    elif res.get("data") and res["data"].get("issues"):
        PENDING.append({"type": "preflight", "id": iid, "issues": res["data"]["issues"]})
        show_window()
        emit("preflight", {"id": iid, "issues": res["data"]["issues"]})


# ---------------- game start progress ----------------
LAUNCH_STAGES = [
    ("java", re.compile(r"Setting user:|Loading Minecraft|ModLauncher running|Loading for game Minecraft|Launching target")),
    ("mods", re.compile(r"Loading (\d+) mods|Found (\d+) mods|Mod file .* loaded|Loading \d+ mods")),
    ("window", re.compile(r"Backend library: LWJGL|LWJGL version")),
    ("resources", re.compile(r"Reloading ResourceManager|Created: \d+x\d+x\d+ minecraft:textures/atlas")),
    ("ready", re.compile(r"Sound engine started|OpenAL initialized|Narrator library successfully loaded|Loaded \d+ advancements")),
]


def parse_stage(text, current):
    """Returns (stage index, mods count or None) after reading a new chunk of the game log."""
    mods = None
    m = re.search(r"Loading (\d+) mods|Found (\d+) mods", text)
    if m:
        mods = int(m.group(1) or m.group(2))
    for idx, (_, rx) in enumerate(LAUNCH_STAGES):
        if idx > current and rx.search(text):
            current = idx
    return current, mods


# ---------------- modpack versions ----------------
def pack_versions(pid):
    out = []
    for v in api(f"/project/{pid}/version")[:80]:
        out.append({"id": v["id"], "name": v.get("name") or v["version_number"], "number": v["version_number"],
                    "mc": v.get("game_versions", []), "loaders": v.get("loaders", []), "date": v.get("date_published", "")[:10],
                    "type": v.get("version_type", "release")})
    return out


# ---------------- similar mods ----------------
COMPANIONS = {
    "sodium": ["sodium-extra", "reeses-sodium-options"], "iris": ["sodium"], "fabric-api": ["modmenu"],
    "xaeros-minimap": ["xaeros-world-map"], "xaeros-world-map": ["xaeros-minimap"], "lithium": ["ferrite-core"],
    "jei": ["jade"], "rei": ["jade"], "emi": ["jade"], "jade": ["appleskin"], "appleskin": ["jade"],
    "farmers-delight": ["appleskin"], "waystones": ["balm"], "terralith": ["tectonic"], "tectonic": ["terralith"],
    "create": ["jei"], "journeymap": ["jade"], "simple-voice-chat": ["sound-physics-remastered"],
}
SKIP_CATS = {"fabric", "forge", "quilt", "neoforge", "library", "minecraft", "datapack"}
_suggest_cache = {}


def suggest(iid):
    inst = get_inst(iid)
    if inst["loader"] == "vanilla":
        return []
    ids = sorted({m["project_id"] for m in inst.get("content", {}).values() if m.get("project_id")})
    key = (iid, tuple(ids))
    if key in _suggest_cache and time.time() - _suggest_cache[key][0] < 1800:
        return _suggest_cache[key][1]
    if not ids:
        return []
    projs = api("/projects", {"ids": json.dumps(ids[:100])})
    seen = set(ids) | {p["slug"] for p in projs}
    out = []

    def fits(p):
        return inst["mc"] in p.get("game_versions", inst["mc"] and [inst["mc"]]) and inst["loader"] in p.get("loaders", [inst["loader"]])

    def add(p, reason):
        pid = p.get("project_id") or p.get("id")
        if pid in seen or p.get("slug") in seen:
            return
        seen.update({pid, p.get("slug")})
        out.append({"project_id": pid, "title": p.get("title"), "description": p.get("description", ""), "icon_url": p.get("icon_url"),
                    "downloads": p.get("downloads", 0), "reason": reason})
    want = {}
    for p in projs:
        for s in COMPANIONS.get(p.get("slug"), []):
            if s not in seen:
                want.setdefault(s, p["title"])
    if want:
        try:
            for c in api("/projects", {"ids": json.dumps(list(want))}):
                if fits(c) and c.get("project_type", "mod") == "mod":
                    add(c, msg("sug.with", name=want.get(c["slug"], "")))
        except Exception:
            pass
    cats = {}
    for p in projs:
        if p.get("project_type") == "mod":
            for c in p.get("categories", []):
                if c not in SKIP_CATS:
                    cats[c] = cats.get(c, 0) + 1
    for cat, _ in sorted(cats.items(), key=lambda x: -x[1])[:2]:
        try:
            res = api("/search", {"index": "downloads", "limit": 20, "facets": json.dumps(
                [["project_type:mod"], [f"categories:{cat}"], [f"versions:{inst['mc']}"], [f"categories:{inst['loader']}"]])})
        except Exception:
            continue
        n = 0
        for h in res.get("hits", []):
            if n >= 3:
                break
            before = len(out)
            add(h, msg("sug.like", cat=cat))
            n += len(out) - before
    out = out[:8]
    _suggest_cache[key] = (time.time(), out)
    return out


# ---------------- launch ----------------
def offline_uuid(name):
    h = bytearray(hashlib.md5(("OfflinePlayer:" + name).encode()).digest())
    h[6] = (h[6] & 0x0F) | 0x30
    h[8] = (h[8] & 0x3F) | 0x80
    return uuid.UUID(bytes=bytes(h)).hex


def launch(iid, server):
    try:
        inst = get_inst(iid)
        s = data["settings"]
        if inst.get("dirty") and s.get("auto_backup") and has_worlds(iid):
            task = Task("task.backup", name=inst["name"])
            task.set_status(msg("st.backup"))
            try:
                backup_saves(iid, "auto")
                task.finish(("done.backup", {}))
            except Exception as e:
                task.finish(error=error_msg(e))
        with lock:
            inst["dirty"] = False
            save()
        o = inst.get("opts", {})
        ram = o.get("ram") or s["ram"]
        jvm = [f"-Xmx{ram}M", f"-Xms{min(ram, 1024)}M"] + (BOOST_JVM if inst.get("boosted") else [])
        if o.get("jvm"):
            try:
                jvm += shlex.split(o["jvm"])
            except ValueError:
                pass
        username, player_uuid, token = active_login()
        opts = {"username": username, "uuid": player_uuid, "token": token,
                "gameDirectory": inst_path(iid), "launcherName": "Elytra", "launcherVersion": VERSION,
                "jvmArguments": jvm}
        if o.get("java") or s["java"]:
            opts["executablePath"] = o.get("java") or s["java"]
        if o.get("width") and o.get("height"):
            opts.update(customResolution=True, resolutionWidth=str(o["width"]), resolutionHeight=str(o["height"]))
        ensure_version_jar(inst["version_id"])
        cmd = mll.command.get_minecraft_command(inst["version_id"], BASE, opts)
        if o.get("fullscreen"):
            cmd.append("--fullscreen")
        if server:
            host, port = parse_address(server)
            if version_tuple(inst["mc"]) >= (1, 20, 0):
                cmd += ["--quickPlayMultiplayer", f"{host}:{port}" if port else host]
            else:
                cmd += ["--server", host, "--port", str(port or 25565)]
        logf = open(os.path.join(inst_path(iid), "launcher_log.txt"), "w", encoding="utf-8", errors="replace")
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            proc = subprocess.Popen(cmd, cwd=inst_path(iid), stdout=logf, stderr=subprocess.STDOUT, creationflags=flags)
        except FileNotFoundError:
            logf.close()
            raise LauncherError("err.no_java")
        started = time.time()
        with lock:
            running[iid] = proc
            launching.discard(iid)
            inst["last_played"] = started
            save()
        game_sessions[iid] = {"start": int(started), "server": server}
        threading.Thread(target=watch_log, args=(iid, logf.name, proc), daemon=True).start()
        if time.localtime(started).tm_hour < 5:
            bump("night")
        push_instances()
        update_presence()
        code = proc.wait()
        game_sessions.pop(iid, None)
        logf.close()
        with lock:
            running.pop(iid, None)
            inst["playtime"] = inst.get("playtime", 0) + int(time.time() - started)
            inst["sessions"] = inst.get("sessions", 0) + 1
            save()
        if time.time() - started > 30:
            log_session(iid, started, time.time())
        threading.Thread(target=snapshot_month, daemon=True).start()
        was_stopped = iid in stopped
        stopped.discard(iid)
        push_instances()
        if code != 0 and not was_stopped:
            show_window()
            emit("crash", {"id": iid, "code": code})
        elif HIDDEN["on"] and HIDDEN["shortcut"] and not running:
            threading.Timer(1.0, lambda: window.destroy()).start()  # started from a desktop shortcut: nothing left to do
        check_achievements()
    except Exception as e:
        if not isinstance(e, LauncherError):
            log("launch failed:\n" + traceback.format_exc())
        emit("toast", {**error_msg(e), "kind": "error"})
    finally:
        launching.discard(iid)
        push_instances()
        update_presence()


# ---------------- API for the UI ----------------
def endpoint(fn):
    @functools.wraps(fn)
    def wrapper(*a, **k):
        try:
            return {"ok": True, "data": fn(*a, **k)}
        except Exception as e:
            if not isinstance(e, LauncherError):
                log(f"{fn.__name__} failed:\n" + traceback.format_exc())
            return {"ok": False, "error": error_msg(e)}
    return wrapper


class Api:
    @endpoint
    def init(self):
        return {"instances": instances_list(), "settings": data["settings"], "servers": data["servers"],
                "version": VERSION, "ram_total": system_ram_mb(), "ram_recommended": recommended_ram(),
                "media": MEDIA_BASE, "net": net_status(), "sup_unread": support_unread(), "game": data.get("game", {"best": 0, "plays": 0}), "log": os.path.join(BASE, "elytra.log"), "accounts": public_accounts(), "sets": public_sets(),
                "pending": [PENDING.pop(0) for _ in range(len(PENDING))],
                "features": {"ms": ms_enabled(), "license_only": ms_enabled() and LICENSE_ONLY,
                             "discord": bool(DISCORD_CLIENT_ID), "updates": bool(UPDATE_REPO),
                             "exe": bool(getattr(sys, "frozen", False))}}

    @endpoint
    def get_versions(self, snapshots=False):
        kinds = ("release", "snapshot") if snapshots else ("release",)
        return [v["id"] for v in mll.utils.get_version_list() if v["type"] in kinds]

    @endpoint
    def get_all_versions(self):
        """Every version Mojang lists, from today's releases back to the first alphas."""
        return [{"id": v["id"], "type": v["type"]} for v in mll.utils.get_version_list()]

    @endpoint
    def save_settings(self, s):
        with lock:
            nick = str(s.get("nick", "")).strip()
            if not re.fullmatch(r"[A-Za-z0-9_]{3,16}", nick):
                raise LauncherError("err.nick")
            accent = str(s.get("accent") or "")
            if accent and not re.fullmatch(r"#[0-9a-fA-F]{6}", accent):
                accent = ""
            account = s.get("account") or ""
            if account and not any(a["id"] == account for a in data["accounts"]):
                account = ""
            data["settings"].update(
                nick=nick, ram=max(1024, min(65536, int(s.get("ram", 4096)))), java=str(s.get("java", "")).strip(),
                snapshots=bool(s.get("snapshots")), splash=bool(s.get("splash", True)),
                theme=s.get("theme") if s.get("theme") in THEMES else "emerald",
                lang=s.get("lang") if s.get("lang") in LANGS else "en",
                auto_backup=bool(s.get("auto_backup", True)),
                backups_keep=max(1, min(30, int(s.get("backups_keep", 5)))),
                accent=accent, discord=bool(s.get("discord", True)), account=account,
                onboarded=bool(s.get("onboarded", data["settings"].get("onboarded"))),
                streamer=bool(s.get("streamer", False)), navwide=bool(s.get("navwide", False)),
                navpos="left" if s.get("navpos") == "left" else "bottom",
                netsrc=s.get("netsrc") if s.get("netsrc") in ("auto", "official", "mirror") else "auto")
            save()
        update_presence()
        return data["settings"]

    # --- instances ---
    @endpoint
    def create_instance(self, name, mc, loader, icon_path=None, template=None):
        name = name.strip()
        if not name:
            raise LauncherError("err.name_required")
        if template in TEMPLATES:
            loader = TEMPLATES[template]["loader"]
        iid = add_instance(name, mc, loader)
        if icon_path:
            try:
                apply_icon(iid, icon_path)
            except LauncherError as e:
                emit("toast", {**error_msg(e), "kind": "error"})
            push_instances()
        if template in TEMPLATES:
            run_task("task.create", {"name": name}, template_job, iid, template)
        else:
            run_task("task.create", {"name": name}, setup_job, iid)
        return iid

    @endpoint
    def repair_instance(self, iid):
        inst = get_inst(iid)
        inst["status"] = "installing"
        save()
        push_instances()
        run_task("task.repair", {"name": inst["name"]}, setup_job, iid, inst.get("loader_version"), True)

    @endpoint
    def delete_instance(self, iid):
        if iid in running or iid in launching:
            raise LauncherError("err.close_game")
        with lock:
            data["instances"].pop(iid, None)
            for srv in data["servers"]:
                if srv.get("instance") == iid:
                    srv["instance"] = None
            save()
        shutil.rmtree(inst_path(iid), ignore_errors=True)
        push_instances()

    @endpoint
    def pick_image(self):
        path = file_dialog("OPEN", allow_multiple=False,
                           file_types=("Images (*.png;*.jpg;*.jpeg;*.gif;*.webp)",))
        return {"path": path, "preview": image_data_url(path)} if path else None

    @endpoint
    def set_icon(self, iid, path=None):
        apply_icon(iid, path)
        push_instances()

    # --- content ---
    @endpoint
    def get_content(self, iid):
        inst, root, items, unknown = get_inst(iid), inst_path(iid), [], []
        meta = inst.get("content", {})
        for kind, folder in FOLDERS.items():
            d = os.path.join(root, folder)
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d), key=str.lower):
                full = os.path.join(d, fn)
                if not os.path.isfile(full) or fn.endswith(".part"):
                    continue
                enabled = not fn.endswith(".disabled")
                clean = fn if enabled else fn[:-len(".disabled")]
                rel = f"{folder}/{clean}"
                m = meta.get(rel, {})
                if not m.get("project_id"):
                    unknown.append((rel, full))
                loc = local_meta(full)  # the icon packed inside the mod / pack itself comes first
                items.append(dict(rel=rel, file=clean, type=kind, enabled=enabled,
                                  title=m.get("title") or loc.get("title") or clean,
                                  icon=loc.get("icon") or m.get("icon"), version=m.get("version"),
                                  project_id=m.get("project_id")))
        if unknown:
            lookup_unknown(iid, unknown)
        return items

    @endpoint
    def toggle_content(self, iid, rel):
        on = safe_join(inst_path(iid), rel)
        off = on + ".disabled"
        if os.path.exists(on):
            os.replace(on, off)
        elif os.path.exists(off):
            os.replace(off, on)
        mark_dirty(iid)

    @endpoint
    def remove_content(self, iid, rel):
        """Moves the file to the instance trash so it can be brought back with «Undo»."""
        on = safe_join(inst_path(iid), rel)
        trash = os.path.join(inst_path(iid), ".trash")
        os.makedirs(trash, exist_ok=True)
        token = None
        for p in (on, on + ".disabled"):
            if os.path.exists(p):
                token = f"{int(time.time() * 1000)}_{os.path.basename(p)}"
                os.replace(p, os.path.join(trash, token))
        with lock:
            meta = get_inst(iid)["content"].pop(rel, None)
            if token:
                get_inst(iid).setdefault("trash", {})[token] = {"rel": rel, "meta": meta, "disabled": token.endswith(".disabled")}
            save()
        mark_dirty(iid)
        return token

    @endpoint
    def restore_content(self, iid, token):
        inst = get_inst(iid)
        item = inst.get("trash", {}).get(token)
        src = safe_join(os.path.join(inst_path(iid), ".trash"), token)
        if not item or not os.path.exists(src):
            raise LauncherError("err.not_found")
        dest = safe_join(inst_path(iid), item["rel"]) + (".disabled" if item["disabled"] else "")
        os.replace(src, dest)
        with lock:
            inst["trash"].pop(token, None)
            if item.get("meta"):
                inst["content"][item["rel"]] = item["meta"]
            save()
        mark_dirty(iid)

    @endpoint
    def get_wrapped(self, period=None):
        return wrapped(period or month_key())

    @endpoint
    def save_image(self, data_url, name):
        return save_png(data_url, name)

    @endpoint
    def game_score(self, score):
        score = max(0, min(100000, int(score)))
        with lock:
            g = data.setdefault("game", {"best": 0, "plays": 0})
            g["plays"] = g.get("plays", 0) + 1
            new = score > g.get("best", 0)
            if new:
                g["best"] = score
            save()
        check_achievements()
        return {"best": g["best"], "new": new, "plays": g["plays"]}

    @endpoint
    def toggle_fullscreen(self):
        if window is not None:
            window.toggle_fullscreen()

    @endpoint
    def set_discord(self, on):
        with lock:
            data["settings"]["discord"] = bool(on)
            save()
        if not on:
            update_presence(wait=True)
            return {"ok": False, "off": True}
        return update_presence(wait=True)

    @endpoint
    def open_app_log(self):
        path = os.path.join(BASE, "elytra.log")
        if not os.path.exists(path):
            log("log opened")
        os.startfile(path) if os.name == "nt" else subprocess.Popen(["xdg-open", path])

    @endpoint
    def support_report(self, note=""):
        """Collect a short diagnostic report, copy it, open a prefilled GitHub issue."""
        text = build_report()
        copied = copy_text(text)
        q = {"template": "bug_report.yml", "version": VERSION}
        if note:
            q["title"] = str(note)[:120]
        webbrowser.open(f"https://github.com/{UPDATE_REPO}/issues/new?" + urllib.parse.urlencode(q))
        return {"copied": copied, "text": text}

    @endpoint
    def support_chat(self, poll=False):
        st = support_state()
        enabled = bool(support_cfg())
        if enabled and poll and st.get("msgs"):
            try:
                support_poll()
            except LauncherError:
                pass
        with lock:
            st["seen"] = max([int(time.time())] + [m.get("ts", 0) for m in st.get("msgs", [])])
            save()
        return {"enabled": enabled, "msgs": support_public(st)}

    @endpoint
    def support_send(self, text, report=False):
        text = str(text or "").strip()[:1500]
        if not text:
            raise LauncherError("sup.empty")
        st = support_state()
        acc = next((a for a in data["accounts"] if a["id"] == data["settings"].get("account")), None)
        name = (acc["name"] if acc else data["settings"].get("nick", ""))[:32]
        msg = {"t": "msg", "tid": st["tid"], "id": secrets.token_hex(6), "text": text, "ts": int(time.time()), "name": name, "ver": VERSION}
        if report:
            msg["rep"] = build_report(80)
        support_publish(support_fit(msg))
        with lock:
            st["msgs"].append({"id": msg["id"], "from": "me", "text": text, "ts": msg["ts"], "sent_at": time.time(),
                               "name": name, "rep": msg.get("rep", "")})
            st["msgs"] = st["msgs"][-200:]
            st["seen"] = max([int(time.time())] + [m.get("ts", 0) for m in st["msgs"]])
            save()
        return {"msgs": support_public(st)}

    @endpoint
    def recheck_network(self):
        for g in NET_GROUPS:
            NET[g] = None
            NET_READY[g].clear()
        probe_network()

    @endpoint
    def set_context(self, iid=None):
        DROP_CONTEXT["iid"] = iid if iid in data["instances"] else None

    @endpoint
    def open_project_page(self, pid):
        if re.fullmatch(r"[\w-]{2,64}", str(pid or "")):
            webbrowser.open(f"https://modrinth.com/project/{pid}")

    @endpoint
    def search(self, p):
        kind = p.get("type", "mod")
        facets = [[f"project_type:{kind}"]]
        if p.get("version"):
            facets.append([f"versions:{p['version']}"])
        if p.get("loader") and kind in ("mod", "modpack"):
            facets.append([f"categories:{p['loader']}"])
        res = api("/search", {"query": p.get("query", ""), "index": p.get("sort", "relevance"),
                              "offset": int(p.get("offset", 0)), "limit": 20, "facets": json.dumps(facets)})
        return {"hits": res["hits"], "total": res["total_hits"]}

    @endpoint
    def get_project(self, pid):
        return api(f"/project/{pid}")

    @endpoint
    def install_project(self, pid, ptype, iid):
        run_task("task.install", {"name": get_inst(iid)["name"]}, install_project_job, pid, ptype, iid)

    @endpoint
    def install_modpack(self, pid, title, version_id=None):
        run_task("task.modpack", {"name": title}, install_modpack_job, pid, version_id)

    @endpoint
    def pack_versions(self, pid):
        return pack_versions(pid)

    # --- boost / doctor ---
    @endpoint
    def boost(self, iid):
        run_task("task.boost", {"name": get_inst(iid)["name"]}, boost_job, iid)

    @endpoint
    def diagnose(self, iid):
        return diagnose(iid)

    @endpoint
    def doctor_fix(self, iid, action):
        t = action.get("type")
        if t == "install":
            run_task("task.install", {"name": get_inst(iid)["name"]}, install_project_job, action["slug"], "mod", iid)
        elif t == "disable":
            on = safe_join(inst_path(iid), action["rel"])
            if os.path.exists(on):
                os.replace(on, on + ".disabled")
            mark_dirty(iid)
        elif t == "ram":
            with lock:
                data["settings"]["ram"] = max(1024, min(65536, int(action["value"])))
                save()
        elif t == "java_auto":
            with lock:
                data["settings"]["java"] = ""
                save()
        return data["settings"]

    @endpoint
    def open_log(self, iid):
        p = os.path.join(inst_path(iid), "launcher_log.txt")
        if os.path.exists(p):
            os.startfile(p) if os.name == "nt" else subprocess.Popen(["xdg-open", p])

    # --- share ---
    @endpoint
    def export_instance(self, iid):
        inst = get_inst(iid)
        safe = re.sub(r'[\\/:*?"<>|]+', "_", inst["name"]) or "instance"
        dest = file_dialog("SAVE", save_filename=f"{safe}.mrpack")
        if not dest:
            return None
        if not dest.lower().endswith(".mrpack"):
            dest += ".mrpack"
        run_task("task.export", {"name": inst["name"]}, export_job, iid, dest)
        return True

    @endpoint
    def import_pack(self, path=None):
        path = path or file_dialog("OPEN", allow_multiple=False, file_types=("Modrinth pack (*.mrpack)",))
        if not path:
            return None
        run_task("task.import", {"file": os.path.basename(path)}, import_job, path)
        return True

    # --- backups ---
    @endpoint
    def list_backups(self, iid):
        d = backups_dir(iid)
        if not os.path.isdir(d):
            return []
        out = []
        for f in sorted(os.listdir(d), reverse=True):
            if f.endswith(".zip"):
                p = os.path.join(d, f)
                out.append({"name": f, "size": os.path.getsize(p), "time": os.path.getmtime(p),
                            "reason": f[:-4].split("_", 2)[-1] if f.count("_") >= 2 else "manual"})
        return out

    @endpoint
    def backup_now(self, iid):
        if not has_worlds(iid):
            raise LauncherError("err.no_worlds")
        run_task("task.backup", {"name": get_inst(iid)["name"]}, backup_job, iid)

    @endpoint
    def restore_backup(self, iid, name):
        run_task("task.restore", {"name": get_inst(iid)["name"]}, restore_job, iid, name)

    @endpoint
    def delete_backup(self, iid, name):
        p = safe_join(backups_dir(iid), name)
        if os.path.isfile(p):
            os.remove(p)

    # --- servers ---
    @endpoint
    def save_server(self, srv):
        name = str(srv.get("name", "")).strip()[:40]
        addr = str(srv.get("address", "")).strip()
        parse_address(addr)
        with lock:
            existing = next((x for x in data["servers"] if x["id"] == srv.get("id")), None)
            item = existing or {"id": uuid.uuid4().hex[:10]}
            item.update(name=name or addr, address=addr, instance=srv.get("instance") or None)
            if not existing:
                data["servers"].append(item)
            save()
        check_achievements()
        return data["servers"]

    @endpoint
    def remove_server(self, sid):
        with lock:
            data["servers"] = [x for x in data["servers"] if x["id"] != sid]
            save()
        return data["servers"]

    @endpoint
    def ping_server(self, address):
        try:
            return mc_ping(address)
        except LauncherError:
            raise
        except Exception:
            return {"online": False}

    # --- game ---
    @endpoint
    def play(self, iid, server=None, force=False):
        inst = get_inst(iid)
        if iid in running or iid in launching:
            raise LauncherError("err.already_running")
        if inst.get("status") != "ready":
            raise LauncherError("err.instance_not_ready")
        if server:
            parse_address(server)
        if not force:
            issues = preflight(iid)
            if issues:
                return {"issues": issues}
        launching.add(iid)
        push_instances()
        threading.Thread(target=launch, args=(iid, server), daemon=True).start()

    @endpoint
    def stop(self, iid):
        p = running.get(iid)
        if p:
            stopped.add(iid)
            p.terminate()

    # --- mod updates ---
    @endpoint
    def check_updates(self, iid):
        return check_updates(iid)

    @endpoint
    def update_content(self, iid, rels=None):
        run_task("task.update", {"name": get_inst(iid)["name"]}, update_content_job, iid, rels)

    # --- screenshots & worlds ---
    @endpoint
    def list_screenshots(self, iid):
        get_inst(iid)
        return list_screenshots(iid)

    @endpoint
    def delete_screenshot(self, iid, name):
        p = safe_join(os.path.join(inst_path(iid), "screenshots"), name)
        if os.path.isfile(p):
            os.remove(p)

    @endpoint
    def list_worlds(self, iid):
        get_inst(iid)
        return list_worlds(iid)

    @endpoint
    def copy_world(self, iid, folder, target):
        run_task("task.copy_world", {"name": folder}, copy_world_job, iid, folder, target)

    @endpoint
    def delete_world(self, iid, folder):
        if iid in running:
            raise LauncherError("err.close_game")
        path = safe_join(os.path.join(inst_path(iid), "saves"), folder)
        if not os.path.isdir(path):
            raise LauncherError("err.not_found")
        backup_saves(iid, "deleted-world", only=folder)  # can be restored from World backups
        shutil.rmtree(path)

    # --- news / links ---
    @endpoint
    def get_news(self):
        return get_news()

    @endpoint
    def open_url(self, url):
        if isinstance(url, str) and url.startswith("https://"):
            webbrowser.open(url)

    # --- accounts ---
    @endpoint
    def ms_login(self):
        name = ms_login_flow()
        update_presence()
        return {"name": name, "accounts": public_accounts(), "settings": data["settings"]}

    @endpoint
    def remove_account(self, aid):
        with lock:
            data["accounts"] = [a for a in data["accounts"] if a["id"] != aid]
            if data["settings"].get("account") == aid:
                data["settings"]["account"] = data["accounts"][0]["id"] if data["accounts"] else ""
            save()
        return {"accounts": public_accounts(), "settings": data["settings"]}

    # --- launcher update ---
    @endpoint
    def check_self_update(self):
        return check_self_update()

    @endpoint
    def apply_self_update(self):
        run_task("task.self_update", {}, apply_self_update_job)

    # --- stats ---
    @endpoint
    def get_stats(self, iid=None):
        return collect_stats([iid] if iid else list(data["instances"]))

    # --- per-instance settings / clone ---
    @endpoint
    def save_instance(self, iid, o):
        inst = get_inst(iid)
        opts = {}
        ram = int(o.get("ram") or 0)
        if ram:
            opts["ram"] = max(1024, min(65536, ram))
        for key, lim in (("java", 500), ("jvm", 2000)):
            val = str(o.get(key) or "").strip()[:lim]
            if val:
                opts[key] = val
        w, h = int(o.get("width") or 0), int(o.get("height") or 0)
        if w and h:
            opts.update(width=max(320, min(7680, w)), height=max(240, min(4320, h)))
        if o.get("fullscreen"):
            opts["fullscreen"] = True
        with lock:
            inst["name"] = str(o.get("name") or "").strip()[:40] or inst["name"]
            inst["opts"] = opts
            save()
        push_instances()
        return inst["opts"]

    @endpoint
    def clone_instance(self, iid, name, with_worlds=True):
        name = str(name or "").strip()[:40]
        if not name:
            raise LauncherError("err.name_required")
        run_task("task.clone", {"name": get_inst(iid)["name"]}, clone_job, iid, name, bool(with_worlds))

    @endpoint
    def preflight(self, iid):
        return preflight(iid)

    # --- skins ---
    @endpoint
    def skin_profile(self):
        return skin_profile()

    @endpoint
    def upload_skin(self, slim=False):
        path = file_dialog("OPEN", allow_multiple=False, file_types=("Skin (*.png)",))
        if not path:
            return None
        upload_skin(path, bool(slim))
        return skin_profile()

    @endpoint
    def set_cape(self, cape_id=None):
        set_cape(cape_id)
        return skin_profile()

    # --- mod sets ---
    @endpoint
    def save_set(self, sid, name, items=None):
        return save_set(sid, name, items)

    @endpoint
    def set_from_instance(self, iid, name):
        return set_from_instance(iid, name)

    @endpoint
    def add_to_set(self, sid, item):
        return add_to_set(sid, item)

    @endpoint
    def delete_set(self, sid):
        with lock:
            data["sets"] = [x for x in data["sets"] if x["id"] != sid]
            save()
        return data["sets"]

    @endpoint
    def apply_set(self, sid, iid):
        name = next((x["name"] for x in data["sets"] if x["id"] == sid), "?")
        run_task("task.apply_set", {"name": name, "inst": get_inst(iid)["name"]}, apply_set_job, sid, iid)

    # --- play with a friend ---
    @endpoint
    def prepare_friend(self, iid):
        """Installs e4mc if needed and waits for it, so the UI can launch the game right after."""
        task = Task("task.friend", name=get_inst(iid)["name"])
        try:
            task.finish(friend_job(task, iid))
        except Exception as e:
            task.finish(error=error_msg(e))
            raise
        finally:
            push_instances()
        return True

    @endpoint
    def friend_link(self, iid):
        return friend_links.get(iid)

    # --- achievements ---
    @endpoint
    def get_achievements(self):
        return check_achievements(notify=False)

    # --- other launchers ---
    @endpoint
    def scan_launchers(self):
        return scan_launchers()

    @endpoint
    def import_launchers(self, ids, with_worlds=True):
        if not ids:
            raise LauncherError("err.nothing_selected")
        run_task("task.import_launchers", {"n": len(ids)}, import_launcher_job, list(ids), bool(with_worlds))

    # --- desktop shortcut ---
    @endpoint
    def create_shortcut(self, iid):
        return create_shortcut(iid)

    # --- similar mods ---
    @endpoint
    def suggest(self, iid):
        return suggest(iid)

    @endpoint
    def open_folder(self, iid=None, sub=None):
        path = inst_path(iid) if iid else BASE
        if sub:
            path = safe_join(path, sub)
            os.makedirs(path, exist_ok=True)
        os.startfile(path) if os.name == "nt" else subprocess.Popen(["xdg-open", path])


DROP_CONTEXT = {"iid": None}


def classify_file(path):
    """Which folder a dropped file belongs to: mods / resourcepacks / shaderpacks (or None)."""
    low = path.lower()
    if low.endswith(".jar"):
        return "mods"
    if low.endswith(".zip"):
        try:
            with zipfile.ZipFile(path) as z:
                names = z.namelist()
            if "pack.mcmeta" in names:
                return "resourcepacks"
            if any(n.startswith("shaders/") for n in names):
                return "shaderpacks"
        except zipfile.BadZipFile:
            return None
    return None


def add_files_job(task, iid, paths):
    root, added, skipped = inst_path(iid), [], []
    for p in paths:
        folder = classify_file(p)
        if not folder or not os.path.isfile(p):
            skipped.append(os.path.basename(p))
            continue
        os.makedirs(os.path.join(root, folder), exist_ok=True)
        shutil.copy2(p, os.path.join(root, folder, os.path.basename(p)))
        added.append(os.path.basename(p))
    if added:
        mark_dirty(iid)
        emit("content_changed", {"id": iid})
    if skipped and not added:
        raise LauncherError("err.drop_unknown", files=", ".join(skipped[:5]))
    return ("done.added_files", {"n": len(added), "skipped": len(skipped)})


def clean_trash():
    """Files removed more than a day ago are deleted for good."""
    for iid in list(data["instances"]):
        inst, trash = data["instances"][iid], os.path.join(inst_path(iid), ".trash")
        if not os.path.isdir(trash):
            continue
        for fn in os.listdir(trash):
            full = os.path.join(trash, fn)
            if time.time() - os.path.getmtime(full) > 86400:
                try:
                    os.remove(full)
                except OSError:
                    pass
                inst.get("trash", {}).pop(fn, None)
    save()


def bind_drop(win):
    """Drag a .mrpack file onto the window to import it (pywebview 5+)."""
    try:
        from webview.dom import DOMEventHandler

        def on_drop(e):
            files = [f.get("pywebviewFullPath") for f in e.get("dataTransfer", {}).get("files", [])]
            files = [p for p in files if p]
            packs = [p for p in files if p.lower().endswith(".mrpack")]
            for p in packs:
                run_task("task.import", {"file": os.path.basename(p)}, import_job, p)
            rest = [p for p in files if p not in packs]
            if rest:
                iid = DROP_CONTEXT.get("iid")
                if not iid:
                    toast("err.drop_open_instance", "error")
                else:
                    run_task("task.add_files", {"name": get_inst(iid)["name"]}, add_files_job, iid, rest)
        win.dom.document.events.drop += DOMEventHandler(on_drop, True, True)
        win.dom.document.events.dragover += DOMEventHandler(lambda e: None, True, True)
    except Exception:
        pass


def on_start(win, play_id=None):
    bind_drop(win)
    update_presence()
    if play_id:
        shortcut_play(play_id)

    def bg_update():
        try:
            info = check_self_update()
            if info:
                emit("self_update", info)
        except Exception:
            pass
    threading.Timer(6, bg_update).start()


def write_instance_file():
    if not MEDIA_BASE:
        return
    with open(INSTANCE_FILE, "w", encoding="utf-8") as f:
        json.dump({"port": int(MEDIA_BASE.split(":")[2].split("/")[0]), "token": MEDIA_TOKEN, "pid": os.getpid(),
                   "build": build_stamp()}, f)

    def cleanup():
        try:
            with open(INSTANCE_FILE, encoding="utf-8") as f:
                if json.load(f).get("pid") == os.getpid():
                    os.remove(INSTANCE_FILE)
        except Exception:
            pass
    atexit.register(cleanup)


if __name__ == "__main__":
    play_id = None
    if "--play" in sys.argv:
        i = sys.argv.index("--play")
        play_id = sys.argv[i + 1] if i + 1 < len(sys.argv) else None
    # Elytra already open? Hand the job over to it instead of starting a second copy.
    if handoff("play" if play_id else "show", play_id or ""):
        sys.exit(0)
    if getattr(sys, "frozen", False):   # leftovers of a self-update
        for fn in os.listdir(os.path.dirname(sys.executable)):
            if fn.lower().startswith("elytra.exe.") and fn.lower().endswith(".old"):
                try:
                    os.remove(os.path.join(os.path.dirname(sys.executable), fn))
                except OSError:
                    pass
    patch_requests()
    harden_webview()
    log(f"Elytra {VERSION} start, python {sys.version.split()[0]}")
    probe_network()
    threading.Thread(target=support_poller, daemon=True).start()
    start_media_server()
    write_instance_file()
    try:
        clean_trash()
    except Exception:
        pass
    try:
        seed_ready_versions()
    except Exception:
        pass
    threading.Thread(target=snapshot_month, daemon=True).start()
    HIDDEN.update(on=bool(play_id), shortcut=bool(play_id))
    window = webview.create_window("Elytra", resource(os.path.join("ui", "index.html")), js_api=Api(),
                                   width=1280, height=820, min_size=(1000, 640), background_color="#16181c",
                                   hidden=bool(play_id))
    webview.start(on_start, (window, play_id))
    # The window is gone. Unfinished downloads would otherwise keep an invisible Elytra running, which then
    # swallows the next start and keeps Elytra.exe locked. Running games are separate processes and keep going.
    try:
        with open(INSTANCE_FILE, encoding="utf-8") as f:
            if json.load(f).get("pid") == os.getpid():
                os.remove(INSTANCE_FILE)
    except Exception:
        pass
    log("window closed, exiting")
    os._exit(0)
