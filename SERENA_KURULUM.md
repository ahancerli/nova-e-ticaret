# Serena kurulumu (Claude Code için)

Bu proje, Claude Code'un kodu daha az token harcayarak anlaması için **[Serena](https://github.com/oraios/serena)** kullanır.
Serena, VS Code'un "Go to Definition / Find References" özelliklerinin arkasındaki dil sunucusunu (LSP) Claude'a MCP aracı olarak verir:
Claude dosyaları baştan sona okumak yerine sembol (sınıf, fonksiyon) düzeyinde arar, okur ve düzenler. Ayrıca proje hakkında
öğrendiklerini `.serena/memories/` altındaki notlarda tutar; yeni oturumda projeyi baştan keşfetmez.

> Kurulum Serena **2.1.0**, Claude Code **2.1.318**, macOS (Apple Silicon) ile denendi — 2026-11-04.
> Serena README'sinin uyarısı: Serena'yı MCP/plugin marketplace'lerinden kurmayın, oradaki komutlar eskidir.

---

## Ön koşullar

| Araç | Kontrol | Not |
|---|---|---|
| Homebrew | `brew --version` | |
| Node ≥ 22.13 | `node --version` | Proje zorunluluğu; Serena'nın TypeScript dil sunucusu da Node ile çalışır. nvm kullanıyorsanız `nvm alias default node` ile her yeni terminal en son sürümle açılır. |
| uv | `uv --version` | Yoksa: `brew install uv` |
| Claude Code CLI | `claude --version` | Yoksa aşağıdaki **Adım 3**. VS Code eklentisi kendi içindeki `claude`'u terminale eklemez. |

---

## Adım 1 — Serena'yı kur

```zsh
uv tool install -p 3.13 serena-agent
```

- `uv tool install`: aracı kendi yalıtılmış ortamına kalıcı olarak kurar.
- `-p 3.13`: Python 3.13 kullanır; yoksa `uv` indirir, sistem Python'una dokunmaz.
- Program `~/.local/bin/serena` olarak yerleşir.

**Kontrol** (yeni bir terminalde):

```zsh
serena --help
```

`command not found: serena` → `~/.local/bin` PATH'te değil:

```zsh
uv tool update-shell     # PATH satırını ~/.zshenv'e yazar
```

Sonra terminali **kapatıp yeniden açın**. `source ~/.zshrc` yetmez — satır `~/.zshenv` içindedir ve yalnız açılışta okunur.

## Adım 2 — Serena'yı ilklendir

```zsh
serena init
```

Beklenen çıktı:

```
Serena version: 2.1.0
Configuration file: ~/.serena/serena_config.yml
Language backend: LSP
Serena has been initialised successfully.
```

## Adım 3 — Claude Code CLI'ını kur (yoksa)

```zsh
curl -fsSL https://claude.ai/install.sh | bash
```

Betik sistemi algılar, `downloads.claude.ai`'den son sürümü indirir, SHA-256 ile doğrular ve `~/.local/bin/claude` olarak kurar
(`sudo` istemez, kendini otomatik günceller). Önce içine bakmak için: `curl -fsSL https://claude.ai/install.sh | less`.

**`EACCES: permission denied, mkdir '~/.local/state/claude'` hatası:** `~/.local/state` klasörü daha önce `sudo` ile
(ör. `sudo gem install`) oluşturulmuş ve sahibi `root` olmuştur. Kontrol: `ls -ld ~/.local/state`. Düzeltme:

```zsh
sudo chown -R "$(whoami)":staff ~/.local/state
```

Sonra kurulumu tekrar çalıştırın. `--force` kullanmayın; izin sorununu çözmez.

**Kontrol:** yeni terminalde `claude --version`.

## Adım 4 — Serena'yı bu projeye MCP sunucusu olarak ekle

```zsh
cd /path/to/nova
claude mcp add serena -- serena start-mcp-server --context claude-code --project "$(pwd)"
```

- Kapsam belirtilmediği için **local**: yalnız bu bilgisayarda, yalnız bu projede geçerli; ayar `~/.claude.json`'a yazılır, depoya dosya eklenmez.
  Bu yüzden projeyi klonlayan **herkes bu adımı kendi makinesinde yapmalıdır.**
