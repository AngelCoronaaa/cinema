import { useState, useRef, useEffect } from "react";
import { imgUrl } from "../utils/api";
import {
  HomeIcon,
  SearchIcon,
  HistoryIcon,
  FilmIcon,
  TVIcon,
  AnimeIcon,
  MoreIcon,
  SettingsIcon,
  BackIcon,
  HelpIcon,
} from "./Icons";

export default function Sidebar({
  page,
  onNavigate,
  onSearch,
  savedList,
  onReorderSaved,
  onRemoveSaved,
  canGoBack,
  onBack,
  onShowShortcuts,
}) {
  const [dragOver, setDragOver] = useState(null);
  const dragItem = useRef(null);
  const dragNode = useRef(null);

  const [tooltip, setTooltip] = useState(null); // { title, y }
  // Phone layout: secondary destinations live in a "More" menu
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e) => {
      if (!moreRef.current?.contains(e.target)) setMoreOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setMoreOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);
  const go = (target) => {
    setMoreOpen(false);
    onNavigate(target);
  };
  const [contextMenu, setContextMenu] = useState(null); // { item, x, y }

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, []);

  const handleContextMenu = (e, item) => {
    e.preventDefault();
    e.stopPropagation();
    setTooltip(null);
    setContextMenu({ item, x: e.clientX, y: e.clientY });
  };

  const handleDragStart = (e, index) => {
    dragItem.current = index;
    dragNode.current = e.currentTarget;
    setTimeout(() => {
      if (dragNode.current) dragNode.current.style.opacity = "0.4";
    }, 0);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    if (dragNode.current) dragNode.current.style.opacity = "1";
    dragItem.current = null;
    dragNode.current = null;
    setDragOver(null);
  };

  const handleDragEnter = (e, index) => {
    if (dragItem.current === index) return;
    setDragOver(index);
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    const fromIndex = dragItem.current;
    if (fromIndex === null || fromIndex === dropIndex) return;

    const newList = [...savedList];
    const [moved] = newList.splice(fromIndex, 1);
    newList.splice(dropIndex, 0, moved);

    const newOrder = newList.map((item) => `${item.media_type}_${item.id}`);
    onReorderSaved(newOrder);
    setDragOver(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleMouseEnter = (e, title) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ title, y: rect.top + rect.height / 2 });
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  return (
    <nav className="sidebar" aria-label="Main">

      {canGoBack && (
        <SideBtn
          className="nav-secondary"
          onClick={onBack}
          icon={<BackIcon />}
          label="Back"
        />
      )}

      <SideBtn
        className="nav-tab nav-search"
        onClick={onSearch}
        icon={<SearchIcon />}
        label="Search  (⌘F)"
        short="Search"
      />
      <SideBtn
        className="nav-tab"
        active={page === "home"}
        onClick={() => go("home")}
        icon={<HomeIcon />}
        label="Home"
        short="Home"
      />
      <SideBtn
        className="nav-tab"
        active={page === "movies"}
        onClick={() => go("movies")}
        icon={<FilmIcon />}
        label="Movies"
        short="Movies"
      />
      <SideBtn
        className="nav-tab"
        active={page === "series"}
        onClick={() => go("series")}
        icon={<TVIcon />}
        label="Series"
        short="Series"
      />
      <SideBtn
        className="nav-tab"
        active={page === "anime"}
        onClick={() => go("anime")}
        icon={<AnimeIcon />}
        label="Anime"
        short="Anime"
      />

      <div className="sidebar-sep nav-secondary" />

      <SideBtn
        className="nav-secondary"
        active={page === "history"}
        onClick={() => go("history")}
        icon={<HistoryIcon />}
        label="Library & History"
      />

      {/* Phone tab bar: everything else lives under "More" */}
      <div className="nav-more" ref={moreRef}>
        <SideBtn
          className="nav-tab"
          active={moreOpen || ["history", "settings"].includes(page)}
          onClick={() => setMoreOpen((v) => !v)}
          icon={<MoreIcon />}
          label="More"
          short="More"
          expanded={moreOpen}
        />
        {moreOpen && (
          <div className="nav-more__menu glass-popover" role="menu">
            <button type="button" role="menuitem" onClick={() => go("history")}>
              <HistoryIcon /> Library &amp; History
            </button>
            <button type="button" role="menuitem" onClick={() => go("settings")}>
              <SettingsIcon /> Settings
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                onShowShortcuts();
              }}
            >
              <HelpIcon /> Help &amp; Shortcuts
            </button>
          </div>
        )}
      </div>

      <div className="sidebar-sep nav-secondary" />

      <div className="sidebar-saved nav-secondary">
        {savedList.map((item, index) => {
          const key = `${item.media_type}_${item.id}`;
          const title = item.title || item.name;
          return (
            <div
              key={key}
              className={`saved-thumb${dragOver === index ? " drag-over" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              onClick={() =>
                onNavigate(item.media_type === "tv" ? "tv" : "movie", item)
              }
              onContextMenu={(e) => handleContextMenu(e, item)}
              onMouseEnter={(e) => handleMouseEnter(e, title)}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: "grab", position: "relative" }}
            >
              {item.poster_path ? (
                <img src={imgUrl(item.poster_path, "w200")} alt={title} />
              ) : (
                <div className="no-img">
                  <FilmIcon />
                </div>
              )}
              {dragOver === index && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: "var(--accent, #e50914)",
                    borderRadius: 2,
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {tooltip && (
        <div className="saved-thumb-tooltip" style={{ top: tooltip.y }}>
          {tooltip.title}
        </div>
      )}

      {contextMenu && (
        <div
          className="sidebar-context-menu"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="sidebar-context-menu-item"
            onClick={() => {
              onRemoveSaved && onRemoveSaved(contextMenu.item);
              setContextMenu(null);
            }}
          >
            Remove
          </div>
        </div>
      )}

      <div className="sidebar-bottom nav-secondary">
        <SideBtn
          onClick={onShowShortcuts}
          icon={<HelpIcon />}
          label="Help & Shortcuts (?)"
        />
        <SideBtn
          active={page === "settings"}
          onClick={() => onNavigate("settings")}
          icon={<SettingsIcon />}
          label="Settings"
        />
      </div>
    </nav>
  );
}

function SideBtn({ active, onClick, icon, label, short, badge, className = "", expanded }) {
  return (
    <button
      className={`sidebar-btn ${className} ${active ? "active" : ""}`}
      onClick={onClick}
      aria-label={label.replace(/\s+\(.*\)$/, "").trim()}
      aria-current={active ? "page" : undefined}
      aria-expanded={expanded}
      style={{ position: "relative" }}
    >
      {icon}
      {short && <span className="tab-label">{short}</span>}
      <span className="tooltip">{label}</span>
      {badge && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: "var(--red)",
            color: "white",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: "16px",
            textAlign: "center",
            padding: "0 4px",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
