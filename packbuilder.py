"""Elytra: build an instance from a plain-language description ("horror survival with magic for a weak PC").

No AI service: the text is matched against themes (ru/uk/en/de/es word stems), each theme maps to
Modrinth categories and searches, the most popular compatible mods are picked, and pairs that declare
each other incompatible (or do the same job, like two minimaps) are filtered out.
"""
import json, re, concurrent.futures

# theme -> words (stems, lowercase), Modrinth categories, search queries, sure picks per loader
THEMES = {
    "horror": {"w": ["хоррор", "ужас", "страш", "жутк", "крип", "жах", "horror", "scary", "creepy", "spooky", "terror", "miedo"],
               "cats": [], "q": ["horror", "cave dweller", "scary mobs"], "pick": {}},
    "magic": {"w": ["маги", "волшеб", "заклин", "колдов", "чароде", "ведьм", "магі", "чарів", "magic", "spell", "wizard", "witch", "zauber", "magia", "hechiz"],
              "cats": ["magic"], "q": [""], "pick": {}},
    "tech": {"w": ["техни", "механи", "завод", "фабрик", "автомат", "машин", "индустр", "электр", "tech", "factory", "machine", "automat", "industr", "create ", "maschin", "tecnolog"],
             "cats": ["technology"], "q": [""], "pick": {"fabric": ["create-fabric"], "forge": ["create"]}},
    "adventure": {"w": ["приключ", "данж", "подзем", "босс", "крепост", "пригод", "adventure", "dungeon", "boss", "quest", "abenteuer", "aventur", "mazmorra"],
                  "cats": ["adventure"], "q": ["", "dungeon", "boss"], "pick": {}},
    "world": {"w": ["биом", "генерац", "ландшафт", "исслед", "путешест", "мир ", "миры", "природ", "горы", "біом", "biome", "terrain", "explor", "worldgen", "world gen", "travel", "landschaft", "bioma", "explora"],
              "cats": ["worldgen"], "q": ["", "structures"], "pick": {"fabric": ["terralith", "tectonic"], "forge": ["terralith", "tectonic"]}},
    "build": {"w": ["строит", "декор", "мебел", "дизайн", "интерьер", "будів", "build", "decor", "furniture", "interior", "bauen", "möbel", "constru", "muebl"],
              "cats": ["decoration"], "q": [""], "pick": {}},
    "food": {"w": ["еда", "еду", "ферм", "готовк", "кулинар", "повар", "урожа", "сельск", "ферм", "їж", "food", "farm", "cook", "crop", "essen", "comida", "granja"],
             "cats": ["food"], "q": [""], "pick": {"fabric": ["farmers-delight-refabricated"], "forge": ["farmers-delight"]}},
    "mobs": {"w": ["моб", "животн", "дракон", "звер", "существ", "тварин", "mob", "animal", "dragon", "creature", "beast", "tier", "drache", "animal", "dragón"],
             "cats": ["mobs"], "q": [""], "pick": {}},
    "combat": {"w": ["оруж", "меч ", "мечи", "мечом", "мечей", "мечах", "бои", "бой", "битв", "сраж", "пвп", "зброя", "weapon", "sword", "combat", "fight", "pvp", "waffe", "kampf", "arma", "combate"],
               "cats": ["equipment"], "q": ["", "combat"], "pick": {}},
    "rpg": {"w": ["рпг", "класс", "навык", "прокач", "уровн", "скилл", "rpg", "skill", "level", "class"],
            "cats": ["game-mechanics"], "q": ["rpg", "skills"], "pick": {}},
    "hardcore": {"w": ["хардкор", "сложн", "реализм", "реалист", "тяжел", "жорстк", "hardcore", "realis", "difficult", "hard mode", "schwer", "difícil"],
                 "cats": ["game-mechanics"], "q": ["survival", "realistic"], "pick": {}},
    "space": {"w": ["космос", "ракет", "планет", "луна", "space", "rocket", "planet", "moon", "weltraum", "espacio"],
              "cats": [], "q": ["space", "planets"], "pick": {}},
    "storage": {"w": ["хранил", "сундук", "инвентар", "сорт", "storage", "chest", "inventory", "lager", "almacen"],
                "cats": ["storage"], "q": [""], "pick": {}},
    "transport": {"w": ["транспорт", "поезд", "машин", "лодк", "самолет", "дирижабл", "transport", "train", "car", "plane", "vehicle", "zug", "tren"],
                  "cats": ["transportation"], "q": [""], "pick": {}},
    "cozy": {"w": ["уют", "спокой", "чил", "атмосфер", "затиш", "cozy", "cosy", "chill", "relax", "calm", "gemütlich", "acogedor"],
             "cats": ["decoration", "food"], "q": [""], "pick": {}},
}
LABELS = {  # shown to the player
    "ru": {"horror": "Хоррор", "magic": "Магия", "tech": "Техника", "adventure": "Приключения", "world": "Новые миры", "build": "Строительство",
           "food": "Еда и фермы", "mobs": "Мобы", "combat": "Оружие и бой", "rpg": "RPG", "hardcore": "Хардкор", "space": "Космос",
           "storage": "Хранение", "transport": "Транспорт", "cozy": "Уют", "perf": "FPS", "qol": "Удобство", "friends": "С друзьями",
           "map": "Карта", "shaders": "Шейдеры"},
    "uk": {"horror": "Хорор", "magic": "Магія", "tech": "Техніка", "adventure": "Пригоди", "world": "Нові світи", "build": "Будівництво",
           "food": "Їжа і ферми", "mobs": "Моби", "combat": "Зброя і бій", "rpg": "RPG", "hardcore": "Хардкор", "space": "Космос",
           "storage": "Зберігання", "transport": "Транспорт", "cozy": "Затишок", "perf": "FPS", "qol": "Зручність", "friends": "З друзями",
           "map": "Мапа", "shaders": "Шейдери"},
    "en": {"horror": "Horror", "magic": "Magic", "tech": "Tech", "adventure": "Adventure", "world": "New worlds", "build": "Building",
           "food": "Food & farming", "mobs": "Mobs", "combat": "Weapons & combat", "rpg": "RPG", "hardcore": "Hardcore", "space": "Space",
           "storage": "Storage", "transport": "Transport", "cozy": "Cozy", "perf": "FPS", "qol": "Quality of life", "friends": "With friends",
           "map": "Map", "shaders": "Shaders"},
    "de": {"horror": "Horror", "magic": "Magie", "tech": "Technik", "adventure": "Abenteuer", "world": "Neue Welten", "build": "Bauen",
           "food": "Essen & Farmen", "mobs": "Mobs", "combat": "Waffen & Kampf", "rpg": "RPG", "hardcore": "Hardcore", "space": "Weltraum",
           "storage": "Lager", "transport": "Transport", "cozy": "Gemütlich", "perf": "FPS", "qol": "Komfort", "friends": "Mit Freunden",
           "map": "Karte", "shaders": "Shader"},
    "es": {"horror": "Terror", "magic": "Magia", "tech": "Tecnología", "adventure": "Aventura", "world": "Mundos nuevos", "build": "Construcción",
           "food": "Comida y granjas", "mobs": "Mobs", "combat": "Armas y combate", "rpg": "RPG", "hardcore": "Hardcore", "space": "Espacio",
           "storage": "Almacenaje", "transport": "Transporte", "cozy": "Acogedor", "perf": "FPS", "qol": "Comodidad", "friends": "Con amigos",
           "map": "Mapa", "shaders": "Shaders"},
}
FLAGS = {
    "weak": ["слаб", "ноут", "офисн", "старый пк", "старом пк", "старый комп", "лаг", "фпс", "fps", "тормоз", "картош", "потат", "low-end", "low end", "laptop", "potato", "weak", "old pc", "schwach", "débil", "portátil"],
    "strong": ["мощн", "топов", "игров", "strong", "powerful", "high-end", "gaming pc"],
    "shaders": ["шейдер", "графи", "красив", "реалистичн", "shader", "graphic", "beautiful", "pretty", "grafik", "gráfic"],
    "friends": ["друз", "друг", "мультипл", "вмест", "кооп", "компани", "сервер", "friend", "coop", "co-op", "multiplayer", "together", "freund", "amigo"],
    "map": ["карт", "миникарт", "мапа", "map", "minimap", "karte", "mapa"],
    "big": ["много мод", "большая", "большую", "большой", "огромн", "кучу", "мега", "хардов", "big", "huge", "lots of", "massive", "kitchen sink", "groß", "grande"],
    "small": ["легк", "лёгк", "немного", "мало мод", "ванил", "чуть", "light", "small", "few mods", "vanilla", "klein", "ligero", "pocos"],
}
SIZES = {"small": 8, "normal": 18, "big": 36}   # theme mods (performance/QoL picks come on top)
BASE_QOL = {"fabric": ["modmenu", "appleskin", "jade", "jei", "mouse-tweaks"], "forge": ["appleskin", "jade", "jei", "mouse-tweaks"]}
PERF = {"fabric": ["sodium", "lithium", "ferrite-core", "entityculling", "immediatelyfast", "modernfix", "dynamic-fps"],
        "forge": ["embeddium", "ferrite-core", "entityculling", "modernfix"]}
