[![Issues Badge](https://img.shields.io/github/issues/truelockmc/streambert?style=for-the-badge)](https://github.com/truelockmc/streambert/issues)
[![Closed Issues Badge](https://img.shields.io/github/issues-closed/truelockmc/streambert?color=%238256d0&style=for-the-badge)](https://github.com/truelockmc/streambert/issues?q=is%3Aissue+is%3Aclosed)<br>

[![GitHub](https://img.shields.io/badge/GitHub-truelockmc%2Fstreambert-181717?style=for-the-badge&logo=github)](https://github.com/truelockmc/streambert)
[![Codeberg](https://img.shields.io/badge/Codeberg-truelockmc%2Fstreambert-2185D0?style=for-the-badge&logo=codeberg)](https://codeberg.org/truelockmc/streambert)
# Streambert
A web app to stream and download any Movie, TV Series or Anime. It runs as a small Node.js server and you use it from any modern browser: on the same computer, or on your phone, tablet or TV over your home network. <br></br>

![Logo](public/logo.svg)

[Installation](#requirements)

## Why Streambert?
- 🎦 **Streaming:** Stream any Movie, Anime or TV Series from around the World.
- 🌎 **Spanish & English:** Audio and subtitle picker limited to Latin American Spanish and English.
- 📥 **Downloading:** Save episodes as MP4 straight to your own device (phone, tablet or computer), plus subtitles as SRT.
- 📃 **Subtitles:** Download and manage Spanish and English subtitles.
- 🪟 **Liquid Glass design:** Light and dark appearance that follows your system.
- 📚 **Library:** Track what you watched and save stuff you want to watch.
- ✨ **Trending:** Discover new things to Watch every Day.
- 🗂️ **Movies, Series & Anime:** Separate sections with trending, popular and top-rated rows plus genre filters.
- 📱 **Any screen:** Responsive layout for phones (bottom tab bar), tablets, desktops and large screens.
- 📺 **TV mode:** Detected automatically on smart-TV browsers (or `?tv=1`): bigger interface and remote-control navigation with the arrow keys, OK and Back.
- 🔒 **Shared server:** Use it from any browser on your network (protected by an access token).

![Explore new Stuff](screenshots/trending.png)
![Watch TV Series](screenshots/series.png)
![Watch Movies](screenshots/movie.png)
![Watch Anime](screenshots/anime.png)
![Customize](screenshots/customize-1.png)
![Customize](screenshots/customize-2.png)
![Download Subtitles](screenshots/subs.png)
![Download Everything](screenshots/download.png)
---
[![Stargazers](https://reporoster.com/stars/dark/truelockmc/streambert)](https://github.com/truelockmc/streambert/stargazers)
---
## Streaming
The app embeds video players from different hosters/aggregators, see [PLAYER_SOURCES](src/utils/api.js). Players run in a sandboxed `<iframe>`, so they can't open popups or redirect the page. <br></br>
It fetches Information for Images, Info Texts, Search and Homepage from [tmdb](https://www.themoviedb.org/).

With the default source (Vidrift), Streambert replaces the player's own language menus with an **Audio & Subtitles** picker that only offers Latin American Spanish and English, and remembers your choice.

---

## Downloading
Downloads are saved on the device of whoever presses **Download**, like any other browser download. The server reads the stream (HLS), remuxes it to MP4 on the fly with [mux.js](https://github.com/videojs/mux.js) and sends it to the browser: nothing is stored on the server and no extra software (ffmpeg, downloaders) is needed. Subtitles are delivered as `.srt` files.

Downloads need the stream's playlist, which the server gets for Anime (HiAnime). Third-party players run on other websites, so the browser can't read their streams.

---

## Anime
You can also watch Anime, the App checks if a Movie or Series is an Anime and then sources its Metadata from [AniList](https://anilist.co/) instead of [tmdb](https://www.themoviedb.org/). <br></br>
Anime streams are resolved on the server from HiAnime (the method comes from [ani-cli](https://github.com/pystardust/ani-cli)) and played with a built-in HLS player, which also supports intro skipping and progress tracking.

## Requirements

- [Node.js](https://nodejs.org/) 22.12 or newer
- A free TMDB API Read Access Token ([Guide on how to get one](tmdb-tutorial.md))

---
## Installation
```bash
git clone https://github.com/truelockmc/streambert.git
cd streambert
npm install
npm run web          # builds the app and starts http://localhost:3210
```

Put your TMDB token in a `.env` file (see below) and open **http://localhost:3210**.

| Command | What it does |
| --- | --- |
| `npm run web` | Build the app and start the server on `127.0.0.1:3210` |
| `npm start` | Start the server without rebuilding |
| `npm run web:lan` | Build and listen on all interfaces (phones, TVs, other PCs on your network) |
| `npm run dev` | Rebuild the app on every change (run `npm start` alongside) |

### Configuration
Streambert is meant to be shared by several people, so everything that affects all users lives in the server's `.env` file (copy `.env.example`). Keys set there can't be changed from the browser. The in-app **Settings** only contain appearance options, saved per browser.

| Variable | Default | Description |
| --- | --- | --- |
| `TMDB_TOKEN` | – | TMDB Read Access Token for everyone (required) |
| `WYZIE_API_KEY` | – | Wyzie Subs key for subtitle search and download |
| `SUBDL_API_KEY` | – | SubDL key; used instead of Wyzie when set |
| `PORT` | `3210` | Port to listen on |
| `HOST` | `127.0.0.1` | `0.0.0.0` makes it reachable from your network |
| `STREAMBERT_TOKEN` | auto | Access token. Required whenever `HOST` is not a loopback address; generated on first start, saved in the data folder and printed in the console URL |
| `STREAMBERT_DATA_DIR` | `~/.streambert-web` | Where server-side keys are stored |

### Updating
```bash
git pull && npm install && npm run web
```

### Notes
- Watch progress is tracked automatically for players the browser can inspect (HiAnime). For other sources use the progress buttons below the player.

---
## License
This project is open-source software licensed under the GNU General Public License v3.0 [(GPL-3.0)](LICENSE).

Forks may be created but they MUST stay open-sourced.

## Contributing
Everyone is welcome to contribute to this project.
Before contributing please make sure to read the [Contributing Guidelines](CONTRIBUTING.md) and act accordingly.

## Privacy Disclaimer
Streambert itself does not collect ANY data. There is no centralized service which the app relies on; it runs on your own machine.
However, the streaming sources may still collect your data.

Embedded players run in a sandboxed frame that blocks popups and redirects, but ads inside a player itself can't be filtered.

## Legal Disclaimer

**IMPORTANT: This application is for educational and personal use only.**

- Streambert does not host, store, or distribute any copyrighted content
- All content is sourced from third-party providers and websites
- Users are solely responsible for ensuring they have legal rights to access any content
- The developer does not endorse or encourage copyright infringement
- Users must comply with all applicable laws in their jurisdiction
- Any legal issues should be directed to the actual content providers
- This app functions as a search engine aggregator only
- No copyrighted material is stored on my side

## Legal Notice

This application is provided "as is" for educational purposes. The developer:
- Does not claim ownership of any content
- Does not profit from copyrighted material in any way
- Does not control third-party content providers
- Encourages users to support content creators through legal means

[![RepoStars](https://repostars.dev/api/embed?repo=truelockmc%2Fstreambert&theme=dark)](https://repostars.dev/?repos=truelockmc%2Fstreambert&theme=dark)

<details>
    <summary>Project Structure</summary>

```
Project Root
├── index.html              # app shell (loads public/web-bridge.js, then src/main.jsx)
├── package.json
├── vite.config.js
├── .env.example            # server configuration template
├── public
│   ├── web-bridge.js       # window.api: browser client for the server API
│   ├── favicon.svg
│   ├── apple-touch-icon.png
│   └── logo.svg
├── server                  # Node.js backend
│   ├── index.js            # HTTP server, API routes, static files
│   ├── runtime.js          # paths, channel registry, server → browser events
│   └── ipc
│       ├── export.js       # downloads to the user's device (HLS → MP4, SRT)
│       ├── hianime.js      # anime resolver + local HLS player
│       ├── storage.js      # secret store
│       └── subtitles.js    # subtitle search & download
├── screenshots
└── src                     # React app
    ├── App.jsx
    ├── main.jsx
    ├── components
    ├── pages
    ├── styles
    │   ├── global.css
    │   └── liquid-glass.css
    └── utils
```
</details>
