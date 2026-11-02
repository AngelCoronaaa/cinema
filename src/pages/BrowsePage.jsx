// ── Browse: Movies / Series / Anime ───────────────────────────────────────────
// One page component for the three catalogue sections. Each section shows a
// featured hero, several TMDB rows and a genre filter; picking a genre swaps
// the rows for a paginated grid.
//
// Anime is TMDB animation (genre 16) originally in Japanese, so selecting a
// title still opens the regular Movie/TV page (which switches to AniList
// metadata and anime sources on its own).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MediaCard from "../components/MediaCard";
import { PlayIcon, StarIcon } from "../components/Icons";
import { imgUrl, tmdbFetch } from "../utils/api";

const ANIMATION = 16;
const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const ANIME_TV = `/discover/tv?with_genres=${ANIMATION}&with_original_language=ja`;
const ANIME_MOVIE = `/discover/movie?with_genres=${ANIMATION}&with_original_language=ja`;

// Rows per section: [id, title, path, media_type]
const SECTIONS = {
  movies: {
    title: "Movies",
    mediaType: "movie",
    genrePath: "/genre/movie/list",
    discover: (genre) => `/discover/movie?with_genres=${genre}&sort_by=popularity.desc&vote_count.gte=50`,
    rows: () => [
      ["trending", "Trending This Week", "/trending/movie/week", "movie"],
      ["popular", "Popular", "/movie/popular", "movie"],
      ["now", "In Theaters", "/movie/now_playing", "movie"],
      ["top", "Top Rated", "/movie/top_rated", "movie"],
      ["upcoming", "Coming Soon", "/movie/upcoming", "movie"],
    ],
  },
  series: {
    title: "Series",
    mediaType: "tv",
    genrePath: "/genre/tv/list",
    discover: (genre) => `/discover/tv?with_genres=${genre}&sort_by=popularity.desc&vote_count.gte=50`,
    rows: () => [
      ["trending", "Trending This Week", "/trending/tv/week", "tv"],
      ["popular", "Popular", "/tv/popular", "tv"],
      ["airing", "Airing Today", "/tv/airing_today", "tv"],
      ["onair", "New Episodes This Week", "/tv/on_the_air", "tv"],
      ["top", "Top Rated", "/tv/top_rated", "tv"],
    ],
  },
  anime: {
    title: "Anime",
    mediaType: "tv",
    genrePath: "/genre/tv/list",
    // Animation itself and non-fiction genres make no sense as anime filters
    genreExclude: new Set([ANIMATION, 99, 10763, 10764, 10766, 10767]),
    discover: (genre) => `${ANIME_TV}&with_genres=${ANIMATION},${genre}&sort_by=popularity.desc`,
    rows: () => [
      ["popular", "Popular Anime", `${ANIME_TV}&sort_by=popularity.desc`, "tv"],
      [
        "season",
        "Airing This Season",
        `${ANIME_TV}&air_date.gte=${daysFromNow(-7)}&air_date.lte=${daysFromNow(7)}&sort_by=popularity.desc`,
        "tv",
      ],
      ["top", "Top Rated", `${ANIME_TV}&sort_by=vote_average.desc&vote_count.gte=300`, "tv"],
      ["movies", "Anime Movies", `${ANIME_MOVIE}&sort_by=popularity.desc&release_date.lte=${today()}`, "movie"],
      ["movieTop", "Best Anime Movies", `${ANIME_MOVIE}&sort_by=vote_average.desc&vote_count.gte=200`, "movie"],
    ],
  },
};

const withType = (results, type) =>
  (results || [])
    .filter((i) => i.poster_path)
    .map((i) => ({ ...i, media_type: type }));

function Row({ title, items, onSelect, watched, onMarkWatched, onMarkUnwatched }) {
  if (!items?.length) return null;
  return (
    <section className="section browse-row" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <div className="scroll-row">
        {items.map((item) => (
          <MediaCard
            key={`${item.media_type}_${item.id}`}
            item={item}
            onClick={() => onSelect(item)}
            progress={0}
            watched={watched}
            onMarkWatched={onMarkWatched}
            onMarkUnwatched={onMarkUnwatched}
          />
        ))}
      </div>
    </section>
  );
}