PERF_LIGHT = {"fabric": ["sodium", "lithium", "ferrite-core"], "forge": ["embeddium", "ferrite-core", "modernfix"]}
FRIENDS = ["e4mc", "simple-voice-chat"]
MAPS = ["xaeros-minimap", "xaeros-world-map"]
SHADER_MODS = {"fabric": ["iris"], "forge": ["oculus"]}
SHADER = "complementary-reimagined"
# one mod per group is enough (keyword in the slug)
GROUPS = [("jei", "roughly-enough-items", "emi"), ("xaeros-minimap", "journeymap", "voxelmap", "ftb-chunks"),
          ("sodium", "embeddium", "rubidium", "optifine", "optifabric"), ("iris", "oculus"), ("jade", "wthit", "hwyla", "the-one-probe"),
          ("farmers-delight",), ("create",)]
SKIP_CATS = {"library"}
CANDIDATES = {"fabric": ["1.21.1", "1.20.1"], "forge": ["1.20.1"]}


def _has(t, words):
    """A word stem matches only at the start of a word (so "моб" doesn't match "автомобиль")."""
    for w in words:
        w = w.replace("ё", "е").strip()
        if re.search(r"(?<![0-9a-zа-яіїєґäöüßñáéíóú])" + re.escape(w), t):
            return True
    return False