- `--context claude-code`: Serena'nın dosya/arama/kabuk araçlarını kapatır (Claude Code'da zaten var), sembol araçlarını bırakır.
- `--project "$(pwd)"`: Serena'nın çalışacağı proje klasörü.

Beklenen çıktı: `Added stdio MCP server serena with command: ... to local config`.

## Adım 5 — Bağlantıyı doğrula

```zsh
claude mcp list
```

Beklenen: `serena: serena start-mcp-server ... - ✔ Connected`. `✗ Failed to connect` görürseniz önce `serena --help` çalışıyor mu bakın;
VS Code'u Dock'tan açtıysanız `claude mcp add` komutunda `serena` yerine tam yolu (`~/.local/bin/serena`) kullanmak da çözüm olabilir.

## Adım 6 — Claude oturumunu yeniden başlat

MCP sunucuları yalnız oturum açılırken yüklenir. VS Code'da Claude panelinde **yeni sohbet** açın
(olmazsa `Cmd+Shift+P` → **Developer: Reload Window**). Serena araçları `mcp__serena__*` adıyla görünür.

## Adım 7 — Onboarding (projede bir kez, yapıldı)

Yeni sohbette: *"Serena araçların görünüyor mu? Görünüyorsa bu proje için Serena onboarding'i yap."*

Claude projeyi bir kez tarar ve notları yazar. Bu projede onboarding **2026-11-04'te yapıldı**; notlar depoda:

| Not | İçerik |
|---|---|
| `.serena/memories/core.md` | Giriş noktası: proje özeti, klasör haritası, README/db README'de hangi bölümde ne var, diğer notlara bağlantılar |
| `tech_stack.md` | Sürümler, Cloudflare binding'leri, test altyapısı, Node şartı |
| `conventions.md` | Modül yapısı, use case + `UnitOfWork` + guard + audit kalıbı, `route({...})`, istemci/sunucu import ayrımı, panel UI kuralları |
| `suggested_commands.md` | dev / db / test / deploy komutları, macOS farkları |
| `task_completion.md` | İş bitince çalıştırılacak kontroller (typecheck → lint → ilgili test) |
| `pitfalls.md` | iCloud kopya dosyaları, dev açıkken local D1'e yazmamak, bayat dev modülleri, SQLite tuzakları |
| `memory_maintenance.md` | Serena'nın not yazım kuralları (Serena oluşturur) |

---

## Günlük kullanım

- Yeni oturumda Claude önce `core` notunu okur, gerekirse ilgili nota iner; kodda sembol araçlarıyla yalnız gereken gövdeleri açar.
- **Notlar kendiliğinden güncel tutulur:** `CLAUDE.md` Claude'a, mimariyi etkileyen bir işin sonunda ilgili notu aynı işte
  güncellemesini söyler. Unutursa `.claude/settings.json`'daki **Stop hook'u** (`.claude/hooks/serena-memory-check.sh`) devreye girer:
  `src/core/`, `src/server/`, `src/modules/*/module.ts|index.ts`, `db/schema.sql`, `package.json`, `wrangler.jsonc` gibi dosyalar
  değiştiyse (commit edilmemiş veya push edilmemiş) ve `.serena/memories/` değişmediyse Claude'u bir kez durdurup notları kontrol ettirir.
  Aynı değişiklik için tekrar uyarmaz. Hook'u görmek/kapatmak için Claude Code'da `/hooks`.
- Elle de isteyebilirsiniz: *"Serena notlarını şu değişikliğe göre güncelle: …"*. Not bağlantılarını kontrol: proje kökünde `serena memories check`.
- Serena'yı güncellemek: `uv tool upgrade serena-agent`. Claude Code CLI kendini günceller.
- Serena'yı bu projeden kaldırmak: `claude mcp remove serena`. Tamamen kaldırmak: `uv tool uninstall serena-agent`.

## Git'e ne girer?

`.serena/.gitignore` zaten `cache/` ve `project.local.yml`'yi dışlar. Commit edilenler: `.serena/project.yml` (proje adı, dil sunucusu: typescript)
ve `.serena/memories/*.md`. Notlarda sır veya kişisel bilgi yoktur; depo public olduğu için yeni not eklerken de bu kurala uyun.