export default function BrowsePage({
  section,
  apiKey,
  offline,
  onSelect,
  watched,
  onMarkWatched,
  onMarkUnwatched,
}) {
  const cfg = SECTIONS[section] || SECTIONS.movies;
  const [rows, setRows] = useState({});
  const [loading, setLoading] = useState(true);
  const [genres, setGenres] = useState([]);
  const [genre, setGenre] = useState(null); // { id, name } | null
  const [grid, setGrid] = useState({ items: [], page: 0, totalPages: 1, loading: false });
  const rowDefs = useMemo(() => cfg.rows(), [cfg]);

  // Reset when switching section
  useEffect(() => {
    setGenre(null);
    setRows({});
    setLoading(true);
  }, [section]);

  // Rows
  useEffect(() => {
    if (!apiKey || offline) return;
    let cancelled = false;
    Promise.all(
      rowDefs.map(([id, , path, type]) =>
        tmdbFetch(path, apiKey)
          .then((d) => [id, withType(d.results, type)])
          .catch(() => [id, []]),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setRows(Object.fromEntries(entries));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiKey, offline, rowDefs]);

  // Genres
  useEffect(() => {
    if (!apiKey || offline) return;
    let cancelled = false;
    tmdbFetch(cfg.genrePath, apiKey)
      .then((d) => {
        if (cancelled) return;
        const list = (d.genres || []).filter((g) => !cfg.genreExclude?.has(g.id));
        setGenres(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiKey, offline, cfg]);

  // Genre grid (paginated)
  const loadPage = useCallback(
    async (g, page) => {
      setGrid((prev) => ({ ...prev, loading: true }));
      try {
        const d = await tmdbFetch(`${cfg.discover(g.id)}&page=${page}`, apiKey);
        const items = withType(d.results, cfg.mediaType);
        setGrid((prev) => {
          const base = page === 1 ? [] : prev.items;
          const seen = new Set(base.map((i) => i.id));
          return {
            items: [...base, ...items.filter((i) => !seen.has(i.id))],
            page,
            totalPages: Math.min(d.total_pages || 1, 50),
            loading: false,
          };
        });
      } catch {
        setGrid((prev) => ({ ...prev, loading: false }));
      }
    },
    [apiKey, cfg],
  );

  useEffect(() => {
    if (!genre) return;
    setGrid({ items: [], page: 0, totalPages: 1, loading: true });
    loadPage(genre, 1);
  }, [genre, loadPage]);

  // Infinite scroll for the genre grid
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !genre) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !grid.loading && grid.page < grid.totalPages) {
          loadPage(genre, grid.page + 1);
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [genre, grid.loading, grid.page, grid.totalPages, loadPage]);

  const hero = useMemo(() => {
    const first = rows[rowDefs[0][0]] || [];
    return first.find((i) => i.backdrop_path) || null;
  }, [rows, rowDefs]);

  if (offline) {
    return (
      <div className="browse-empty">
        <h1 className="page-title">{cfg.title}</h1>
        <p>You're offline. Connect to the internet to browse {cfg.title.toLowerCase()}.</p>
      </div>
    );
  }

  return (
    <div className="browse-page fade-in">
      {hero && !genre && (
        <div className="hero">
          <div
            className="hero-bg"
            style={{ backgroundImage: `url(${imgUrl(hero.backdrop_path, "original")})` }}
          />
          <div className="hero-gradient" />
          <div className="hero-content">
            <div className="hero-type">
              {cfg.title} · {rowDefs[0][1]}
            </div>
            <h1 className="hero-title">{hero.title || hero.name}</h1>
            <div className="hero-meta">
              {hero.vote_average > 0 && (
                <span className="hero-rating">
                  <StarIcon /> {hero.vote_average.toFixed(1)}
                </span>
              )}
              <span>{(hero.release_date || hero.first_air_date || "").slice(0, 4)}</span>
            </div>
            <p className="hero-overview">{hero.overview}</p>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => onSelect(hero)}>
                <PlayIcon /> Watch Now
              </button>
              <button className="btn btn-secondary" onClick={() => onSelect(hero)}>
                More Info
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`browse-header${genre || !hero ? " browse-header--top" : ""}`}>
        {(genre || !hero) && <h1 className="page-title">{cfg.title}</h1>}
        {genres.length > 0 && (
          <div className="chip-row" role="tablist" aria-label="Genres">
            <button
              type="button"
              role="tab"
              aria-selected={!genre}
              className={`chip${!genre ? " is-active" : ""}`}
              onClick={() => setGenre(null)}
            >
              All
            </button>
            {genres.map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={genre?.id === g.id}
                className={`chip${genre?.id === g.id ? " is-active" : ""}`}
                onClick={() => setGenre(g)}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {!genre && loading && (
        <div className="loader">
          <div className="spinner" />
        </div>
      )}

      {!genre &&
        rowDefs.map(([id, title]) => (
          <Row
            key={id}
            title={title}
            items={rows[id]}
            onSelect={onSelect}
            watched={watched}
            onMarkWatched={onMarkWatched}
            onMarkUnwatched={onMarkUnwatched}
          />
        ))}

      {genre && (
        <section className="section" aria-label={genre.name}>
          <h2 className="section-title">{genre.name}</h2>
          <div className="cards-grid">
            {grid.items.map((item) => (
              <MediaCard
                key={`${item.media_type}_${item.id}`}
                item={item}
                onClick={() => onSelect(item)}
                progress={0}
                watched={watched}
                onMarkWatched={onMarkWatched}
                onMarkUnwatched={onMarkUnwatched}
              />
            ))}
          </div>
          {grid.loading && (
            <div className="loader" style={{ padding: 32 }}>
              <div className="spinner" />
            </div>
          )}
          {!grid.loading && grid.items.length === 0 && (
            <p className="browse-empty__text">Nothing found for this genre.</p>
          )}
          {!grid.loading && grid.page < grid.totalPages && grid.items.length > 0 && (
            <div className="browse-more">
              <button className="btn btn-secondary" onClick={() => loadPage(genre, grid.page + 1)}>
                Load more
              </button>
            </div>
          )}
          <div ref={sentinelRef} aria-hidden="true" />
        </section>
      )}
    </div>
  );
}
