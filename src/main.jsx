import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import "./styles/liquid-glass.css";
import { initTvMode } from "./utils/tvMode";

// TV browsers get the 10-foot UI and remote (arrow-key) navigation
initTvMode();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