def parse(text):
    t = " " + re.sub(r"\s+", " ", str(text or "").lower()).replace("ё", "е") + " "
    themes = [k for k, v in THEMES.items() if _has(t, v["w"])]
    flags = {k for k, ws in FLAGS.items() if _has(t, ws)}
    m = re.search(r"\b1\.(\d{1,2})(?:\.(\d{1,2}))?\b", t)
    mc = m.group(0) if m else None
    loader = "forge" if re.search(r"форж|forge|neoforge|неофорж", t) else "fabric" if re.search(r"фабрик|fabric", t) else \
        "quilt" if re.search(r"квилт|quilt", t) else None
    if "tech" in themes and "transport" in themes and not any(w in t for w in ("транспорт", "поезд", "лодк", "самолет", "дирижабл", "transport", "train", "plane", "vehicle")):
        themes.remove("transport")      # "машин" alone means machines here
    size = "big" if "big" in flags and "weak" not in flags else "small" if "small" in flags or "weak" in flags else "normal"
    return {"themes": themes, "flags": sorted(flags), "mc": mc, "loader": loader, "size": size}


def group_of(slug):
    for g in GROUPS:
        if any(k in slug for k in g):
            return g[0]
    return None


class Builder:
    def __init__(self, api, versions=None, log=lambda s: None):
        self.api, self.log = api, log
        self.versions = versions   # release versions known to exist (for validating a version from the text)

    def search(self, query, cats, mc, loader, limit=12):
        facets = [["project_type:mod"], [f"versions:{mc}"], [f"categories:{loader}"]]
        if cats:
            facets.append([f"categories:{c}" for c in cats])
        try:
            res = self.api("/search", {"query": query, "index": "downloads" if not query else "relevance", "limit": limit, "facets": json.dumps(facets)})
            return res.get("hits", [])
        except Exception as e:
            self.log(f"pack search failed: {type(e).__name__}: {e}")
            return []

    def theme_hits(self, theme, mc, loader):
        th, out = THEMES[theme], []
        for q in th["q"]:
            out += self.search(q, th["cats"], mc, loader)
        return out

    def score_target(self, themes, mc, loader):
        """How well a version/loader suits these themes: popularity of what's available."""
        total, hits = 0, {}
        with concurrent.futures.ThreadPoolExecutor(6) as ex:
            res = dict(zip(themes, ex.map(lambda th: self.theme_hits(th, mc, loader), themes)))
        for th, hs in res.items():
            good = [h for h in hs if not SKIP_CATS & set(h.get("categories", []))]
            hits[th] = good
            total += sum(min(h.get("downloads", 0), 30_000_000) ** 0.5 for h in good[:8])
        return total, hits

    def plan(self, text, want_mc=None, want_loader=None):
        p = parse(text)
        themes = p["themes"]
        mc = want_mc or p["mc"]
        loader = want_loader or p["loader"]
        if loader == "quilt":
            loader = "fabric"
        if not themes and not ({"shaders", "friends", "map", "weak"} & set(p["flags"])):
            return {"error": "pack.no_themes"}
        # pick version + loader when the text doesn't say
        loaders = [loader] if loader else ["fabric", "forge"]
        targets = [(lo, v) for lo in loaders for v in ([mc] if mc else CANDIDATES[lo])]
        best, best_hits = None, {}
        if themes:
            scored = []
            for lo, v in targets[:4]:
                sc, hits = self.score_target(themes, v, lo)
                scored.append((sc + (1 if lo == "fabric" else 0), lo, v, hits))
            scored.sort(key=lambda x: -x[0])
            _, lo, v, best_hits = scored[0]
            best = (lo, v)
        else:
            best = targets[0]
        loader, mc = best
        size = SIZES[p["size"]]
        weak, flags = "weak" in p["flags"], set(p["flags"])
        picked, groups, seen = [], set(), set()

        def take(hit_or_slug, reason, sure=False):
            slug = hit_or_slug if isinstance(hit_or_slug, str) else hit_or_slug.get("slug", "")
            pid = slug if isinstance(hit_or_slug, str) else hit_or_slug.get("project_id")
            if not slug or slug in seen:
                return False
            g = group_of(slug)
            if g and g in groups:
                return False
            if not isinstance(hit_or_slug, str):
                if SKIP_CATS & set(hit_or_slug.get("categories", [])) or hit_or_slug.get("client_side") == "unsupported":
                    return False
            seen.add(slug)
            if g:
                groups.add(g)
            picked.append({"slug": slug, "id": pid, "reason": reason, "sure": sure,
                           "title": "" if isinstance(hit_or_slug, str) else hit_or_slug.get("title", ""),
                           "desc": "" if isinstance(hit_or_slug, str) else hit_or_slug.get("description", ""),
                           "icon": None if isinstance(hit_or_slug, str) else hit_or_slug.get("icon_url"),
                           "downloads": 0 if isinstance(hit_or_slug, str) else hit_or_slug.get("downloads", 0)})
            return True

        for slug in (PERF_LIGHT if not weak else PERF)[loader]:
            take(slug, "perf", True)
        for slug in BASE_QOL[loader][: 2 if p["size"] == "small" else 5]:
            take(slug, "qol", True)
        if "friends" in flags:
            for slug in FRIENDS:
                take(slug, "friends", True)
        if "map" in flags:
            for slug in MAPS:
                take(slug, "map", True)
        if "shaders" in flags and not weak:
            for slug in SHADER_MODS[loader]:
                take(slug, "shaders", True)
        if themes:
            for th in themes:
                for slug in THEMES[th]["pick"].get(loader, []):
                    take(slug, th, True)
            base = len(picked)
            quota = max(2, -(-size // len(themes)))
            # round-robin so every theme gets its best mods first
            pools = {th: sorted(best_hits.get(th, []), key=lambda h: -h.get("downloads", 0)) for th in themes}
            counts = {th: sum(1 for m in picked if m["reason"] == th) for th in themes}
            progress = True
            while progress and len(picked) - base < size:
                progress = False
                for th in themes:
                    pool = pools[th]
                    while pool and counts[th] < quota:
                        if take(pool.pop(0), th):
                            counts[th] += 1
                            progress = True
                            break
        shaders = [SHADER] if "shaders" in flags and not weak else []
        return {"mc": mc, "loader": loader, "themes": themes, "flags": sorted(flags), "size": p["size"], "mods": picked, "shaders": shaders}

    def check(self, plan):
        """Resolve sure-picks to real projects, drop what has no version for this game, and drop
        the lower-ranked side of declared incompatibilities."""
        mc, loader = plan["mc"], plan["loader"]

        def versions(m):
            try:
                vs = self.api(f"/project/{m['id'] or m['slug']}/version", {"game_versions": json.dumps([mc]), "loaders": json.dumps([loader])})
                if not vs:
                    return m, None, None
                proj = None
                if not m.get("title"):
                    proj = self.api(f"/project/{m['id'] or m['slug']}")
                return m, vs[0], proj
            except Exception:
                return m, None, None
        with concurrent.futures.ThreadPoolExecutor(8) as ex:
            res = list(ex.map(versions, plan["mods"]))
        kept, ids, incompat = [], {}, set()
        for m, v, proj in res:
            if not v:
                continue
            if proj:
                m.update(id=proj["id"], title=proj["title"], desc=proj.get("description", ""), icon=proj.get("icon_url"), downloads=proj.get("downloads", 0))
            m["id"] = v.get("project_id") or m["id"]
            ids[m["id"]] = m
            for d in v.get("dependencies", []):
                if d.get("dependency_type") == "incompatible" and d.get("project_id"):
                    incompat.add((m["id"], d["project_id"]))
            kept.append(m)
        drop = set()
        for a, b in incompat:
            if a in ids and b in ids and a not in drop and b not in drop:
                ma, mb = ids[a], ids[b]
                loser = mb if (ma["sure"], ma["downloads"]) >= (mb["sure"], mb["downloads"]) else ma
                drop.add(loser["id"])
        plan["mods"] = [m for m in kept if m["id"] not in drop]
        plan["dropped"] = len(res) - len(plan["mods"])
        return plan
